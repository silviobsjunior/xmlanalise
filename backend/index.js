// backend/index.js
const express = require('express');
const multer = require('multer');
const { createClient } = require('@supabase/supabase-js');
const { Pool } = require('pg');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const xml2js = require('xml2js');
const cors = require('cors');
require('dotenv').config();


// Função para timestamp no formato dd/mm/aaaa hh:mm:ss
function getTimestamp() {
    const now = new Date();
    const day = String(now.getDate()).padStart(2, '0');
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const year = now.getFullYear();
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    return `[${day}/${month}/${year} ${hours}:${minutes}:${seconds}]`;
}

const app = express();

// =============================================
// ENDPOINT PARA CONFIGURAÇÕES PÚBLICAS DO FRONTEND
// =============================================
app.get('/api/config', (req, res) => {
    // Apenas configurações públicas, nunca inclua chaves secretas aqui
    res.json({
        supabaseUrl: process.env.SUPABASE_URL,
        supabaseAnonKey: process.env.SUPABASE_ANON_KEY,
        ambiente: process.env.NODE_ENV || 'development'
    });
});

// Importar o parser atualizado
const NFEParser = require('./parsers/nfe-parser');

// Configuração do Pool PostgreSQL usando POSTGRES_URL
const pool = new Pool({
    connectionString: process.env.POSTGRES_URL,
    ssl: { rejectUnauthorized: false },
    keepAlive: true,
    keepAliveInitialDelayMillis: 10000,
    connectionTimeoutMillis: 10000,
    idleTimeoutMillis: 30000,
    max: 10
});
pool.on('error', (err) => {
    console.error(`${getTimestamp()} ⚠️ Erro inesperado no pool PostgreSQL:`, err.message);
});

// =============================================
// FUNÇÃO PARA GARANTIR QUE USUÁRIO EXISTE NO BANCO LOCAL
// =============================================
// FUNÇÃO PARA GARANTIR QUE USUÁRIO EXISTE NO BANCO LOCAL
// =============================================
async function garantirUsuarioLocal(user, userAgent = null) {
    if (!user || !user.id) return null;

    try {
        // Primeiro, verificar se a tabela usuarios existe
        const tableCheck = await pool.query(`
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_schema = 'public' 
                AND table_name = 'usuarios'
            );
        `);

        if (!tableCheck.rows[0].exists) {
            console.error(`${getTimestamp()} ❌ Tabela 'usuarios' não existe no banco de dados!`);
            return null;
        }

        // Verificar quais colunas existem na tabela
        const columnsCheck = await pool.query(`
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = 'usuarios'
        `);

        const existingColumns = columnsCheck.rows.map(row => row.column_name);
        
        // Garantir que a coluna is_admin existe
        if (!existingColumns.includes('is_admin')) {
            try {
                await pool.query('ALTER TABLE usuarios ADD COLUMN is_admin BOOLEAN DEFAULT FALSE');
                existingColumns.push('is_admin');
                console.log(`${getTimestamp()} ➕ Coluna 'is_admin' adicionada à tabela usuarios`);
            } catch (e) {
                console.error(`${getTimestamp()} ⚠️ Erro ao adicionar coluna is_admin:`, e.message);
            }
        }

        // Verificar se usuário já existe
        const { rows: existingUsers } = await pool.query(
            `SELECT id, is_admin FROM usuarios WHERE id = $1`,
            [user.id]
        );

        if (existingUsers.length === 0) {
            // Usuário não existe, criar
            console.log(`${getTimestamp()} 👤 Criando usuário local:`, user.email);

            const fields = ['id', 'email', 'nome'];
            const values = [user.id, user.email, user.user_metadata?.full_name || user.email];
            const placeholders = ['$1', '$2', '$3'];

            // Admins por padrão
            const isAdmin = user.email === 'contato@santanaecia.com.br' || user.email === 'silviobsjunior@gmail.com';

            if (existingColumns.includes('is_admin')) {
                fields.push('is_admin');
                values.push(isAdmin);
                placeholders.push(`$${values.length}`);
            }

            if (existingColumns.includes('avatar_url')) {
                fields.push('avatar_url');
                values.push(user.user_metadata?.avatar_url || null);
                placeholders.push(`$${values.length}`);
            }

            const insertQuery = `INSERT INTO usuarios (${fields.join(', ')}) VALUES (${placeholders.join(', ')})`;
            await pool.query(insertQuery, values);
            console.log(`${getTimestamp()} ✅ Usuário local criado:`, user.id);
            return { id: user.id, isAdmin };
        } else {
            // Usuário existe, atualizar
            await pool.query(
                `UPDATE usuarios SET ultimo_login = NOW(), updated_at = NOW(), email = $2, nome = $3 WHERE id = $1`,
                [user.id, user.email, user.user_metadata?.full_name || user.email]
            );
            return { id: user.id, isAdmin: existingUsers[0].is_admin || false };
        }
    } catch (error) {
        console.error(`${getTimestamp()} ❌ Erro ao garantir usuário local:`, error.message);
        return null;
    }
}

// Testar conexão com PostgreSQL
pool.connect((err, client, release) => {
    if (err) {
        console.error(`${getTimestamp()} ❌ Erro ao conectar ao PostgreSQL:`, err.stack);
    } else {
        console.log(`${getTimestamp()} ✅ Conectado ao PostgreSQL com sucesso!`);
        release();
    }
});

// Configuração do Supabase Client
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY
);

// Configuração do multer para upload de arquivos
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        const uploadDir = path.join(__dirname, 'uploads');
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + '-' + file.originalname);
    }
});

const upload = multer({
    storage: storage,
    fileFilter: (req, file, cb) => {
        if (file.mimetype === 'text/xml' || file.originalname.endsWith('.xml')) {
            cb(null, true);
        } else {
            cb(new Error('Apenas arquivos XML são permitidos'));
        }
    },
    limits: {
        fileSize: 10 * 1024 * 1024 // 10MB
    }
});

