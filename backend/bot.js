// backend/bot.js
const TelegramBot = require('node-telegram-bot-api');
const { Pool } = require('pg');
require('dotenv').config();

const token = process.env.TELEGRAM_BOT_TOKEN;

// Verifica se o token foi configurado para evitar crashes (importante para o Render)
if (!token || token.includes('SEU_TOKEN_AQUI')) {
    console.warn('TELEGRAM_BOT_TOKEN não configurado corretamente. O bot do Telegram não será iniciado.');
    module.exports = null;
    return;
}

// Inicializar bot em modo Polling.
const bot = new TelegramBot(token, { polling: true });

// Pool do banco PostgreSQL
const pool = new Pool({
    connectionString: process.env.POSTGRES_URL,
    ssl: { rejectUnauthorized: false }
});

// Mapa em memória para guardar o estado da conversa e sessão dos usuários
// { 1234567: { ean: '7891234', cidade: 'JALES', bairro: 'CENTRO', step: '' } }
const userSessions = {};

// Comando de entrada do Bot
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    const miniAppUrl = process.env.RENDER_EXTERNAL_URL
        ? `${process.env.RENDER_EXTERNAL_URL}/scanner.html`
        : 'https://xmlanalise-node.onrender.com/scanner.html';

    bot.sendMessage(chatId, "👋 Olá! Eu sou o *Aqui Tem Bot*.\n\nPara buscar um produto:\n1. **Digite** o Código de Barras (EAN).\n2. **Use o Scanner** no botão abaixo.\n\nApós a busca, você pode filtrar usando:\n🏙️ `/cidade [nome]`\n📍 `/bairro [nome]`\n🌎 `/global` (limpar filtros)", {
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [
                [{ text: "📷 Abrir Scanner de Código de Barras", web_app: { url: miniAppUrl } }]
            ]
        }
    });
});

// Comandos de Filtro
bot.onText(/\/cidade(?:\s+(.+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    const cidade = match[1];

    if (!userSessions[chatId] || !userSessions[chatId].ean) {
        return bot.sendMessage(chatId, "❌ Primeiro, informe o EAN do produto (digite ou use o scanner).");
    }

    if (cidade) {
        userSessions[chatId].cidade = cidade.trim();
        userSessions[chatId].step = '';
        bot.sendMessage(chatId, `🏙️ Filtrando por cidade: *${userSessions[chatId].cidade}*...`, { parse_mode: 'Markdown' });
        await performProductSearch(chatId);
    } else {
        userSessions[chatId].step = 'waiting_city';
        bot.sendMessage(chatId, "🏙️ Por favor, digite o nome da **cidade** para filtrar:");
    }
});

bot.onText(/\/bairro(?:\s+(.+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    const bairro = match[1];

    if (!userSessions[chatId] || !userSessions[chatId].ean) {
        return bot.sendMessage(chatId, "❌ Primeiro, informe o EAN do produto.");
    }

    if (bairro) {
        userSessions[chatId].bairro = bairro.trim();
        userSessions[chatId].step = '';
        bot.sendMessage(chatId, `📍 Filtrando por bairro: *${userSessions[chatId].bairro}*...`, { parse_mode: 'Markdown' });
        await performProductSearch(chatId);
    } else {
        userSessions[chatId].step = 'waiting_neighborhood';
        bot.sendMessage(chatId, "📍 Por favor, digite o nome do **bairro** para filtrar:");
    }
});

bot.onText(/\/global/, async (msg) => {
    const chatId = msg.chat.id;
    if (userSessions[chatId]) {
        userSessions[chatId].cidade = null;
        userSessions[chatId].bairro = null;
        userSessions[chatId].step = '';
        bot.sendMessage(chatId, "🌎 Removendo filtros. Buscando em todas as regiões...");
        await performProductSearch(chatId);
    }
});

// Botão Recebido do MiniApp web_app_data
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;

    if (msg.web_app_data) {
        const scannerData = msg.web_app_data.data;
        if (/^\d{8,14}$/.test(scannerData)) {
            userSessions[chatId] = { ean: scannerData, step: '' };
            bot.sendMessage(chatId, `✅ EAN lido: *${scannerData}*\nBuscando em todas as regiões...`, { parse_mode: 'Markdown' });
            await performProductSearch(chatId);
        }
        return;
    }

    if (msg.location) {
        if (userSessions[chatId] && userSessions[chatId].ean) {
            bot.sendMessage(chatId, "📍 Localização GPS recebida. (Funcionalidade de cidade automática em desenvolvimento). Buscando globalmente por enquanto...");
            await performProductSearch(chatId);
        }
        return;
    }

    if (text && !text.startsWith('/')) {
        let session = userSessions[chatId];

        // Se o usuário digitou um EAN novo
        if (/^\d{8,14}$/.test(text.trim())) {
            userSessions[chatId] = { ean: text.trim(), step: '' };
            bot.sendMessage(chatId, `🔎 Buscando EAN *${text.trim()}*...`, { parse_mode: 'Markdown' });
            return await performProductSearch(chatId);
        }

        // Se estávamos esperando entrada de texto para cidade/bairro após comando sem parâmetro
        if (session) {
            if (session.step === 'waiting_city') {
                session.cidade = text.trim();
                session.step = '';
                return await performProductSearch(chatId);
            }
            if (session.step === 'waiting_neighborhood') {
                session.bairro = text.trim();
                session.step = '';
                return await performProductSearch(chatId);
            }
        }

        if (!session || !session.ean) {
            bot.sendMessage(chatId, "❓ Para começar, digite o Código de Barras (EAN) ou use /start.");
        }
    }
});

