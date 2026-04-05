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

// Teclado principal (Reply Keyboard - Necessário para Web App sendData)
const getMenuKeyboard = () => {
    const miniAppUrl = process.env.RENDER_EXTERNAL_URL
        ? `${process.env.RENDER_EXTERNAL_URL}/scanner.html`
        : 'https://xmlanalise-node.onrender.com/scanner.html';
        
    return {
        reply_markup: {
            keyboard: [
                [{ text: "🔍 Nova Busca" }, { text: "📷 Abrir Scanner", web_app: { url: miniAppUrl } }],
                [{ text: "❓ Ajuda" }]
            ],
            resize_keyboard: true
        }
    };
};

bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    delete userSessions[chatId];
    bot.sendMessage(chatId, "👋 Olá! Bem-vindo ao *Aqui Tem Bot*.\n\nEscolha uma opção no menu ou digite o nome/EAN do produto abaixo.", {
        parse_mode: 'Markdown',
        ...getMenuKeyboard()
    });
});

bot.onText(/\/reset/, (msg) => {
    const chatId = msg.chat.id;
    delete userSessions[chatId];
    bot.sendMessage(chatId, "🔄 Busca reiniciada. O que deseja procurar?", getMenuKeyboard());
});

bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;

    if (!text && !msg.location && !msg.web_app_data) return;

    // Resposta do Scanner (web_app_data)
    if (msg.web_app_data) {
        const ean = msg.web_app_data.data;
        handleSearchInput(chatId, ean);
        return;
    }

    if (text === "🔍 Nova Busca") {
        delete userSessions[chatId];
        return bot.sendMessage(chatId, "Digite o nome do produto ou o código de barras:");
    }

    if (text === "❓ Ajuda") {
        return bot.sendMessage(chatId, "💡 *Dicas:*\n- Busque por nome ou EAN.\n- Você pode filtrar por sua cidade.\n- Use as direções no Maps/Waze no resultado.", { parse_mode: 'Markdown' });
    }

    // Localização GPS
    if (msg.location) {
        let session = userSessions[chatId];
        if (session && session.step === 'waiting_location_or_city') {
            try {
                const { latitude, longitude } = msg.location;
                // Reverse Geocoding via Nominatim (Gratuito/OSM)
                bot.sendMessage(chatId, "📍 Identificando sua cidade...");
                const response = await axios.get(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}`, {
                    headers: { 'User-Agent': 'AquiTemBot/1.0' }
                });
                
                const cidadeIdentificada = response.data.address.city || response.data.address.town || response.data.address.suburb || "";
                
                if (cidadeIdentificada) {
                    bot.sendMessage(chatId, `📍 Localidade: *${cidadeIdentificada}*. Buscando *${session.query}*...`, { parse_mode: 'Markdown' });
                    await performProductSearch(chatId, session.query, session.isEan, cidadeIdentificada, 0);
                } else {
                    bot.sendMessage(chatId, "⚠️ Não consegui extrair o nome da cidade. Buscando em geral...");
                    await performProductSearch(chatId, session.query, session.isEan, "", 0);
                }
            } catch (err) {
                console.error("Erro GPS:", err.message);
                await performProductSearch(chatId, session.query, session.isEan, "", 0);
            }
            return;
        }
    }

    if (!text || text.startsWith('/')) return;

    let session = userSessions[chatId];

    // Se estávamos esperando filtro de cidade
    if (session && session.step === 'waiting_location_or_city') {
        const input = text.toUpperCase().trim();
        if (input === "PULAR FILTRO" || input === "PULAR") {
            await performProductSearch(chatId, session.query, session.isEan, "", 0);
        } else {
            await performProductSearch(chatId, session.query, session.isEan, input, 0);
        }
        return;
    }

    // Nova busca por digitação
    handleSearchInput(chatId, text);
});

bot.on('callback_query', async (callbackQuery) => {
    const chatId = callbackQuery.message.chat.id;
    if (callbackQuery.data === 'ver_mais') {
        const session = userSessions[chatId];
        if (session && session.query) {
            session.offset = (session.offset || 0) + 5;
            await performProductSearch(chatId, session.query, session.isEan, session.cidade, session.offset);
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

    bot.sendMessage(chatId, `✅ Identificado: ${isEan ? "EAN" : "Produto"} *${input.trim()}*.\n\nDeseja filtrar por **Cidade**? Envie sua localização 📍 ou digite o nome da cidade (ou clique em "Pular").`, {
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

        // BUSCA POR EAN OU DESCRIÇÃO
        if (isEan) {
            whereClauses.push(`p.codigo_barras = $${params.length + 1}`);
            params.push(query);
        } else {
            whereClauses.push(`p.descricao ILIKE $${params.length + 1}`);
            params.push(`%${query}%`);
        }

        // FILTRO DE CIDADE (BUSCA EM EMITENTES VIA JOINS)
        if (cidade) {
            whereClauses.push(`e.municipio ILIKE $${params.length + 1}`);
            params.push(`%${cidade}%`);
        }

        const whereSql = whereClauses.length ? `WHERE ${whereClauses.join(' AND ')}` : '';

        // Contar total (corrigido JOIN)
        const countQuery = `SELECT count(*) 
                            FROM produtos_nfe p 
                            JOIN nfes n ON p.nfe_id = n.id
                            JOIN atores a ON n.emitente_id = a.id
                            JOIN emitentes e ON a.identificador = e.cnpj
                            ${whereSql}`;
        const countRes = await pool.query(countQuery, params);
        const total = parseInt(countRes.rows[0].count);

        // Buscar dados (corrigido JOIN)
        const dataQuery = `SELECT p.descricao, p.valor_unitario, e.municipio, e.uf, e.nome as loja,
                                 e.logradouro, e.numero, e.bairro
                          FROM produtos_nfe p
                          JOIN nfes n ON p.nfe_id = n.id
                          JOIN atores a ON n.emitente_id = a.id
                          JOIN emitentes e ON a.identificador = e.cnpj
                          ${whereSql}
                          ORDER BY p.created_at DESC LIMIT ${limit} OFFSET ${offset}`;
        
        const { rows } = await pool.query(dataQuery, params);

        if (rows.length === 0) {
            return bot.sendMessage(chatId, `❌ Nenhum resultado para "${query}"${cidade ? ' em ' + cidade : ''}.`, getMenuKeyboard());
        }

        userSessions[chatId] = { query, isEan, cidade, offset, step: 'browsing' };

        for (const r of rows) {
            const preco = r.valor_unitario ? parseFloat(r.valor_unitario).toFixed(2) : '0.00';
            const logradouro = r.logradouro || '';
            const numero = r.numero || '';
            const bairro = r.bairro || '';
            const municipio = r.municipio || '';
            const uf = r.uf || '';
            
            const fullAddress = [logradouro, numero, bairro, municipio, uf].filter(p => p && p.trim().length > 0).join(', ');
            const encodedAddress = encodeURIComponent(fullAddress);

            const msgText = `📦 *${r.descricao}*\n💰 R$ ${preco}\n🏪 ${r.loja}\n📍 ${r.municipio}\n🏠 _${fullAddress}_`;

            const inline_keyboard = [[
                { text: "🚗 Waze", url: `https://waze.com/ul?q=${encodedAddress}` },
                { text: "🗺️ Maps", url: `https://www.google.com/maps/search/?api=1&query=${encodedAddress}` }
            ]];

            await bot.sendMessage(chatId, msgText, { 
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard }
            });
        }

        if (total > offset + limit) {
             bot.sendMessage(chatId, `Exibindo ${offset + 1} a ${offset + rows.length} de *${total}* itens.`, {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [[{ text: "🔽 Ver Mais", callback_data: "ver_mais" }]]
                }
            });
        } else {
            bot.sendMessage(chatId, "✅ Todos os resultados exibidos.", getMenuKeyboard());
        }

    } catch (err) {
        console.error("Bot Search Error:", err.message);
        bot.sendMessage(chatId, "⚠️ Erro na consulta. Verifique se o produto ou cidade existem.", getMenuKeyboard());
    }
}

module.exports = bot;