// Configuração CORS
app.use(cors({
    origin: function (origin, callback) {
        // Permitir requisições sem origin (como chamadas internas)
        if (!origin) return callback(null, true);

        const allowedOrigins = [
            'http://localhost:3000',
            'http://localhost:8000',
            'http://127.0.0.1:3000',
            'http://127.0.0.1:8000',
            process.env.FRONTEND_URL,
        ].filter(Boolean);

        const isAllowed = !origin
            || allowedOrigins.includes(origin)
            || origin.startsWith('https://');

        if (isAllowed) {
            callback(null, true);
        } else {
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept'],
    exposedHeaders: ['set-cookie']
}));

// Middlewares
app.use(express.json());
app.use(cookieParser());

// Middleware para servir arquivos estáticos do frontend
app.use(express.static(path.join(__dirname, '../frontend')));

// =============================================
// MIDDLEWARE DE LOGGING DETALHADO COM TIMESTAMP
// =============================================
app.use((req, res, next) => {
    console.log(`\n${getTimestamp()} ${'='.repeat(80)}`);
    console.log(`${getTimestamp()} 📨 ${req.method} ${req.url}`);
    console.log(`${getTimestamp()} Headers:`);
    console.log(`${getTimestamp()}   - Authorization: ${req.headers.authorization ? 'PRESENTE' : 'AUSENTE'}`);
    console.log(`${getTimestamp()}   - Cookie: ${req.headers.cookie ? 'PRESENTE' : 'AUSENTE'}`);
    console.log(`${getTimestamp()}   - User-Agent: ${req.headers['user-agent']}`);
    console.log(`${getTimestamp()}   - Origin: ${req.headers.origin || 'undefined'}`);
    console.log(`${getTimestamp()}   - Referer: ${req.headers.referer || 'undefined'}`);

    if (req.headers.cookie) {
        const cookies = req.headers.cookie.split(';').map(c => c.trim());
        console.log(`${getTimestamp()}   Cookies detalhados:`);
        cookies.forEach(c => {
            if (c.includes('anonymousSessionId')) {
                console.log(`${getTimestamp()}     ✅ ${c}`);
            } else if (c.includes('_sp_id')) {
                console.log(`${getTimestamp()}     🔒 ${c.split('=')[0]}=***`);
            } else {
                console.log(`${getTimestamp()}     - ${c}`);
            }
        });
    }

    next();
});

// =============================================
// MIDDLEWARE DE SESSÃO
// =============================================
app.use(async (req, res, next) => {
    // Pular rotas de config
    if (req.path === '/api/config') {
        return next();
    }

    try {
        // Verificar token no header
        const authHeader = req.headers.authorization;

        if (authHeader && authHeader.startsWith('Bearer ')) {
            const token = authHeader.replace('Bearer ', '');

            try {
                const { data: { user }, error } = await supabase.auth.getUser(token);

                if (user && !error) {
                    // GARANTIR QUE USUÁRIO EXISTE NO BANCO LOCAL
                    const usuarioLocal = await garantirUsuarioLocal(user, req.headers['user-agent']);

                    if (usuarioLocal) {
                        req.userInfo = {
                            type: 'user',
                            id: user.id,
                            email: user.email,
                            name: user.user_metadata?.full_name || user.email,
                            isAdmin: usuarioLocal.isAdmin
                        };
                        return next();
                    }
                }
            } catch (authError) {
                console.error(`${getTimestamp()} ❌ Erro na autenticação:`, authError.message);
            }
        }

        // Se não está logado, gerencia sessão anônima
        let sessionId = req.cookies.anonymousSessionId;

        if (!sessionId) {
            sessionId = crypto.randomUUID();
            res.cookie('anonymousSessionId', sessionId, {
                maxAge: 30 * 24 * 60 * 60 * 1000,
                httpOnly: true,
                secure: req.secure || req.headers['x-forwarded-proto'] === 'https',
                sameSite: 'lax',
                path: '/'
            });
        }

        req.userInfo = {
            type: 'anonymous',
            id: sessionId,
            isAdmin: false
        };

        next();

    } catch (error) {
        console.error(`${getTimestamp()} ❌ ERRO NO MIDDLEWARE DE SESSÃO:`, error.message);
        req.userInfo = {
            type: 'anonymous',
            id: crypto.randomUUID(),
            isAdmin: false
        };
        next();
    }
});

// =============================================
// ENDPOINT PARA CONSULTAR PRODUTOS POR PERÍODO
// =============================================
app.get('/api/produtos/periodo/:periodo', async (req, res) => {
    console.log(`\n${getTimestamp()} 📊 CONSULTANDO PRODUTOS POR PERÍODO`);

    const { periodo } = req.params;
    const { formato = 'json', temporal = 'false', agrupamento } = req.query;

    // Parse período (10m, 1h, 3d, all)
    let dataCorte = null;
    let periodoLabel = 'todos';

    if (periodo !== 'all') {
        const valor = parseInt(periodo.slice(0, -1));
        const unidade = periodo.slice(-1).toLowerCase();

        dataCorte = new Date();

        if (unidade === 'm') {
            dataCorte.setMinutes(dataCorte.getMinutes() - valor);
            periodoLabel = `${valor}m`;
        } else if (unidade === 'h') {
            dataCorte.setHours(dataCorte.getHours() - valor);
            periodoLabel = `${valor}h`;
        } else if (unidade === 'd') {
            dataCorte.setDate(dataCorte.getDate() - valor);
            periodoLabel = `${valor}d`;
        } else {
            return res.status(400).json({
                erro: 'Formato inválido. Use: 10m, 1h, 3d, all'
            });
        }
    }

    try {
        // Consulta SIMPLES: apenas produtos_nfe
        let query = supabase
            .from('produtos_nfe')
            .select('*');

        // Aplicar filtro de período
        if (dataCorte) {
            query = query.gte('created_at', dataCorte.toISOString());
            console.log(`${getTimestamp()} 🕐 Produtos após: ${dataCorte.toISOString()}`);
        }

        const { data, error } = await query;

        if (error) {
            console.error(`${getTimestamp()} ❌ Erro na consulta:`, error);
            throw error;
        }

        const produtos = data || [];
        console.log(`${getTimestamp()} ✅ ${produtos.length} produtos encontrados`);

        // Se for modo temporal (agrupado)
        if (temporal === 'true') {
            // Determinar agrupamento automático
            let intervalo = agrupamento;
            if (!intervalo) {
                if (periodoLabel.includes('m')) intervalo = 'minuto';
                else if (periodoLabel.includes('h')) intervalo = 'hora';
                else if (periodoLabel.includes('d')) {
                    const dias = parseInt(periodoLabel);
                    if (dias >= 30) intervalo = 'mes';
                    else if (dias >= 7) intervalo = 'dia';
                    else intervalo = 'hora';
                } else intervalo = 'dia';
            }

            // Agrupar produtos
            const agrupado = {};

            for (const p of produtos) {
                const created = p.created_at;
                if (!created) continue;

                const dt = new Date(created);
                let chave;

                if (intervalo === 'minuto') {
                    chave = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')} ${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`;
                } else if (intervalo === 'hora') {
                    chave = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')} ${String(dt.getHours()).padStart(2, '0')}:00`;
                } else if (intervalo === 'dia') {
                    chave = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
                } else {
                    chave = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
                }

                agrupado[chave] = (agrupado[chave] || 0) + 1;
            }

            // Calcular estatísticas
            const valores = Object.values(agrupado);
            const media = valores.length ? (valores.reduce((a, b) => a + b, 0) / valores.length).toFixed(1) : 0;
            const maximo = Math.max(...valores, 0);
            const minimo = Math.min(...valores, Infinity);

            // Preparar resultado temporal
            const resultadoTemporal = {
                sucesso: true,
                periodo: periodoLabel,
                intervalo: intervalo,
                total_produtos: produtos.length,
                distribuicao: Object.entries(agrupado)
                    .sort((a, b) => a[0].localeCompare(b[0]))
                    .map(([intervalo, quantidade]) => ({ intervalo, quantidade })),
                estatisticas: {
                    media_por_intervalo: parseFloat(media),
                    maximo_intervalo: maximo,
                    minimo_intervalo: minimo,
                    total_intervalos: Object.keys(agrupado).length
                }
            };

            if (formato === 'csv') {
                let csv = 'intervalo,quantidade\n';
                for (const [intervalo, qtd] of Object.entries(agrupado).sort()) {
                    csv += `"${intervalo}",${qtd}\n`;
                }
                res.header('Content-Type', 'text/csv');
                res.header('Content-Disposition', `attachment; filename=produtos_temporal_${periodoLabel}.csv`);
                return res.send(csv);
            }

            return res.json(resultadoTemporal);
        }

        // Modo SIMPLES - estatísticas
        const porNcm = {};
        const porDescricao = {};

        for (const p of produtos) {
            const ncm = p.ncm || 'SEM_NCM';
            porNcm[ncm] = (porNcm[ncm] || 0) + 1;

            const desc = (p.descricao || 'SEM_DESCRICAO').substring(0, 50);
            porDescricao[desc] = (porDescricao[desc] || 0) + 1;
        }

        // Top NCMs
        const topNcm = Object.entries(porNcm)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)
            .map(([ncm, qtd]) => ({ ncm, quantidade: qtd }));

        // Top Produtos
        const topProdutos = Object.entries(porDescricao)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)
            .map(([desc, qtd]) => ({ descricao: desc, ocorrencias: qtd }));

        // Amostra dos últimos produtos
        const ultimosProdutos = produtos.slice(-5).reverse().map(p => ({
            descricao: p.descricao,
            codigo_barras: p.codigo_barras,
            ncm: p.ncm,
            criado_em: p.created_at
        }));

        const resultado = {
            sucesso: true,
            periodo: periodoLabel,
            data_consulta: new Date().toISOString(),
            total_produtos: produtos.length,
            ncm_distintas: Object.keys(porNcm).length,
            produtos_distintos: Object.keys(porDescricao).length,
            top_ncm: topNcm,
            top_produtos: topProdutos,
            ultimos_produtos: ultimosProdutos,
            estatisticas: {}
        };

        // Calcular médias se houver período
        if (dataCorte) {
            const horas = (new Date() - dataCorte) / (1000 * 3600);
            if (horas < 24) {
                resultado.estatisticas.media_por_hora = (produtos.length / horas).toFixed(1);
            } else {
                const dias = horas / 24;
                resultado.estatisticas.media_por_dia = (produtos.length / dias).toFixed(1);
            }
        }

        // Exportar CSV se solicitado
        if (formato === 'csv') {
            const columns = ['id', 'codigo_barras', 'descricao', 'ncm', 'created_at'];
            let csv = columns.join(',') + '\n';
            for (const p of produtos) {
                const row = columns.map(col => {
                    const val = p[col] || '';
                    return `"${String(val).replace(/"/g, '""')}"`;
                }).join(',');
                csv += row + '\n';
            }
            res.header('Content-Type', 'text/csv');
            res.header('Content-Disposition', `attachment; filename=produtos_${periodoLabel}.csv`);
            return res.send(csv);
        }

        // JSON padrão
        res.json(resultado);

    } catch (error) {
        console.error(`${getTimestamp()} ❌ Erro na consulta:`, error);
        res.status(500).json({
            sucesso: false,
            erro: 'Erro ao consultar produtos',
            detalhes: error.message
        });
    }
});

