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
        
    const session = userSessions[chatId] || {};
    const cityText = session.cidade ? `📍 Cidade: ${session.cidade}` : "📍 Definir Cidade";
    const neighborhoodText = session.bairro ? `🏘️ Bairro: ${session.bairro}` : "🏘️ Definir Bairro";

    const keyboard = [
        [{ text: "🔍 Nova Busca" }, { text: "📷 Abrir Scanner", web_app: { url: miniAppUrl } }],
        [{ text: cityText }, { text: neighborhoodText }],
        [{ text: "🧹 Limpar Tudo" }, { text: "❓ Ajuda" }]
    ];

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

    if (text && text.startsWith("🏘️ Bairro:")) {
        if (userSessions[chatId]) userSessions[chatId].bairro = null;
        return bot.sendMessage(chatId, "🏘️ Filtro de bairro removido.", getMenuKeyboard(chatId));
    }

    if (text === "🧹 Limpar Tudo") {
        delete userSessions[chatId];
        return bot.sendMessage(chatId, "✨ Histórico e filtros de cidade/bairro limpos.", getMenuKeyboard(chatId));
    }

    if (text === "❓ Ajuda") {
        return bot.sendMessage(chatId, "💡 *Dicas:*\n- Busque pelo nome do produto (ex: 'Arroz') ou pelo código de barras.\n- Use o Scanner para ler o código direto da embalagem.\n- Filtre pela cidade para encontrar o melhor preço perto de você.\n- 'Limpar Tudo' reseta sua cidade e busca atual.", { parse_mode: 'Markdown' });
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
                    session.step = 'waiting_neighborhood';
                    askForNeighborhood(chatId);
                } else {
                    session.step = 'browsing';
                    await performProductSearch(chatId, session.query, session.isEan, "", "", 0);
                }
            } catch (err) {
                console.error("GPS Error:", err.message);
                session.step = 'browsing';
                await performProductSearch(chatId, session.query, session.isEan, "", "", 0);
            }
            return;
        }
    }

    if (!text || text.startsWith('/')) return;

    let session = userSessions[chatId];
    if (session && session.step === 'waiting_location_or_city') {
        const input = text.toUpperCase().trim();
        if (input === "PULAR FILTRO" || input === "PULAR") {
            session.step = 'browsing';
            await performProductSearch(chatId, session.query, session.isEan, "", "", 0);
        } else {
            const cityInput = normalizeText(text);
            session.cidade = cityInput;
            session.step = 'waiting_neighborhood';
            askForNeighborhood(chatId);
        }
        return;
    }

    if (session && session.step === 'waiting_neighborhood') {
        const input = text.toUpperCase().trim();
        if (input === "PULAR BAIRRO" || input === "TUDO" || input.includes("VER TODA A CIDADE")) {
            session.bairro = null;
            session.step = 'browsing';
            await performProductSearch(chatId, session.query, session.isEan, session.cidade, "", 0);
        } else {
            const bairroInput = normalizeText(text);
            session.bairro = bairroInput;
            session.step = 'browsing';
            await performProductSearch(chatId, session.query, session.isEan, session.cidade, bairroInput, 0);
        }
        return;
    }

    handleSearchInput(chatId, text);
});

async function handleSearchInput(chatId, input) {
    const isEan = /^\d{8,14}$/.test(input.trim());
    const existing = userSessions[chatId];
    
    if (existing && existing.cidade) {
        userSessions[chatId] = { ...existing, step: 'browsing', query: input.trim(), isEan: isEan, offset:0 };
        return await performProductSearch(chatId, input.trim(), isEan, existing.cidade, existing.bairro, 0);
    }

    userSessions[chatId] = { step: 'waiting_location_or_city', query: input.trim(), isEan: isEan, offset:0 };
    bot.sendMessage(chatId, `✅ Produto identificado: *${input.trim()}*.\n\nInforme sua cidade 🏙️ (digite ou envie a localização) para filtrar os melhores preços:`, {
        parse_mode: 'Markdown',
        reply_markup: {
            keyboard: [
                [{ text: "📍 Enviar Localização", request_location: true }],
                [{ text: "🔍 Nova Busca" }, { text: "🧹 Limpar Tudo" }],
                [{ text: "Pular Filtro" }]
            ],
            resize_keyboard: true
        }
    });
}

async function askForNeighborhood(chatId) {
    bot.sendMessage(chatId, "🏘️ Algum *bairro* específico em mente?\n\nDigite o nome do bairro ou clique em 'Ver Toda a Cidade' para uma busca ampla:", {
        parse_mode: 'Markdown',
        reply_markup: {
            keyboard: [
                [{ text: "🏘️ Ver Toda a Cidade" }],
                [{ text: "🔍 Nova Busca" }, { text: "🧹 Limpar Tudo" }]
            ],
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
            await performProductSearch(chatId, s.query, s.isEan, s.cidade, s.bairro, s.offset);
        }
    }
    bot.answerCallbackQuery(cq.id);
});

