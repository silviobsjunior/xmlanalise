// backend/bot.js
const TelegramBot = require('node-telegram-bot-api');
const { Pool } = require('pg');
require('dotenv').config();

const token = process.env.TELEGRAM_BOT_TOKEN;

if (!token || token.includes('SEU_TOKEN_AQUI')) {
    console.warn('TELEGRAM_BOT_TOKEN não configurado corretamente. O bot do Telegram não será iniciado.');
    module.exports = null;
    return;
}

const bot = new TelegramBot(token, { polling: true });

const pool = new Pool({
    connectionString: process.env.POSTGRES_URL,
    ssl: { rejectUnauthorized: false }
});

const userSessions = {};

const mainKeyboard = {
    reply_markup: {
        keyboard: [
            [{ text: "🔍 Nova Busca" }, { text: "📷 Abrir Scanner" }],
            [{ text: "❓ Ajuda" }]
        ],
        resize_keyboard: true
    }
};

bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    delete userSessions[chatId];
    bot.sendMessage(chatId, "👋 Olá! Bem-vindo ao *Aqui Tem Bot*.\n\nEscolha uma opção no menu abaixo ou simplesmente:\n1. *Digite o nome do produto*\n2. *Digite o EAN*\n3. *Use o Scanner*", {
        parse_mode: 'Markdown',
        ...mainKeyboard
    });
});

bot.onText(/\/reset/, (msg) => {
    const chatId = msg.chat.id;
    delete userSessions[chatId];
    bot.sendMessage(chatId, "🔄 Busca reiniciada. O que você deseja procurar agora?", mainKeyboard);
});

bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;

    if (!text) return;

    if (text === "🔍 Nova Busca") {
        delete userSessions[chatId];
        return bot.sendMessage(chatId, "Digite o nome do produto ou o código de barras:");
    }

    if (text === "📷 Abrir Scanner") {
        const miniAppUrl = process.env.RENDER_EXTERNAL_URL
            ? `${process.env.RENDER_EXTERNAL_URL}/scanner.html`
            : 'https://xml-analise.onrender.com/scanner.html';
        return bot.sendMessage(chatId, "Clique abaixo para escanear:", {
            reply_markup: {
                inline_keyboard: [[{ text: "📷 Abrir Scanner", web_app: { url: miniAppUrl } }]]
            }
        });
    }

    if (text === "❓ Ajuda") {
        return bot.sendMessage(chatId, "💡 *Dicas:*\n- Busque por nome ou EAN.\n- Você pode filtrar por sua cidade.\n- Use as direções no Maps/Waze.", { parse_mode: 'Markdown' });
    }

    if (msg.web_app_data) {
        handleSearchInput(chatId, msg.web_app_data.data);
        return;
    }

    if (msg.location) {
        let session = userSessions[chatId];
        if (session && session.step === 'waiting_location_or_city') {
            bot.sendMessage(chatId, `📍 Localização recebida. Buscando *${session.query}*...`);
            await performProductSearch(chatId, session.query, session.isEan, "", 0);
            return;
        }
    }

    if (!text.startsWith('/')) {
        let session = userSessions[chatId];

        if (session && session.step === 'waiting_location_or_city') {
            const input = text.toUpperCase().trim();
            if (input === "PULAR FILTRO" || input === "PULAR") {
                await performProductSearch(chatId, session.query, session.isEan, "", 0);
            } else {
                await performProductSearch(chatId, session.query, session.isEan, input, 0);
            }
            return;
        }

        handleSearchInput(chatId, text);
    }
});

bot.on('callback_query', async (callbackQuery) => {
    const chatId = callbackQuery.message.chat.id;
    const data = callbackQuery.data;

    if (data === 'ver_mais') {
        const session = userSessions[chatId];
        if (session && session.query) {
            session.offset = (session.offset || 0) + 5;
            await performProductSearch(chatId, session.query, session.isEan, session.cidade, session.offset);
        } else {
            bot.sendMessage(chatId, "Sua sessão expirou. Por favor, inicie uma nova busca.");
        }
    }

    bot.answerCallbackQuery(callbackQuery.id);
});

async function handleSearchInput(chatId, input) {
    const isEan = /^\d{8,14}$/.test(input.trim());
    userSessions[chatId] = { 
        step: 'waiting_location_or_city', 
        query: input.trim(),
        isEan: isEan,
        offset: 0
    };

    bot.sendMessage(chatId, `✅ Identificado: ${isEan ? "EAN" : "Produto"} *${input.trim()}*.\n\nDeseja filtrar por **Cidade**? Envie sua localização GPS ou digite o nome da cidade (ou clique em "Pular").`, {
        parse_mode: 'Markdown',
        reply_markup: {
            keyboard: [
                [{ text: "📍 Enviar Localização", request_location: true }],
                [{ text: "Pular Filtro" }]
            ],
            one_time_keyboard: true,
            resize_keyboard: true
        }
    });
}