// =============================================
// ENDPOINT DE DEBUG
// =============================================
app.get('/api/debug-sessao', (req, res) => {
    console.log(`\n${getTimestamp()} 🔍 DEBUG DE SESSÃO`);

    const response = {
        timestamp: new Date().toISOString(),
        userInfo: req.userInfo,
        cookies: req.cookies,
        headers: {
            authorization: req.headers.authorization ? 'PRESENTE' : 'AUSENTE',
            cookie: req.headers.cookie ? 'PRESENTE' : 'AUSENTE',
            userAgent: req.headers['user-agent'],
            origin: req.headers.origin
        }
    };

    console.log(`${getTimestamp()} 📊 Informações da sessão:`, JSON.stringify(response, null, 2));
    res.json(response);
});

// =============================================
// ENDPOINT PARA TESTAR TOKEN
// =============================================
app.get('/api/test-token', async (req, res) => {
    console.log(`\n${getTimestamp()} 🔑 TESTE DE TOKEN`);

    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.json({
            sucesso: false,
            erro: 'Token não fornecido',
            headers: {
                authorization: req.headers.authorization ? 'PRESENTE' : 'AUSENTE'
            }
        });
    }

    const token = authHeader.replace('Bearer ', '');

    try {
        const { data: { user }, error } = await supabase.auth.getUser(token);

        res.json({
            sucesso: !error,
            token_valido: !error,
            usuario: user ? {
                id: user.id,
                email: user.email
            } : null,
            erro: error ? error.message : null
        });

    } catch (error) {
        res.json({
            sucesso: false,
            erro: error.message
        });
    }
});

// =============================================
// ESTATÍSTICAS GERAIS COM CACHE
// =============================================
let statsCache = {
    data: null,
    lastUpdate: null,
    nextUpdate: null
};

app.get('/api/estatisticas-gerais', async (req, res) => {
    const CACHE_DURATION = 60 * 60 * 1000; // 1 hora
    const now = Date.now();

    if (statsCache.data && statsCache.nextUpdate && now < new Date(statsCache.nextUpdate).getTime()) {
        return res.json({ ...statsCache.data, cached: true, lastUpdate: statsCache.lastUpdate, nextUpdate: statsCache.nextUpdate });
    }

    try {
        const { rows: stats } = await pool.query(`
            SELECT 
                (SELECT COUNT(*) FROM produtos_nfe) as total_produtos,
                (SELECT COUNT(*) FROM emitentes) as total_fornecedores,
                (SELECT COUNT(DISTINCT municipio) FROM emitentes WHERE municipio IS NOT NULL AND municipio != '') as total_cidades
        `);

        const data = {
            sucesso: true,
            total_produtos: parseInt(stats[0].total_produtos),
            total_fornecedores: parseInt(stats[0].total_fornecedores),
            total_cidades: parseInt(stats[0].total_cidades)
        };

        statsCache = {
            data: data,
            lastUpdate: new Date(now).toISOString(),
            nextUpdate: new Date(now + CACHE_DURATION).toISOString()
        };

        res.json({ ...data, cached: false, lastUpdate: statsCache.lastUpdate, nextUpdate: statsCache.nextUpdate });
    } catch (error) {
        console.error(`${getTimestamp()} ❌ Erro estatísticas gerais:`, error);
        res.status(500).json({ sucesso: false, erro: 'Erro ao carregar estatísticas' });
    }
});

// =============================================
// ENDPOINT PARA FILTROS DISPONÍVEIS (cidades e bairros)
// =============================================
app.get('/api/filtros-vendedores', async (req, res) => {
    console.log(`\n${getTimestamp()} 🗂️ CARREGANDO FILTROS`);
    try {
        const { rows: cidades } = await pool.query(`
            SELECT DISTINCT e.municipio, e.uf FROM emitentes e
            INNER JOIN atores a ON a.identificador = e.cnpj
            INNER JOIN notas_fiscais nf ON nf.emitente_id = a.id
            WHERE e.municipio IS NOT NULL AND e.municipio != ''
            UNION
            SELECT DISTINCT d.municipio, d.uf FROM destinatarios d
            INNER JOIN atores a ON a.identificador = d.cnpj
            INNER JOIN notas_fiscais nf ON nf.destinatario_id = a.id
            WHERE nf.perspectiva_importador = 'revendedor'
              AND d.municipio IS NOT NULL AND d.municipio != ''
            ORDER BY uf, municipio
        `);
        const { rows: bairros } = await pool.query(`
            SELECT DISTINCT e.bairro, e.municipio, e.uf FROM emitentes e
            INNER JOIN atores a ON a.identificador = e.cnpj
            INNER JOIN notas_fiscais nf ON nf.emitente_id = a.id
            WHERE e.bairro IS NOT NULL AND e.bairro != ''
            UNION
            SELECT DISTINCT d.bairro, d.municipio, d.uf FROM destinatarios d
            INNER JOIN atores a ON a.identificador = d.cnpj
            INNER JOIN notas_fiscais nf ON nf.destinatario_id = a.id
            WHERE nf.perspectiva_importador = 'revendedor'
              AND d.bairro IS NOT NULL AND d.bairro != ''
            ORDER BY municipio, bairro
        `);
        res.json({ sucesso: true, cidades, bairros });
    } catch (error) {
        console.error(`${getTimestamp()} ❌ Erro filtros:`, error);
        res.status(500).json({ sucesso: false, erro: 'Erro ao carregar filtros' });
    }
});