async function performProductSearch(chatId, query, isEan, cidade, bairro, offset = 0) {
    try {
        const limit = 5;
        let params = [];
        
        let sqlTermo = 'TRUE';
        if (query) {
            const words = query.trim().split(/\s+/);
            const termoConditions = [];
            words.forEach(word => {
                params.push(`%${word}%`);
                termoConditions.push(`(p.descricao ILIKE $${params.length} OR p.codigo_barras ILIKE $${params.length} OR p.ncm ILIKE $${params.length})`);
            });
            sqlTermo = `(${termoConditions.join(' AND ')})`;
        }

        let filtroLoc = '';
        if (cidade) {
            params.push(`%${cidade}%`);
            filtroLoc = ` AND e.municipio ILIKE $${params.length}`;
        }
        if (bairro) {
            params.push(`%${bairro}%`);
            filtroLoc += ` AND e.bairro ILIKE $${params.length}`;
        }

        // QUERY IDENTICA AO SITE (UNION ALL) com NCM
        const queryStr = `
            -- PARTE 1: PERSPECTIVAS 'emitente' OU 'consumidor' -> EXIBE APENAS O EMITENTE
            SELECT p.descricao, p.codigo_barras, p.ncm,
                   e.cnpj AS vendedor_cnpj, e.razao_social AS vendedor_razao_social,
                   e.nome_fantasia AS vendedor_nome_fantasia,
                   e.logradouro AS vendedor_logradouro, e.numero AS vendedor_numero,
                   e.bairro AS vendedor_bairro, e.municipio AS vendedor_cidade, e.uf AS vendedor_uf,
                   nf.data_emissao, nf.chave_acesso, nf.perspectiva_importador
            FROM produtos_nfe p
            JOIN nfe_importadas ni ON p.nfe_id = ni.id
            JOIN notas_fiscais nf  ON ni.chave_acesso = nf.chave_acesso
            JOIN atores a          ON nf.emitente_id = a.id
            JOIN emitentes e       ON a.identificador = e.cnpj
            WHERE e.cnpj IS NOT NULL 
              AND e.cnpj ~ '^[0-9]{14}$'
              AND nf.perspectiva_importador IN ('emitente', 'consumidor')
              AND ${sqlTermo} ${filtroLoc}

            UNION ALL

            -- PARTE 2A: PERSPECTIVA 'revendedor' (Emitente)
            SELECT p.descricao, p.codigo_barras, p.ncm,
                   e.cnpj AS vendedor_cnpj, e.razao_social AS vendedor_razao_social,
                   e.nome_fantasia AS vendedor_nome_fantasia,
                   e.logradouro AS vendedor_logradouro, e.numero AS vendedor_numero,
                   e.bairro AS vendedor_bairro, e.municipio AS vendedor_cidade, e.uf AS vendedor_uf,
                   nf.data_emissao, nf.chave_acesso, nf.perspectiva_importador
            FROM produtos_nfe p
            JOIN nfe_importadas ni ON p.nfe_id = ni.id
            JOIN notas_fiscais nf  ON ni.chave_acesso = nf.chave_acesso
            JOIN atores a          ON nf.emitente_id = a.id
            JOIN emitentes e       ON a.identificador = e.cnpj
            WHERE e.cnpj IS NOT NULL
              AND e.cnpj ~ '^[0-9]{14}$'
              AND nf.perspectiva_importador = 'revendedor'
              AND ${sqlTermo} ${filtroLoc}

            UNION ALL

            -- PARTE 2B: PERSPECTIVA 'revendedor' (Destinatário)
            SELECT p.descricao, p.codigo_barras, p.ncm,
                   d.cnpj AS vendedor_cnpj, d.razao_social AS vendedor_razao_social,
                   NULL AS vendedor_nome_fantasia,
                   d.logradouro AS vendedor_logradouro, d.numero AS vendedor_numero,
                   d.bairro AS vendedor_bairro, d.municipio AS vendedor_cidade, d.uf AS vendedor_uf,
                   nf.data_emissao, nf.chave_acesso, nf.perspectiva_importador
            FROM produtos_nfe p
            JOIN nfe_importadas ni ON p.nfe_id = ni.id
            JOIN notas_fiscais nf  ON ni.chave_acesso = nf.chave_acesso
            JOIN atores a          ON nf.destinatario_id = a.id
            JOIN destinatarios d   ON a.identificador = d.cnpj
            WHERE d.cnpj IS NOT NULL
              AND d.cnpj ~ '^[0-9]{14}$'
              AND nf.perspectiva_importador = 'revendedor'
              AND ${sqlTermo} ${filtroLoc.replace(/e\.municipio/g, 'd.municipio').replace(/e\.bairro/g, 'd.bairro')}

            ORDER BY data_emissao DESC
            LIMIT ${limit} OFFSET ${offset}
        `;

        // Para o COUNT total, precisamos da mesma estrutura de UNION ou simplificar se possível
        // Mas para precisão, melhor usar SUBQUERY
        const totalRes = await pool.query(`SELECT count(*) FROM (${queryStr.split('LIMIT')[0]}) as sub`, params);
        const total = parseInt(totalRes.rows[0].count);

        const dataRes = await pool.query(queryStr, params);
        const rows = dataRes.rows;

        if (rows.length === 0) {
            return bot.sendMessage(chatId, `❌ Nenhum vendedor encontrado para "${query}"${cidade ? ' em ' + cidade : ''}.`, getMenuKeyboard(chatId));
        }

        userSessions[chatId].cidade = cidade || userSessions[chatId].cidade;

        for (const r of rows) {
            const loja = r.vendedor_nome_fantasia || r.vendedor_razao_social || 'Loja';
            const endereco = `${r.vendedor_logradouro || ''}, ${r.vendedor_numero || ''} - ${r.vendedor_bairro || ''}, ${r.vendedor_cidade || ''}/${r.vendedor_uf || ''}`;
            const encodedAddr = encodeURIComponent(endereco);

            const msgText = `📦 *${r.descricao}*\n🆔 EAN: \`${r.codigo_barras || 'N/A'}\` | NCM: \`${r.ncm || 'N/A'}\`\n🏪 *${loja}*\n📂 CNPJ: \`${r.vendedor_cnpj || '---'}\`\n📍 ${r.vendedor_cidade} - ${r.vendedor_bairro || ''}\n🏠 _${endereco}_`;

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