async function initializeBotTables() {
    try {
        const sql = `
        CREATE TABLE IF NOT EXISTS itens_monitorados (
            id SERIAL PRIMARY KEY,
            termo_chave VARCHAR(255) NOT NULL UNIQUE,
            ativo BOOLEAN DEFAULT TRUE,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS sugestoes_contextuais (
            id SERIAL PRIMARY KEY,
            item_monitorado_id INTEGER REFERENCES itens_monitorados(id) ON DELETE CASCADE,
            titulo_popup VARCHAR(255) NOT NULL,
            conteudo_json JSONB NOT NULL,
            icone_id VARCHAR(50),
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS logs_estatisticos_pesquisa (
            id SERIAL PRIMARY KEY,
            timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            termo_pesquisado VARCHAR(255) NOT NULL,
            exibiu_alerta BOOLEAN DEFAULT FALSE,
            clicou_alerta BOOLEAN DEFAULT FALSE,
            id_usuario_sessao VARCHAR(255)
        );
        INSERT INTO itens_monitorados (termo_chave) VALUES ('FARINHA DE TRIGO'), ('LEITE'), ('ARROZ'), ('PAO') ON CONFLICT (termo_chave) DO NOTHING;
        `;
        await pool.query(sql);
    } catch (err) {
        console.warn("⚠️ [BOT] Erro ao criar tabelas.", err.message);
    }
}

initializeBotTables();