// =============================================
// ENDPOINT PARA BUSCA PÚBLICA DE PRODUTOS/VENDEDORES
//
// Parte 1: emitente → tabela emitentes (perspectiva padrão)
// Parte 2: destinatário revendedor → tabela destinatarios
// LGPD: somente CNPJ
// =============================================
app.get('/api/buscar-produtos', async (req, res) => {
    console.log(`\n${getTimestamp()} 🔍 BUSCA DE PRODUTOS`);
    try {
        const { termo, cidade, bairro } = req.query;
        if (!termo || termo.length < 3)
            return res.status(400).json({ sucesso: false, erro: 'Termo deve ter pelo menos 3 caracteres' });

        const params = [`%${termo}%`];
        let filtroE = '', filtroD = '';
        if (cidade) { params.push(cidade); filtroE += ` AND e.municipio ILIKE $${params.length}`; filtroD += ` AND d.municipio ILIKE $${params.length}`; }
        if (bairro) { params.push(bairro); filtroE += ` AND e.bairro    ILIKE $${params.length}`; filtroD += ` AND d.bairro    ILIKE $${params.length}`; }

        const { rows } = await pool.query(`
            SELECT p.codigo_barras AS cean, p.descricao AS descricao_produto, p.ncm,
                   e.cnpj AS vendedor_cnpj, e.razao_social AS vendedor_razao_social,
                   e.nome_fantasia AS vendedor_nome_fantasia,
                   e.logradouro AS vendedor_logradouro, e.numero AS vendedor_numero,
                   e.complemento AS vendedor_complemento, e.bairro AS vendedor_bairro,
                   e.municipio AS vendedor_cidade, e.uf AS vendedor_uf,
                   e.cep AS vendedor_cep, e.telefone AS vendedor_telefone, nf.data_emissao
            FROM produtos_nfe p
            JOIN nfe_importadas ni ON p.nfe_id = ni.id
            JOIN notas_fiscais nf  ON ni.chave_acesso = nf.chave_acesso
            JOIN atores a          ON nf.emitente_id = a.id
            JOIN emitentes e       ON a.identificador = e.cnpj
            WHERE e.cnpj IS NOT NULL
              AND (p.codigo_barras ILIKE $1 OR p.descricao ILIKE $1) ${filtroE}

            UNION ALL

            SELECT p.codigo_barras AS cean, p.descricao AS descricao_produto, p.ncm,
                   d.cnpj AS vendedor_cnpj, d.razao_social AS vendedor_razao_social,
                   NULL AS vendedor_nome_fantasia,
                   d.logradouro AS vendedor_logradouro, d.numero AS vendedor_numero,
                   d.complemento AS vendedor_complemento, d.bairro AS vendedor_bairro,
                   d.municipio AS vendedor_cidade, d.uf AS vendedor_uf,
                   d.cep AS vendedor_cep, d.telefone AS vendedor_telefone, nf.data_emissao
            FROM produtos_nfe p
            JOIN nfe_importadas ni ON p.nfe_id = ni.id
            JOIN notas_fiscais nf  ON ni.chave_acesso = nf.chave_acesso
            JOIN atores a          ON nf.destinatario_id = a.id
            JOIN destinatarios d   ON a.identificador = d.cnpj
            WHERE nf.perspectiva_importador = 'revendedor'
              AND d.cnpj IS NOT NULL
              AND (p.codigo_barras ILIKE $1 OR p.descricao ILIKE $1) ${filtroD}

            ORDER BY data_emissao DESC LIMIT 300
        `, params);

        const map = new Map();
        rows.forEach(row => {
            const k = row.vendedor_cnpj; if (!k) return;
            if (!map.has(k)) map.set(k, {
                vendedor: {
                    cnpj: row.vendedor_cnpj, razao_social: row.vendedor_razao_social,
                    nome_fantasia: row.vendedor_nome_fantasia,
                    logradouro: row.vendedor_logradouro, numero: row.vendedor_numero,
                    complemento: row.vendedor_complemento, bairro: row.vendedor_bairro,
                    cidade: row.vendedor_cidade, uf: row.vendedor_uf,
                    cep: row.vendedor_cep, telefone: row.vendedor_telefone,
                    ultima_venda: row.data_emissao
                }, produtos: []
            });
            const en = map.get(k);
            if (row.data_emissao > en.vendedor.ultima_venda) en.vendedor.ultima_venda = row.data_emissao;
            if (!en.produtos.some(p => p.cean === row.cean && p.descricao === row.descricao_produto))
                en.produtos.push({ cean: row.cean, descricao: row.descricao_produto, ncm: row.ncm });
        });
        const resultados = Array.from(map.values());
        console.log(`${getTimestamp()} ✅ ${resultados.length} vendedor(es)`);
        res.json({ sucesso: true, quantidade: resultados.length, resultados });
    } catch (error) {
        console.error(`${getTimestamp()} ❌ Erro na busca:`, error);
        res.status(500).json({ sucesso: false, erro: 'Erro ao buscar produtos' });
    }
});

// =============================================
// ENDPOINT PARA NOTAS DO USUÁRIO LOGADO
// =============================================
app.get('/api/minhas-notas', async (req, res) => {
    console.log(`\n${getTimestamp()} 📋 LISTANDO NOTAS DO USUÁRIO`);
    try {
        const userInfo = req.userInfo;
        if (userInfo.type !== 'user')
            return res.status(401).json({ erro: 'É necessário estar logado para ver suas notas' });

        const search = req.query.search || '';
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const perPage = [10, 20, 50, 100].includes(parseInt(req.query.perPage)) ? parseInt(req.query.perPage) : 50;
        const offset = (page - 1) * perPage;
        const baseParams = [userInfo.id];
        let baseWhere = 'nf.usuario_id = $1 AND nf.data_emissao IS NOT NULL';
        if (search) {
            baseParams.push(`%${search}%`);
            baseWhere += ` AND (a_emit.razao_social ILIKE $${baseParams.length} OR nf.numero::text ILIKE $${baseParams.length} OR nf.chave_acesso ILIKE $${baseParams.length})`;
        }
        const { rows: countRows } = await pool.query(`
            SELECT COUNT(*) as total FROM notas_fiscais nf
            LEFT JOIN atores a_emit ON nf.emitente_id = a_emit.id
            WHERE ${baseWhere}`, baseParams);
        const total = parseInt(countRows[0].total);
        const dataParams = [...baseParams, perPage, offset];
        const { rows } = await pool.query(`
            SELECT nf.id, nf.chave_acesso, nf.numero, nf.serie, nf.data_emissao,
                   nf.natureza_operacao, nf.status, nf.perspectiva_importador,
                   a_emit.razao_social AS emitente_nome, a_emit.identificador AS emitente_cnpj,
                   a_dest.razao_social AS destinatario_nome, a_dest.identificador AS destinatario_cnpj,
                   tn.valor_total_nf, tn.valor_icms,
                   COALESCE((SELECT COUNT(*) FROM nfe_importadas ni
                       JOIN produtos_nfe p ON p.nfe_id = ni.id
                       WHERE ni.chave_acesso = nf.chave_acesso), 0) AS quantidade_produtos
            FROM notas_fiscais nf
            LEFT JOIN atores a_emit ON nf.emitente_id = a_emit.id
            LEFT JOIN atores a_dest ON nf.destinatario_id = a_dest.id
            LEFT JOIN totais_nota tn ON nf.id = tn.id_nota_fiscal
            WHERE ${baseWhere}
            ORDER BY nf.data_emissao DESC
            LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}
        `, dataParams);
        res.json({ notas: rows, paginacao: { total, pagina: page, porPagina: perPage, totalPaginas: Math.ceil(total / perPage) } });
    } catch (error) {
        console.error(`${getTimestamp()} ❌ Erro ao listar notas:`, error);
        res.status(500).json({ erro: 'Erro ao buscar dados' });
    }
});