async function performProductSearch(chatId, query, isEan, cidade, offset = 0) {
    try {
        const limit = 5;
        let params = [];
        let whereClauses = [];

        if (isEan) {
            whereClauses.push(`p.codigo_barras = $${params.length + 1}`);
            params.push(query);
        } else {
            whereClauses.push(`p.descricao ILIKE $${params.length + 1}`);
            params.push(`%${query}%`);
        }

        if (cidade) {
            whereClauses.push(`e.municipio ILIKE $${params.length + 1}`);
            params.push(`%${cidade}%`);
        }

        const whereSql = whereClauses.length ? `WHERE ${whereClauses.join(' AND ')}` : '';

        // Contar total
        const countQuery = `SELECT count(*) FROM produtos_nfe p 
                            JOIN atores a ON p.emitente_id = a.id
                            JOIN emitentes e ON a.identificador = e.cnpj
                            ${whereSql}`;
        const countRes = await pool.query(countQuery, params);
        const total = parseInt(countRes.rows[0].count);

        // Buscar páginas
        const dataQuery = `SELECT p.descricao, p.valor_unitario, e.municipio, e.uf, e.nome as loja,
                                 e.logradouro, e.numero, e.bairro
                          FROM produtos_nfe p
                          JOIN atores a ON p.emitente_id = a.id
                          JOIN emitentes e ON a.identificador = e.cnpj
                          ${whereSql}
                          ORDER BY p.created_at DESC LIMIT ${limit} OFFSET ${offset}`;
        
        const { rows } = await pool.query(dataQuery, params);

        if (rows.length === 0 && offset === 0) {
            return bot.sendMessage(chatId, `❌ Nenhum resultado para "${query}"${cidade ? ' em ' + cidade : ''}.`, mainKeyboard);
        }

        // Salvar estado da busca na sessão para paginação
        userSessions[chatId] = { query, isEan, cidade, offset, step: 'browsing' };

        for (const r of rows) {
            const preco = r.valor_unitario ? parseFloat(r.valor_unitario).toFixed(2) : 'N/A';
            const logradouro = r.logradouro || '';
            const numero = r.numero || '';
            const bairro = r.bairro || '';
            const municipio = r.municipio || '';
            const uf = r.uf || '';
            
            // Filtra vírgulas sobrando se algum campo estiver nulo
            const parts = [logradouro, numero, bairro, municipio, uf].filter(p => p && p.trim().length > 0);
            const fullAddress = parts.join(', ');
            const encodedAddress = encodeURIComponent(fullAddress);

            const msgText = `📦 *${r.descricao}*\n💰 R$ ${preco}\n🏪 ${r.loja}\n📍 ${r.municipio}\n🏠 _${fullAddress}_`;

            const inline_keyboard = [
                [
                    { text: "🚗 Waze", url: `https://waze.com/ul?q=${encodedAddress}` },
                    { text: "🗺️ Google Maps", url: `https://www.google.com/maps/search/?api=1&query=${encodedAddress}` }
                ]
            ];

            await bot.sendMessage(chatId, msgText, { 
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard }
            });
        }

        if (total > offset + limit) {
             bot.sendMessage(chatId, `Exibindo ${offset + 1} a ${offset + rows.length} de *${total}* itens.`, {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [[{ text: "🔽 Ver Mais Resultados", callback_data: "ver_mais" }]]
                }
            });
        } else if (total > 0) {
            bot.sendMessage(chatId, "✅ Todos os resultados exibidos.", mainKeyboard);
        }

        if (offset === 0 && rows.length > 0) {
            await verificarSugestoesCrossSell(chatId, rows[0].descricao);
        }

    } catch (err) {
        console.error("Erro no Bot DB: ", err);
        bot.sendMessage(chatId, "⚠️ Erro ao consultar banco de dados.");
    }
}

async function verificarSugestoesCrossSell(chatId, produtoNome) {
    const nomeNormalizado = produtoNome.toLowerCase();
    const regrasCount = [
        { regex: /farinha.*trigo/i, msg: "🍕 Que tal uma Pizza? Veja se tem Fermento e Muzzarella." },
        { regex: /leite/i, msg: "🍰 Hora do bolo? Veja se tem Açúcar e Ovos." }
    ];
    for (let regra of regrasCount) {
        if (regra.regex.test(nomeNormalizado)) {
            bot.sendMessage(chatId, `💡 *Dica:* ${regra.msg}`, { parse_mode: 'Markdown' });
            break;
        }
    }
}

module.exports = bot;
