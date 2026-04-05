// backend/bot.js
const TelegramBot = require('node-telegram-bot-api');
const { Pool } = require('pg');
const axios = require('axios');
require('dotenv').config();

const token = process.env.TELEGRAM_BOT_TOKEN;

if (!token || token.includes('SEU_TOKEN_AQUI')) {
    console.warn('TELEGRAM_BOT_TOKEN não configurado corretamente.');
    module.exports = null;
    return;
}

const bot = new TelegramBot(token, { polling: true });

const pool = new Pool({
    connectionString: process.env.POSTGRES_URL,
    ssl: { rejectUnauthorized: false }
});

const userSessions = {};

// Função para normalizar texto (MAIÚSCULO e SEM ACENTOS)
function normalizeText(text) {
    if (!text) return text;
    return text
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '') // Remove acentos
        .replace(/[^a-zA-Z0-9\s]/g, ' ') // Remove caracteres especiais
        .toUpperCase()
        .trim()
        .replace(/\s+/g, ' '); // Remove espaços duplos
}

const getMenuKeyboard = (chatId) => {
    const miniAppUrl = process.env.RENDER_EXTERNAL_URL
        ? `${process.env.RENDER_EXTERNAL_URL}/scanner.html`
        : 'https://xmlanalise-node.onrender.com/scanner.html';
        
    const keyboard = [
        [{ text: "🔍 Nova Busca" }, { text: "📷 Abrir Scanner", web_app: { url: miniAppUrl } }],
        [{ text: "❓ Ajuda" }]
    ];

    if (userSessions[chatId] && userSessions[chatId].cidade) {
        keyboard.push([{ text: `📍 Trocar Cidade (${userSessions[chatId].cidade})` }]);
    }

    return {
        reply_markup: {
            keyboard: keyboard,
            resize_keyboard: true
        }
    };
};

bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    delete userSessions[chatId];
    bot.sendMessage(chatId, "👋 Olá! Sou o assistente de busca do *Aqui Tem*.\n\nDigite o nome ou EAN do produto para começar.", {
        parse_mode: 'Markdown',
        ...getMenuKeyboard(chatId)
    });
});

bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;

    if (!text && !msg.location && !msg.web_app_data) return;

    if (msg.web_app_data) {
        handleSearchInput(chatId, msg.web_app_data.data);
        return;
    }

    if (text === "🔍 Nova Busca") {
        const session = userSessions[chatId];
        userSessions[chatId] = { cidade: session?.cidade, step: 'idle' };
        return bot.sendMessage(chatId, "Digite o nome do produto ou o código de barras:");
    }

    if (text && text.startsWith("📍 Trocar Cidade")) {
        if (userSessions[chatId]) userSessions[chatId].cidade = null;
        return bot.sendMessage(chatId, "📍 Cidade removida. Informe a nova cidade na próxima busca.", getMenuKeyboard(chatId));
    }

    if (text === "❓ Ajuda") {
        return bot.sendMessage(chatId, "💡 *Dicas:*\n- Busque pelo nome do produto (ex: 'Arroz') ou pelo código de barras.\n- Use o Scanner para ler o código direto da embalagem.\n- Filtre pela cidade para encontrar o melhor preço perto de você.", { parse_mode: 'Markdown' });
    }

    if (msg.location) {
        let session = userSessions[chatId];
        if (session && session.step === 'waiting_location_or_city') {
            try {
                const { latitude, longitude } = msg.location;
                bot.sendMessage(chatId, "📍 Identificando sua cidade...");
                const response = await axios.get(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}`, {
                    headers: { 'User-Agent': 'AquiTemBot/1.0' }
                });
                let city = response.data.address.city || response.data.address.town || response.data.address.suburb || "";
                const norm = normalizeText(city);
                if (norm) {
                    session.cidade = norm;
                    await performProductSearch(chatId, session.query, session.isEan, norm, 0);
                } else {
                    await performProductSearch(chatId, session.query, session.isEan, "", 0);
                }
            } catch (err) {
                console.error("GPS Error:", err.message);
                await performProductSearch(chatId, session.query, session.isEan, "", 0);
            }
            return;
        }
    }

    if (!text || text.startsWith('/')) return;

    let session = userSessions[chatId];
    if (session && session.step === 'waiting_location_or_city') {
        const input = text.toUpperCase().trim();
        if (input === "PULAR FILTRO" || input === "PULAR") {
            await performProductSearch(chatId, session.query, session.isEan, "", 0);
        } else {
            const cityInput = normalizeText(text);
            session.cidade = cityInput;
            await performProductSearch(chatId, session.query, session.isEan, cityInput, 0);
        }
        return;
    }

    handleSearchInput(chatId, text);
});

async function handleSearchInput(chatId, input) {
    const isEan = /^\d{8,14}$/.test(input.trim());
    const existing = userSessions[chatId];
    
    if (existing && existing.cidade) {
        userSessions[chatId] = { step: 'browsing', query: input.trim(), isEan: isEan, offset:0, cidade: existing.cidade };
        return await performProductSearch(chatId, input.trim(), isEan, existing.cidade, 0);
    }

    userSessions[chatId] = { step: 'waiting_location_or_city', query: input.trim(), isEan: isEan, offset:0 };
    bot.sendMessage(chatId, `✅ Produto identificado: *${input.trim()}*.\n\nInforme sua cidade 🏙️ (digite ou envie a localização) para filtrar os melhores preços:`, {
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

bot.on('callback_query', async (cq) => {
    const chatId = cq.message.chat.id;
    if (cq.data === 'ver_mais') {
        const s = userSessions[chatId];
        if (s && s.query) {
            s.offset = (s.offset || 0) + 5;
            await performProductSearch(chatId, s.query, s.isEan, s.cidade, s.offset);
        }
    }
    bot.answerCallbackQuery(cq.id);
});

async function performProductSearch(chatId, query, isEan, cidade, offset = 0) {
    try {
        const limit = 5;
        let params = [];
        let whereSql = '';
        
        let sqlTermo = 'TRUE';
        if (isEan) {
            params.push(query);
            sqlTermo = `p.codigo_barras = $${params.length}`;
        } else {
            params.push(`%${query}%`);
            sqlTermo = `(p.descricao ILIKE $${params.length} OR p.codigo_barras ILIKE $${params.length})`;
        }

        let filtroLoc = '';
        if (cidade) {
            params.push(`%${cidade}%`);
            filtroLoc = ` AND e.municipio ILIKE $${params.length}`;
        }

        // QUERY IGUAL AO SITE (PARTE 1: EMITENTE)
        const commonSql = `
            FROM produtos_nfe p
            JOIN nfe_importadas ni ON p.nfe_id = ni.id
            JOIN notas_fiscais nf  ON ni.chave_acesso = nf.chave_acesso
            JOIN atores a          ON nf.emitente_id = a.id
            JOIN emitentes e       ON a.identificador = e.cnpj
            WHERE e.cnpj ~ '^[0-9]{14}$'
              AND nf.perspectiva_importador IN ('emitente', 'consumidor')
              AND ${sqlTermo} ${filtroLoc}
        `;

        const countRes = await pool.query(`SELECT count(*) ${commonSql}`, params);
        const total = parseInt(countRes.rows[0].count);

        const dataRes = await pool.query(`
            SELECT p.descricao, p.valor_unitario, e.municipio, e.uf, e.nome_fantasia as loja_fantasia, 
                   e.razao_social as loja_razao, e.logradouro, e.numero, e.bairro
            ${commonSql}
            ORDER BY nf.data_emissao DESC
            LIMIT ${limit} OFFSET ${offset}
        `, params);

        const rows = dataRes.rows;

        if (rows.length === 0) {
            return bot.sendMessage(chatId, `❌ Nenhum vendedor encontrado para "${query}"${cidade ? ' em ' + cidade : ''}.`, getMenuKeyboard(chatId));
        }

        userSessions[chatId].cidade = cidade || userSessions[chatId].cidade;

        for (const r of rows) {
            const preco = r.valor_unitario ? parseFloat(r.valor_unitario).toFixed(2) : '0.00';
            const loja = r.loja_fantasia || r.loja_razao || 'Loja';
            const endereco = `${r.logradouro || ''}, ${r.numero || ''} - ${r.bairro || ''}, ${r.municipio || ''}/${r.uf || ''}`;
            const encodedAddr = encodeURIComponent(endereco);

            const msgText = `📦 *${r.descricao}*\n💰 R$ ${preco}\n🏪 ${loja}\n📍 ${r.municipio}\n🏠 _${endereco}_`;

            const inline_keyboard = [[
                { text: "🚗 Waze", url: `https://waze.com/ul?q=${encodedAddr}` },
                { text: "🗺️ Maps", url: `https://www.google.com/maps/search/?api=1&query=${encodedAddr}` }
            ]];

            await bot.sendMessage(chatId, msgText, { parse_mode: 'Markdown', reply_markup: { inline_keyboard } });
        }

        if (total > offset + limit) {
            bot.sendMessage(chatId, `Exibindo ${offset + 1}-${offset + rows.length} de *${total}* itens.`, {
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [[{ text: "🔽 Ver Mais", callback_data: "ver_mais" }]] }
            });
        } else {
            bot.sendMessage(chatId, "✅ Todos os resultados exibidos.", getMenuKeyboard(chatId));
        }

    } catch (err) {
        console.error("Bot Search Error:", err.message);
        bot.sendMessage(chatId, "⚠️ Erro na consulta.", getMenuKeyboard(chatId));
    }
}

module.exports = bot;