// =============================================
// ENDPOINT PARA DETALHES DE UMA NOTA ESPECÍFICA (RESTRITO)
// =============================================
app.get('/api/minha-nota/:id', async (req, res) => {
    console.log(`\n${getTimestamp()} 📄 BUSCANDO NOTA ESPECÍFICA (RESTRITO)`);
    console.log(`${getTimestamp()} ID:`, req.params.id);

    try {
        const { id } = req.params;
        const userInfo = req.userInfo;

        if (userInfo.type !== 'user') {
            return res.status(401).json({
                erro: 'É necessário estar logado para ver detalhes da nota'
            });
        }

        // Se NÃO for admin, só pode ver se for a PRÓPRIA nota, mas vamos aplicar a restrição solicitada
        let query = `
            SELECT nf.*, 
                   a_emit.razao_social as emitente_nome, 
                   a_emit.identificador as emitente_cnpj,
                   a_emit.inscricao_estadual as emitente_ie,
                   a_dest.razao_social as destinatario_nome, 
                   a_dest.identificador as destinatario_cnpj,
                   a_dest.inscricao_estadual as destinatario_ie
            FROM notas_fiscais nf
            LEFT JOIN atores a_emit ON nf.emitente_id = a_emit.id
            LEFT JOIN atores a_dest ON nf.destinatario_id = a_dest.id
            WHERE nf.id = $1
        `;
        let params = [id];

        if (!userInfo.isAdmin) {
            query += ' AND nf.usuario_id = $2';
            params.push(userInfo.id);
        }

        const { rows } = await pool.query(query, params);

        if (rows.length === 0) {
            return res.status(404).json({ erro: 'Nota fiscal não encontrada ou acesso negado' });
        }

        // RESTRIÇÃO: Apenas ADM vê detalhes conforme solicitado pelo usuário
        if (!userInfo.isAdmin) {
            return res.status(403).json({ 
                erro: 'Acesso restrito', 
                mensagem: 'A visualização detalhada de arquivos está disponível apenas para administradores. Você pode ver o resumo na sua aba de arquivos.' 
            });
        }

        const nota = rows[0];
        const chaveAcesso = nota.chave_acesso;

        const { rows: nfeImportadas } = await pool.query(
            `SELECT id FROM nfe_importadas WHERE chave_acesso = $1`,
            [chaveAcesso]
        );

        if (nfeImportadas.length > 0) {
            const idNfeImportada = nfeImportadas[0].id;

            const { rows: produtos } = await pool.query(
                `SELECT * FROM produtos_nfe WHERE nfe_id = $1 ORDER BY numero_item`,
                [idNfeImportada]
            );
            nota.produtos = produtos;
        } else {
            nota.produtos = [];
        }

        const { rows: totais } = await pool.query(
            `SELECT * FROM totais_nota WHERE id_nota_fiscal = $1`,
            [id]
        );
        nota.totais = totais[0] || {};

        res.json(nota);

    } catch (error) {
        console.error(`${getTimestamp()} ❌ Erro ao buscar nota:`, error);
        res.status(500).json({ erro: 'Erro ao buscar nota fiscal' });
    }
});

// =============================================
// ENDPOINT PARA ESTATÍSTICAS DO USUÁRIO
// =============================================
app.get('/api/minhas-estatisticas', async (req, res) => {
    console.log(`\n${getTimestamp()} 📊 ESTATÍSTICAS DO USUÁRIO`);
    console.log(`${getTimestamp()} Usuário:`, req.userInfo);

    try {
        const userInfo = req.userInfo;

        if (userInfo.type !== 'user') {
            console.log(`${getTimestamp()} ❌ Tentativa de acesso não autorizado`);
            return res.status(401).json({
                erro: 'É necessário estar logado para ver estatísticas'
            });
        }

        const query = `
            SELECT 
                COUNT(DISTINCT nf.id) as total_notas,
                COALESCE(SUM(tn.valor_total_nf), 0) as valor_total_notas,
                COALESCE(SUM(tn.valor_icms), 0) as total_icms,
                COUNT(DISTINCT nf.emitente_id) as total_emitentes_distintos,
                COUNT(DISTINCT nf.destinatario_id) as total_destinatarios_distintos,
                COALESCE((
                    SELECT COUNT(p.id)
                    FROM nfe_importadas ni
                    JOIN produtos_nfe p ON p.nfe_id = ni.id
                    WHERE ni.chave_acesso IN (
                        SELECT chave_acesso FROM notas_fiscais WHERE usuario_id = $1
                    )
                ), 0) as total_itens,
                MAX(nf.created_at) as ultima_importacao
            FROM notas_fiscais nf
            LEFT JOIN totais_nota tn ON nf.id = tn.id_nota_fiscal
            WHERE nf.usuario_id = $1
        `;

        const { rows } = await pool.query(query, [userInfo.id]);
        console.log(`${getTimestamp()} ✅ Estatísticas calculadas`);

        res.json(rows[0] || {
            total_notas: 0,
            valor_total_notas: 0,
            total_icms: 0,
            total_emitentes_distintos: 0,
            total_destinatarios_distintos: 0,
            total_itens: 0,
            ultima_importacao: null
        });

    } catch (error) {
        console.error(`${getTimestamp()} ❌ Erro nas estatísticas:`, error);
        res.status(500).json({ erro: 'Erro ao gerar estatísticas' });
    }
});