async function performProductSearch(chatId) {
    const session = userSessions[chatId];
    if (!session || !session.ean) return;

    const { ean, cidade, bairro } = session;

    try {
        let query = `
            SELECT p.codigo_barras AS cean, p.descricao, p.ncm,
                   e.cnpj, e.razao_social, e.nome_fantasia,
                   e.bairro, e.municipio, e.uf, e.telefone,
                   nf.data_emissao
            FROM produtos_nfe p
            JOIN nfe_importadas ni ON p.nfe_id = ni.id
            JOIN notas_fiscais nf  ON ni.chave_acesso = nf.chave_acesso
            JOIN atores a          ON nf.emitente_id = a.id
            JOIN emitentes e       ON a.identificador = e.cnpj
            WHERE e.cnpj IS NOT NULL
              AND e.cnpj ~ '^[0-9]{14}$'
              AND p.codigo_barras = $1
        `;
        
        const params = [ean];
        let paramIndex = 2;

        if (cidade) {
            params.push(cidade.toUpperCase());
            params.push(`%${cidade.toUpperCase()}%`);
            query += ` AND (UPPER(e.municipio) = $${paramIndex} OR UPPER(e.municipio) LIKE $${paramIndex + 1})`;
            paramIndex += 2;
        }

        if (bairro) {
            params.push(`%${bairro.toUpperCase()}%`);
            query += ` AND UPPER(e.bairro) LIKE $${paramIndex}`;
            paramIndex++;
        }
        
        query += ` ORDER BY nf.data_emissao DESC LIMIT 15`;

        const { rows } = await pool.query(query, params);

        if (rows.length === 0) {
            let errorMsg = `❌ Nada encontrado para o EAN *${ean}*`;
            if (cidade) errorMsg += ` na cidade *${cidade}*`;
            if (bairro) errorMsg += ` no bairro *${bairro}*`;
            errorMsg += ".\nTente /global para ver todos ou mudar o filtro.";
            return bot.sendMessage(chatId, errorMsg, { parse_mode: 'Markdown' });
        }

        const vendedoresMap = new Map();
        let descricaoProduto = '';
        let ncmProduto = '';

        rows.forEach(row => {
            if (!descricaoProduto) {
                descricaoProduto = row.descricao;
                ncmProduto = row.ncm;
            }
            const cnpj = row.cnpj;
            if (!vendedoresMap.has(cnpj)) {
                vendedoresMap.set(cnpj, {
                    nome: row.nome_fantasia || row.razao_social,
                    bairro: row.bairro,
                    cidade: row.municipio,
                    uf: row.uf,
                    telefone: row.telefone
                });
            }
        });

        let msg = `🔎 *RESULTADOS PENTENTES*\n`;
        msg += `📦 *Produto:* ${descricaoProduto}\n`;
        msg += `🔢 *EAN:* \`${ean}\`\n\n`;
        
        if (cidade || bairro) {
            msg += `📍 *Filtros ativos:* ${[cidade, bairro].filter(Boolean).join(' > ')}\n\n`;
        }

        msg += `🏪 *Vendedores encontrados (${vendedoresMap.size}):*\n`;

        let count = 0;
        for (const [cnpj, v] of vendedoresMap) {
            if (count >= 8) {
                msg += `\n_...e mais ${vendedoresMap.size - 8}_`;
                break;
            }
            msg += `\n• *${v.nome}*`;
            msg += `\n  📍 ${[v.bairro, v.cidade, v.uf].filter(Boolean).join(', ')}`;
            if (v.telefone) msg += `\n  📞 ${v.telefone}`;
            count++;
        }

        msg += `\n\n💡 _Dica: Use /cidade, /bairro ou /global para ajustar a busca._`;

        bot.sendMessage(chatId, msg, { parse_mode: 'Markdown' });
        await verificarSugestoesCrossSell(chatId, descricaoProduto);

    } catch (err) {
        console.error("Erro no Bot DB: ", err);
        bot.sendMessage(chatId, "Ocorreu um erro ao buscar os dados.");
    }
}

async function verificarSugestoesCrossSell(chatId, produtoNome) {
    try {
        const nomeUpper = produtoNome.toUpperCase();
        await pool.query( `INSERT INTO logs_estatisticos_pesquisa (termo_pesquisado, id_usuario_sessao) VALUES ($1, $2)`, [nomeUpper, String(chatId)] );
        const { rows: matches } = await pool.query(`
            SELECT im.id, im.termo_chave, sc.titulo_popup, sc.conteudo_json 
            FROM itens_monitorados im
            JOIN sugestoes_contextuais sc ON im.id = sc.item_monitorado_id
            WHERE im.ativo = TRUE AND $1 LIKE '%' || im.termo_chave || '%'
            LIMIT 1
        `, [nomeUpper]);

        if (matches.length > 0) {
            const m = matches[0];
            const itensCrossover = m.conteudo_json.itens ? m.conteudo_json.itens.join(', ') : "Diversos";
            const msg = `💡 *SUGESTÃO*\n*${m.titulo_popup}*\nRelacionados: _${itensCrossover}_`;
            bot.sendMessage(chatId, msg, { parse_mode: 'Markdown' });
        }
    } catch (err) {
        console.error("Erro cross-sell:", err.message);
    }
}

module.exports = bot;
