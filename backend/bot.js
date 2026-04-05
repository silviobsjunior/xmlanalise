// backend/bot.js
const TelegramBot = require('node-telegram-bot-api');
const { Pool } = require('pg');
require('dotenv').config();

const token = process.env.TELEGRAM_BOT_TOKEN;

// Verifica se o token foi configurado para evitar crashes (importante para o Render)
if (!token || token.includes('SEU_TOKEN_AQUI')) {
    console.warn('TELEGRAM_BOT_TOKEN não configurado corretamente. O bot do Telegram não será iniciado.');
    // Retorna algo nulo, pois será instanciado no index.js
    module.exports = null;
    return;
}

// Inicializar bot em modo Polling.
// (Futuramente você pode mudar para webhooks para deploy otimizado no Render)
const bot = new TelegramBot(token, { polling: true });

// Pool do banco PostgreSQL
const pool = new Pool({
    connectionString: process.env.POSTGRES_URL,
    ssl: { rejectUnauthorized: false }
});

// Mapa em memória para guardar o estado da conversa e sessão dos usuários
// Ex: { 1234567: { step: 'waiting_location_or_city', ean: '7891234' } }
const userSessions = {};

// Comando de entrada do Bot
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    // URL do Telegram Mini App
    // No ambiente Render em produção, o RENDER_EXTERNAL_URL deve apontar para o domínio público.
    const miniAppUrl = process.env.RENDER_EXTERNAL_URL
        ? `${process.env.RENDER_EXTERNAL_URL}/scanner.html`
        : 'https://seu-app-no-render.onrender.com/scanner.html'; // Fallback para testar

    bot.sendMessage(chatId, "👋 Olá! Eu sou o *Aqui Tem Bot* baseado no xmlAnalise.\n\nPara verificar o preço/disponibilidade de um produto, você pode:\n1. *Digitar* seu Código de Barras (EAN).\n2. *Acessar o Scanner* no botão abaixo:", {
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [
                [{ text: "📷 Abrir Scanner de Código de Barras", web_app: { url: miniAppUrl } }]
            ]
        }
    });
});

// Botão Recebido do MiniApp web_app_data enviando dados via fechamento
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;

    // Se o retorno veio do Telegram Mini app e enviou a "web_app_data" String
    if (msg.web_app_data) {
        const scannerData = msg.web_app_data.data; // ex: o numero do EAN enviado pelo scanner
        if (/^\d{8,14}$/.test(scannerData)) {
            userSessions[chatId] = { step: 'waiting_location_or_city', ean: scannerData };
            bot.sendMessage(chatId, `✅ EAN lido via Mini App: *${scannerData}*\n\nAgora precisamos filtrar. Envie sua **Localização (GPS)** pelo botão abaixo ou simplesmente **digite o nome da cidade**:`, {
                parse_mode: 'Markdown',
                reply_markup: {
                    keyboard: [
                        [{ text: "📍 Enviar Minha Localização GPS", request_location: true }]
                    ],
                    one_time_keyboard: true,
                    resize_keyboard: true
                }
            });
        } else {
            bot.sendMessage(chatId, "Não entendi o dado que o scanner mandou. Tente digitar o EAN.");
        }
        return;
    }

    // Se recebeu a localização física
    if (msg.location) {
        let session = userSessions[chatId];
        if (session && session.step === 'waiting_location_or_city') {
            const lat = msg.location.latitude;
            const long = msg.location.longitude;

            bot.sendMessage(chatId, `📍 Localização recebida (${lat}, ${long}). Convertendo para cidade (Simulação). Buscando *${session.ean}*...`);

            // Aqui você chamaria o Reverse Geocoding Map API para ter a cidade.
            // Para simplicidade inicial, buscaremos sem filtro exato de localização abaixo.
            await performProductSearch(chatId, session.ean, "");
            delete userSessions[chatId];
        }
        return;
    }

    // Tratamento de Texto
    if (text && !text.startsWith('/')) {
        let session = userSessions[chatId];

        // É um EAN formatado padrão? (usuário digitou em vez do Mini app)
        if (!session && /^\d{8,14}$/.test(text.trim())) {
            userSessions[chatId] = { step: 'waiting_location_or_city', ean: text.trim() };
            return bot.sendMessage(chatId, `✅ EAN *${text.trim()}*.\n\nPara refinar, por favor envie sua **Localização (GPS)** pelo botão abaixo ou **digite o nome da cidade**:`, {
                parse_mode: 'Markdown',
                reply_markup: {
                    keyboard: [
                        [{ text: "📍 Enviar Minha Localização GPS", request_location: true }]
                    ],
                    one_time_keyboard: true,
                    resize_keyboard: true
                }
            });
        }

        // Se estávamos esperando o nome de uma cidade
        if (session && session.step === 'waiting_location_or_city') {
            const cidadeDigitada = text.toUpperCase().trim();

            // Responde removendo o teclado de GPS da tela inicial
            bot.sendMessage(chatId, `Buscando resultados para EAN *${session.ean}* focando na região de *${cidadeDigitada}*...`, {
                parse_mode: 'Markdown',
                reply_markup: { remove_keyboard: true } // Some o botão de localização para não poluir
            });

            await performProductSearch(chatId, session.ean, cidadeDigitada);
            delete userSessions[chatId];
            return;
        }

        // Retorno Fallback
        if (!session) {
            bot.sendMessage(chatId, "Ops! Por favor, digite um Código de Barras (EAN com apenas números) ou use o menu iniciar (/start).");
        }
    }
});