// =============================================
// ENDPOINT PARA PROCESSAR XML (UPLOAD)
// =============================================
app.post('/api/processar-xml', upload.single('xml'), async (req, res) => {
    console.log(`\n${getTimestamp()} ${'='.repeat(80)}`);
    console.log(`${getTimestamp()} 📦 PROCESSANDO XML`);
    console.log(`${getTimestamp()} Arquivo:`, req.file?.originalname);
    console.log(`${getTimestamp()} Tamanho:`, req.file?.size);
    console.log(`${getTimestamp()} Usuário:`, req.userInfo);

    const startTime = Date.now();
    const client = await pool.connect();
    // Sem este handler, ETIMEDOUT/ECONNRESET derruba o processo inteiro
    client.on('error', (err) => {
        console.error(`${getTimestamp()} ⚠️ Erro no client (processar-xml):`, err.message);
    });

    try {
        const xmlFile = req.file;
        const userInfo = req.userInfo;

        if (!xmlFile) {
            return res.status(400).json({
                sucesso: false,
                erro: 'Arquivo XML não fornecido'
            });
        }

        await client.query('BEGIN');

        console.log(`${getTimestamp()} 📖 Lendo arquivo XML...`);
        const xmlContent = fs.readFileSync(xmlFile.path, 'utf-8');
        const parser = new xml2js.Parser({
            explicitArray: false,
            trim: true,
            normalize: true,
            normalizeTags: true
        });

        const resultado = await parser.parseStringPromise(xmlContent);
        console.log(`${getTimestamp()} ✅ XML parseado com sucesso`);

        console.log(`${getTimestamp()} 🔍 Extraindo dados completos da NF-e...`);
        const nfeData = new NFEParser(resultado).extrairDadosCompletos();
        console.log(`${getTimestamp()} 📊 Dados extraídos:`, Object.keys(nfeData));

        // =============================================
        // 1. INSERIR EMITENTE
        // =============================================
        let idEmitenteInt = null;
        if (nfeData.emitente && (nfeData.emitente.cnpj || nfeData.emitente.cpf)) {
            const emitente = nfeData.emitente;
            const endereco = emitente.endereco || {};

            const emitenteExistente = await client.query(
                `SELECT id FROM emitentes WHERE cnpj = $1 OR cpf = $2`,
                [emitente.cnpj, emitente.cpf]
            );

            if (emitenteExistente.rows.length > 0) {
                idEmitenteInt = emitenteExistente.rows[0].id;
                console.log(`${getTimestamp()} 🏢 Emitente já existe com ID: ${idEmitenteInt}`);
            } else {
                const result = await client.query(
                    `INSERT INTO emitentes (
                        cnpj, cpf, razao_social, nome_fantasia, inscricao_estadual,
                        inscricao_estadual_st, inscricao_municipal, cnae,
                        logradouro, numero, complemento, bairro, codigo_municipio,
                        municipio, uf, cep, codigo_pais, pais, telefone,
                        criado_em, atualizado_em
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, NOW(), NOW())
                    RETURNING id`,
                    [
                        emitente.cnpj, emitente.cpf, emitente.razao_social, emitente.nome_fantasia,
                        emitente.inscricao_estadual, emitente.inscricao_estadual_st,
                        emitente.inscricao_municipal, emitente.cnae,
                        endereco.logradouro, endereco.numero, endereco.complemento,
                        endereco.bairro, endereco.codigo_municipio, endereco.municipio,
                        endereco.uf, endereco.cep, endereco.codigo_pais, endereco.pais,
                        endereco.telefone
                    ]
                );
                idEmitenteInt = result.rows[0].id;
                console.log(`${getTimestamp()} ✅ Emitente inserido com ID: ${idEmitenteInt}`);
            }
        }

        // =============================================
        // 2. INSERIR DESTINATÁRIO — LGPD: CPF → CONSUMIDOR_FINAL
        // =============================================
        let idDestinatarioInt = null;
        const destDoc = nfeData.destinatario?.cnpj || nfeData.destinatario?.cpf || nfeData.destinatario?.id_estrangeiro;
        const destTemCPF = !!(nfeData.destinatario?.cpf) || (destDoc && destDoc.replace(/\D/g, '').length === 11);
        if (destTemCPF) console.log(`${getTimestamp()} 🔒 LGPD: Destinatário CPF — usando CONSUMIDOR_FINAL`);
        if (!destTemCPF && nfeData.destinatario && (nfeData.destinatario.cnpj || nfeData.destinatario.cpf || nfeData.destinatario.id_estrangeiro)) {
            const destinatario = nfeData.destinatario;
            const endereco = destinatario.endereco || {};

            const destinatarioExistente = await client.query(
                `SELECT id FROM destinatarios WHERE cnpj = $1 OR cpf = $2 OR id_estrangeiro = $3`,
                [destinatario.cnpj, destinatario.cpf, destinatario.id_estrangeiro]
            );

            if (destinatarioExistente.rows.length > 0) {
                idDestinatarioInt = destinatarioExistente.rows[0].id;
                console.log(`${getTimestamp()} 👤 Destinatário já existe com ID: ${idDestinatarioInt}`);
            } else {
                const result = await client.query(
                    `INSERT INTO destinatarios (
                        cnpj, cpf, id_estrangeiro, razao_social, inscricao_estadual,
                        indicador_ie, inscricao_municipal, email,
                        logradouro, numero, complemento, bairro, codigo_municipio,
                        municipio, uf, cep, codigo_pais, pais, telefone,
                        criado_em, atualizado_em
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, NOW(), NOW())
                    RETURNING id`,
                    [
                        destinatario.cnpj, destinatario.cpf, destinatario.id_estrangeiro,
                        destinatario.razao_social, destinatario.inscricao_estadual,
                        destinatario.indicador_ie, destinatario.inscricao_municipal, destinatario.email,
                        endereco.logradouro, endereco.numero, endereco.complemento,
                        endereco.bairro, endereco.codigo_municipio, endereco.municipio,
                        endereco.uf, endereco.cep, endereco.codigo_pais, endereco.pais,
                        endereco.telefone
                    ]
                );
                idDestinatarioInt = result.rows[0].id;
                console.log(`${getTimestamp()} ✅ Destinatário inserido com ID: ${idDestinatarioInt}`);
            }
        }

        // =============================================
        // 3. CRIAR/OBTER UUIDs NA TABELA ATORES
        // =============================================

        let emitenteUUID = null;
        if (idEmitenteInt && nfeData.emitente) {
            const emitente = nfeData.emitente;
            const documento = emitente.cnpj || emitente.cpf;
            const tipoDoc = emitente.cnpj ? 'CNPJ' : 'CPF';

            const atorExistente = await client.query(
                `SELECT id FROM atores WHERE identificador = $1`,
                [documento]
            );

            if (atorExistente.rows.length > 0) {
                emitenteUUID = atorExistente.rows[0].id;
                console.log(`${getTimestamp()} 🏢 UUID do emitente encontrado em atores: ${emitenteUUID}`);
            } else {
                const result = await client.query(
                    `INSERT INTO atores (
                        tipo_identificador, identificador, razao_social, 
                        nome_fantasia, inscricao_estadual, inscricao_municipal, tipo_pessoa,
                        created_at, updated_at
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
                    RETURNING id`,
                    [
                        tipoDoc,
                        documento,
                        emitente.razao_social,
                        emitente.nome_fantasia,
                        emitente.inscricao_estadual,
                        emitente.inscricao_municipal,
                        'JURIDICA'
                    ]
                );
                emitenteUUID = result.rows[0].id;
                console.log(`${getTimestamp()} ✅ UUID do emitente criado em atores: ${emitenteUUID}`);
            }
        }

        let destinatarioUUID = null;
        if (idDestinatarioInt && nfeData.destinatario) {
            const destinatario = nfeData.destinatario;
            const documento = destinatario.cnpj || destinatario.cpf || destinatario.id_estrangeiro;
            let tipoDoc = 'OUT';
            if (destinatario.cnpj) tipoDoc = 'CNPJ';
            else if (destinatario.cpf) tipoDoc = 'CPF';

            const atorExistente = await client.query(
                `SELECT id FROM atores WHERE identificador = $1`,
                [documento]
            );

            if (atorExistente.rows.length > 0) {
                destinatarioUUID = atorExistente.rows[0].id;
                console.log(`${getTimestamp()} 👤 UUID do destinatário encontrado em atores: ${destinatarioUUID}`);
            } else {
                const tipoPessoa = destinatario.cnpj ? 'JURIDICA' : (destinatario.cpf ? 'FISICA' : 'ESTRANGEIRO');

                const result = await client.query(
                    `INSERT INTO atores (
                        tipo_identificador, identificador, razao_social, 
                        nome_fantasia, inscricao_estadual, tipo_pessoa,
                        created_at, updated_at
                    ) VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
                    RETURNING id`,
                    [
                        tipoDoc,
                        documento,
                        destinatario.razao_social,
                        destinatario.razao_social,
                        destinatario.inscricao_estadual,
                        tipoPessoa
                    ]
                );
                destinatarioUUID = result.rows[0].id;
                console.log(`${getTimestamp()} ✅ UUID do destinatário criado em atores: ${destinatarioUUID}`);
            }
        }

        // =============================================
        // 4. INSERIR NOTA FISCAL
        // =============================================
        const nota = nfeData.nota_fiscal || {};

        if (!destinatarioUUID) {
            const modeloNota = nota.modelo || resultado?.nfeproc?.nfe?.infnfe?.ide?.mod || resultado?.nfe?.infnfe?.ide?.mod;
            const isNFCe = String(modeloNota) === '65';
            console.log(`${getTimestamp()} 👤 Destinatário não identificado${isNFCe ? ' (NFC-e)' : ''} — usando CONSUMIDOR_FINAL`);
            const atorConsumidor = await client.query(`SELECT id FROM atores WHERE identificador = 'CONSUMIDOR_FINAL' LIMIT 1`);
            if (atorConsumidor.rows.length > 0) {
                destinatarioUUID = atorConsumidor.rows[0].id;
            } else {
                const result = await client.query(
                    `INSERT INTO atores (tipo_identificador, identificador, razao_social, nome_fantasia, tipo_pessoa, created_at, updated_at)
                     VALUES ('OUT', 'CONSUMIDOR_FINAL', 'Consumidor Final Não Identificado', 'Consumidor Final', 'FISICA', NOW(), NOW())
                     RETURNING id`
                );
                destinatarioUUID = result.rows[0].id;
            }
        }

        let usuarioId = userInfo.type === 'user' ? userInfo.id : null;
        let sessaoAnonimaId = userInfo.type === 'anonymous' ? userInfo.id : null;

        console.log(`${getTimestamp()}   usuarioId: ${usuarioId}, sessaoAnonimaId: ${sessaoAnonimaId}`);

        let valorTotalNota = parseFloat(nota.valor_total) || null;
        if (!valorTotalNota && nfeData.totais) {
            valorTotalNota = parseFloat(nfeData.totais.valor_total_nf) || null;
        }

        const resultNota = await client.query(
            `INSERT INTO notas_fiscais (
                chave_acesso, numero, serie, data_emissao, data_entrada_saida,
                natureza_operacao, tipo_operacao, finalidade, consumidor_final,
                presenca_comprador, processo_emissao, versao_processo,
                status, protocolo_autorizacao, data_autorizacao,
                emitente_id, destinatario_id,
                usuario_id, sessao_anonima_id, perspectiva_importador, valor_total_nota,
                created_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, NOW())
            RETURNING id`,
            [
                nota.chave_acesso,
                nota.numero != null ? parseInt(nota.numero) : null,
                nota.serie != null ? parseInt(nota.serie) : null,
                nota.data_emissao,
                nota.data_saida_entrada,
                nota.natureza_operacao,
                nota.tipo_operacao != null ? parseInt(nota.tipo_operacao) : null,
                1,
                true,
                0,
                1,
                '4.00',
                nota.status || 'AUTORIZADA',
                nota.protocolo,
                new Date().toISOString(),
                emitenteUUID,
                destinatarioUUID,
                usuarioId,
                sessaoAnonimaId,
                req.body?.perspectiva || 'emitente',
                valorTotalNota
            ]
        );

        const idNotaFiscalUUID = resultNota.rows[0].id;
        console.log(`${getTimestamp()} ✅ Nota fiscal inserida com UUID: ${idNotaFiscalUUID}`);

        // =============================================
        // 5. CRIAR/REUTILIZAR REGISTRO NA TABELA NFE_IMPORTADAS
        // =============================================
        let idNfeImportada = null;
        const nfeExistente = await client.query(
            `SELECT id FROM nfe_importadas WHERE chave_acesso = $1 LIMIT 1`, [nota.chave_acesso]
        );
        if (nfeExistente.rows.length > 0) {
            idNfeImportada = nfeExistente.rows[0].id;
            console.log(`${getTimestamp()} ♻️  nfe_importadas reutilizada: ${idNfeImportada}`);
        } else {
            const r = await client.query(
                `INSERT INTO nfe_importadas (chave_acesso, numero, serie, data_emissao, created_at)
                 VALUES ($1, $2, $3, $4, NOW()) RETURNING id`,
                [nota.chave_acesso,
                nota.numero != null ? parseInt(nota.numero) : null,
                nota.serie != null ? parseInt(nota.serie) : null,
                nota.data_emissao]
            );
            idNfeImportada = r.rows[0].id;
            console.log(`${getTimestamp()} ✅ nfe_importadas criada: ${idNfeImportada}`);
        }
        // =============================================
        // 6. INSERIR PRODUTOS (reutiliza se já existem; ignora cEAN "SEM GTIN")
        // =============================================
        if (nfeData.produtos && Array.isArray(nfeData.produtos) && nfeData.produtos.length > 0) {
            const prodExist = await client.query(
                `SELECT COUNT(*) as total FROM produtos_nfe WHERE nfe_id = $1`, [idNfeImportada]
            );
            if (parseInt(prodExist.rows[0].total) > 0) {
                console.log(`${getTimestamp()} ♻️  Produtos já existem para nfe_id ${idNfeImportada} — ignorados`);
            } else {
                for (const produto of nfeData.produtos) {
                    const cean = produto.codigo_barras && produto.codigo_barras !== 'SEM GTIN'
                        ? produto.codigo_barras : null;
                    await client.query(
                        `INSERT INTO produtos_nfe (nfe_id, numero_item, codigo_produto, codigo_barras,
                            descricao, ncm, cfop, quantidade, valor_unitario, valor_total, created_at)
                         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW())`,
                        [idNfeImportada, produto.numero_item, produto.codigo_produto, cean,
                            produto.descricao, produto.ncm, produto.cfop,
                            parseFloat(produto.quantidade_comercial || produto.quantidade) || 0,
                            parseFloat(produto.valor_unitario_comercial || produto.valor_unitario) || 0,
                            parseFloat(produto.valor_total) || 0]
                    );
                }
                console.log(`${getTimestamp()} ✅ ${nfeData.produtos.length} produtos salvos`);
            }
        }

        // =============================================
        // 7. INSERIR TOTAIS DA NOTA
        // =============================================
        if (nfeData.totais && Object.keys(nfeData.totais).length > 0) {
            const totais = nfeData.totais;

            await client.query(
                `INSERT INTO totais_nota (
                    id_nota_fiscal, base_calculo_icms, valor_icms, valor_icms_deson,
                    valor_fcp, base_calculo_icms_st, valor_icms_st, valor_total_produtos,
                    valor_frete, valor_seguro, valor_desconto, valor_ii, valor_ipi,
                    valor_pis, valor_cofins, valor_outras_despesas, valor_total_nf,
                    valor_tributos_aprox, criado_em, atualizado_em
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, NOW(), NOW())`,
                [
                    idNotaFiscalUUID,
                    parseFloat(totais.base_calculo_icms) || null,
                    parseFloat(totais.valor_icms) || null,
                    parseFloat(totais.valor_icms_deson) || null,
                    parseFloat(totais.valor_fcp) || null,
                    parseFloat(totais.base_calculo_icms_st) || null,
                    parseFloat(totais.valor_icms_st) || null,
                    parseFloat(totais.valor_total_produtos) || null,
                    parseFloat(totais.valor_frete) || null,
                    parseFloat(totais.valor_seguro) || null,
                    parseFloat(totais.valor_desconto) || null,
                    parseFloat(totais.valor_ii) || null,
                    parseFloat(totais.valor_ipi) || null,
                    parseFloat(totais.valor_pis) || null,
                    parseFloat(totais.valor_cofins) || null,
                    parseFloat(totais.valor_outras_despesas) || null,
                    parseFloat(totais.valor_total_nf) || null,
                    parseFloat(totais.valor_tributos_aprox) || null
                ]
            );
            console.log(`${getTimestamp()} ✅ Totais da nota salvos`);
        }

        // =============================================
        // 8. COMMIT DA TRANSAÇÃO
        // =============================================
        await client.query('COMMIT');
        console.log(`${getTimestamp()} 💾 Transação confirmada com sucesso!`);

        fs.unlinkSync(xmlFile.path);
        console.log(`${getTimestamp()} 🗑️ Arquivo temporário removido`);

        const processTime = Date.now() - startTime;
        console.log(`${getTimestamp()} ✅ XML processado com sucesso em ${processTime}ms`);

        res.json({
            sucesso: true,
            id_nota_fiscal: idNotaFiscalUUID,
            id_nfe_importada: idNfeImportada,
            tipo_usuario: userInfo.type,
            usuario_id: userInfo.type === 'user' ? userInfo.id : null,
            quantidade_produtos: nfeData.produtos?.length || 0,
            tempo_processamento: processTime
        });

    } catch (error) {
        await client.query('ROLLBACK');
        if (req.file) { try { fs.unlinkSync(req.file.path); } catch (e) { } }
        if (error.code === '23505' && (
            error.constraint === 'notas_fiscais_unique_por_importador' ||
            error.constraint === 'notas_fiscais_unique_anonimo' ||
            error.constraint === 'notas_fiscais_chave_acesso_key'
        )) {
            const chave = error.detail?.match(/\(chave_acesso\)=\(([^)]+)\)/)?.[1] || '';
            console.log(`${getTimestamp()} ⚠️ Nota duplicada (mesma perspectiva): ${chave}`);
            return res.status(409).json({
                sucesso: false, duplicado: true,
                erro: 'Nota fiscal já existe com esta perspectiva para este usuário', chave_acesso: chave
            });
        }
        console.error(`${getTimestamp()} ❌ Erro ao processar XML:`, error);
        res.status(500).json({ sucesso: false, erro: 'Erro ao processar arquivo XML', detalhes: error.message });
    } finally {
        client.release();
    }
});

// =============================================
// ENDPOINT PARA MIGRAR DADOS ANÔNIMOS
// =============================================
app.post('/api/migrar-dados-anonimos', async (req, res) => {
    console.log(`${getTimestamp()} 🔄 Iniciando migração de dados anônimos...`);

    try {
        const { sessionId } = req.body;
        const authHeader = req.headers.authorization;

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({
                sucesso: false,
                erro: 'Usuário não autenticado'
            });
        }

        const token = authHeader.replace('Bearer ', '');
        const { data: { user }, error: userError } = await supabase.auth.getUser(token);

        if (userError || !user) {
            return res.status(401).json({
                sucesso: false,
                erro: 'Token inválido ou expirado'
            });
        }

        if (!sessionId) {
            return res.status(400).json({
                sucesso: false,
                erro: 'SessionId não fornecido'
            });
        }

        const client = await pool.connect();
        client.on('error', (err) => {
            console.error(`${getTimestamp()} ⚠️ Erro no client (migração):`, err.message);
        });

        try {
            await client.query('BEGIN');

            const { rows: checkRows } = await client.query(
                `SELECT COUNT(*) as total FROM notas_fiscais 
                 WHERE sessao_anonima_id = $1 AND usuario_id IS NULL`,
                [sessionId]
            );

            const quantidadeParaMigrar = parseInt(checkRows[0]?.total || '0');

            if (quantidadeParaMigrar === 0) {
                await client.query('COMMIT');
                return res.json({
                    sucesso: true,
                    quantidade_migrada: 0,
                    mensagem: 'Nenhum dado para migrar'
                });
            }

            const { rows } = await client.query(
                `UPDATE notas_fiscais 
                 SET usuario_id = $1, sessao_anonima_id = NULL, migrado_em = NOW()
                 WHERE sessao_anonima_id = $2 AND usuario_id IS NULL
                 RETURNING id`,
                [user.id, sessionId]
            );

            await client.query(
                `INSERT INTO migracoes_dados (user_id, session_id_origem, quantidade_registros, data_migracao, email_usuario)
                 VALUES ($1, $2, $3, $4, $5)`,
                [user.id, sessionId, rows.length, new Date().toISOString(), user.email]
            );

            await client.query('COMMIT');

            console.log(`${getTimestamp()} ✅ Migração concluída: ${rows.length} registros migrados`);

            res.json({
                sucesso: true,
                quantidade_migrada: rows.length,
                mensagem: `${rows.length} nota(s) fiscal(is) migrada(s) com sucesso`
            });

        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }

    } catch (error) {
        console.error(`${getTimestamp()} ❌ Erro na migração:`, error);
        res.status(500).json({
            sucesso: false,
            erro: 'Erro interno do servidor',
            detalhes: error.message
        });
    }
});