// Inicializar Tabelas Necessárias para o Bot (Ideia: proposta_monitoramento_pesquisa.md)
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

        -- Inserir Dados Iniciais se não existirem
        INSERT INTO itens_monitorados (termo_chave) VALUES 
        ('FARINHA DE TRIGO'), ('LEITE'), ('ARROZ'), ('PAO')
        ON CONFLICT (termo_chave) DO NOTHING;

        -- Sugestões iniciais (Exemplo robusto)
        INSERT INTO sugestoes_contextuais (item_monitorado_id, titulo_popup, conteudo_json, icone_id)
        SELECT id, 'Que tal uma Pizza caseira? 🍕', '{"itens": ["Fermento", "Molho de tomate", "Muzzarella", "Orégano"]}', 'chef-hat'
        FROM itens_monitorados WHERE termo_chave = 'FARINHA DE TRIGO'
        AND NOT EXISTS (SELECT 1 FROM sugestoes_contextuais WHERE item_monitorado_id = itens_monitorados.id);
        
        INSERT INTO sugestoes_contextuais (item_monitorado_id, titulo_popup, conteudo_json, icone_id)
        SELECT id, 'Parceria perfeita! 🥘', '{"itens": ["Feijão", "Óleo", "Sal"]}', 'pot'
        FROM itens_monitorados WHERE termo_chave = 'ARROZ'
        AND NOT EXISTS (SELECT 1 FROM sugestoes_contextuais WHERE item_monitorado_id = itens_monitorados.id);
        `;
        await pool.query(sql);
    } catch (err) {
        console.warn("⚠️ [BOT] Erro ao criar tabelas de monitoramento (provavelmente já existem ou sem permissão).", err.message);
    }
}

// Chamar inicialização
initializeBotTables();

// Pesquisa no DB - mesmas informações exibidas na pesquisa do site
async function performProductSearch(chatId, ean, cidade) {
    try {
        console.log(`[BOT] Buscando EAN: ${ean} em ${cidade || 'qualquer lugar'}`);
        
        // Consulta alinhada com /api/buscar-produtos do site
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
        if (cidade) {
            params.push(cidade.toUpperCase());
            params.push(`%${cidade.toUpperCase()}%`);
            query += ` AND (UPPER(e.municipio) = $${params.length - 1} OR UPPER(e.municipio) LIKE $${params.length})`;
        }
        
        query += ` ORDER BY nf.data_emissao DESC LIMIT 10`;

        const { rows } = await pool.query(query, params);

        if (rows.length === 0) {
            return bot.sendMessage(chatId, `❌ Desculpe, não encontrei registros para o EAN *${ean}*${cidade ? ' na região de *' + cidade + '*' : ''}.`, { parse_mode: 'Markdown' });
        }

        // Agrupar por vendedor (mesmo comportamento do site)
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

        // Montar mensagem com as mesmas infos do site
        let msg = `🔎 *PRODUTO ENCONTRADO*\n\n`;
        msg += `📦 *Produto:* ${descricaoProduto}\n`;
        msg += `🔢 *EAN:* \`${ean}\`\n`;
        if (ncmProduto) msg += `🏷️ *NCM:* ${ncmProduto}\n`;
        msg += `\n🏪 *Vendedores encontrados (${vendedoresMap.size}):*\n`;

        let count = 0;
        for (const [cnpj, v] of vendedoresMap) {
            if (count >= 5) {
                msg += `\n_...e mais ${vendedoresMap.size - 5} vendedor(es)_`;
                break;
            }
            msg += `\n• *${v.nome}*`;
            if (v.bairro || v.cidade) {
                msg += `\n  📍 ${[v.bairro, v.cidade, v.uf].filter(Boolean).join(', ')}`;
            }
            if (v.telefone) {
                msg += `\n  📞 ${v.telefone}`;
            }
            count++;
        }

        bot.sendMessage(chatId, msg, { parse_mode: 'Markdown' });

        // INTEGRAÇÃO: Sugestões Contextuais
        await verificarSugestoesCrossSell(chatId, descricaoProduto);

    } catch (err) {
        console.error("Erro no Bot DB: ", err);
        bot.sendMessage(chatId, "Ocorreu um erro no servidor backend ao buscar os dados da Nota.");
    }
}

// Implementando o conceito da 'proposta_monitoramento_pesquisa.md'
async function verificarSugestoesCrossSell(chatId, produtoNome) {
    try {
        const nomeUpper = produtoNome.toUpperCase();
        
        // Registrar a pesquisa estatística
        await pool.query(
            `INSERT INTO logs_estatisticos_pesquisa (termo_pesquisado, id_usuario_sessao) VALUES ($1, $2)`,
            [nomeUpper, String(chatId)]
        );

        // Buscar se existe algum termo monitorado que "bate" com a descrição
        // Ex: Se tem "FARINHA" monitorado, e o produto é "FARINHA DE TRIGO DONA BENTA"
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
            
            const msg = `💡 *SUGESTÃO DO AQUI TEM*\n\n` +
                        `*${m.titulo_popup}*\n\n` +
                        `Usuários frequentemente relacionam com: _${itensCrossover}_\n\n` +
                        `👉 *Deseja buscar algum desses itens agora?* Basta digitar o nome.`;

            bot.sendMessage(chatId, msg, { parse_mode: 'Markdown' });
            
            // Marcar que exibiu o alerta no último log
            await pool.query(`
                UPDATE logs_estatisticos_pesquisa 
                SET exibiu_alerta = TRUE 
                WHERE id = (SELECT MAX(id) FROM logs_estatisticos_pesquisa WHERE id_usuario_sessao = $1)
            `, [String(chatId)]);
        }
    } catch (err) {
        console.error("Erro ao verificar cross-sell:", err.message);
    }
}

module.exports = bot;