// =============================================
// ENDPOINT DE SAÚDE DA API
// =============================================
app.get('/api/health', async (req, res) => {
    try {
        const { rows } = await pool.query('SELECT NOW() as time');

        res.json({
            status: 'ok',
            timestamp: new Date().toISOString(),
            banco: 'conectado',
            banco_time: rows[0]?.time,
            ambiente: process.env.NODE_ENV,
            usuario: req.userInfo ? {
                tipo: req.userInfo.type,
                id: req.userInfo.id
            } : null
        });
    } catch (error) {
        res.json({
            status: 'error',
            timestamp: new Date().toISOString(),
            banco: 'desconectado',
            erro: error.message
        });
    }
});

// Rota principal
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

// Tratamento de erros global
app.use((err, req, res, next) => {
    console.error(`${getTimestamp()} ❌ Erro global:`, err);

    if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({
                sucesso: false,
                erro: 'Arquivo muito grande. Tamanho máximo: 10MB'
            });
        }
    }

    res.status(500).json({
        sucesso: false,
        erro: 'Erro interno do servidor',
        mensagem: err.message
    });
});

// Graceful shutdown
process.on('SIGTERM', async () => {
    console.log(`${getTimestamp()} SIGTERM recebido, fechando conexões...`);
    await pool.end();
    process.exit(0);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`\n${getTimestamp()} ${'='.repeat(60)}`);
    console.log(`${getTimestamp()} 🚀 Servidor xmlAnalise rodando`);
    console.log(`${getTimestamp()} ${'='.repeat(60)}`);
    console.log(`${getTimestamp()} 📡 Porta: ${PORT}`);
    console.log(`${getTimestamp()} 🌐 URL: http://localhost:${PORT}`);
    console.log(`${getTimestamp()} 📁 Uploads: ./uploads`);
    console.log(`${getTimestamp()} 🔍 Logging: DETALHADO COM TIMESTAMP`);
    console.log(`${getTimestamp()} 🕒 Iniciado em: ${getTimestamp()}`);
    console.log(`${getTimestamp()} ${'='.repeat(60)}\n`);
});