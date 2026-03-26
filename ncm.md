# Guia para Implementação do Filtro NCM no xmlAnalise

## 1. O que é NCM e por que usá-la?

A **Nomenclatura Comum do Mercosul (NCM)** é um sistema de 8 dígitos que classifica mercadorias no Brasil, Argentina, Paraguai e Uruguai. Ela é baseada no Sistema Harmonizado (SH) e usada para:

- Determinar tributos (II, IPI, ICMS, etc.)
- Estatísticas de comércio exterior
- Identificação de produtos para regimes aduaneiros

No xmlAnalise, o NCM já é extraído dos XMLs (campo `NCM` nos produtos). O filtro permitirá:

- Buscar produtos pelo código NCM (parcial ou completo)
- Pesquisar por descrições associadas aos NCMs
- Sugerir NCMs enquanto o usuário digita (autocomplete)

## 2. Estrutura do Código NCM
XX . YY . ZZ . AB
| | | |
| | | +-- Subitem (8º dígito)
| | +------- Item (7º dígito)
| +------------ Subposição (5º e 6º dígitos)
+----------------- Posição (4 primeiros dígitos)


**Exemplo:** `84.17.20.00` – Fornos industriais

| Nível | Dígitos | Exemplo | Descrição |
|-------|---------|---------|-----------|
| Capítulo | 2 | 84 | Reatores nucleares, caldeiras, máquinas |
| Posição | 4 | 8417 | Fornos industriais |
| Subposição | 6 | 841720 | Fornos de padaria |
| Item | 7 | 8417200 | Fornos de padaria (continuos) |
| Subitem | 8 | 84172000 | Fornos de padaria (outros) |

## 3. Fonte de Dados para Autocomplete

A Receita Federal oferece a **NCM On-line** e o **Sistema Classif** (https://www.gov.br/receitafederal/pt-br/assuntos/aduana-e-comercio-exterior/classificacao-fiscal-de-mercadorias/ncm). O backend pode:

1. **Opção A – Arquivo estático local**: Baixar a tabela NCM completa (ex: planilha do governo) e carregar em uma tabela `ncm_referencia` no Supabase.
2. **Opção B – API externa**: Usar APIs não oficiais ou fazer scraping controlado (menos recomendado).
3. **Opção C – Extrair dos próprios XMLs**: Coletar os NCMs e descrições já existentes na base de produtos.

**Recomendação**: Opção A + C. Criar tabela com os NCMs oficiais (atualizada periodicamente) e enriquecer com as descrições mais comuns encontradas nos XMLs.

## 4. Estrutura da Tabela de Referência NCM

```sql
CREATE TABLE ncm_referencia (
    id SERIAL PRIMARY KEY,
    codigo VARCHAR(8) NOT NULL UNIQUE,  -- código NCM completo (8 dígitos)
    descricao TEXT NOT NULL,             -- descrição oficial do NCM
    capitulo VARCHAR(2),                 -- capítulo (2 primeiros dígitos)
    posicao VARCHAR(4),                  -- posição (4 primeiros dígitos)
    subposicao VARCHAR(6),               -- subposição (6 primeiros dígitos)
    created_at TIMESTAMP DEFAULT NOW()
);

-- Índices para busca rápida
CREATE INDEX idx_ncm_codigo ON ncm_referencia(codigo);
CREATE INDEX idx_ncm_descricao ON ncm_referencia USING GIN(to_tsvector('portuguese', descricao));

5. Implementação no Backend (Node.js)
Endpoint de autocomplete NCM

// GET /api/ncm/autocomplete?q=8471&modo=inicio
app.get('/api/ncm/autocomplete', async (req, res) => {
    const { q, modo = 'inicio' } = req.query;
    if (!q || q.length < 2) return res.json([]);

    let query = supabase.from('ncm_referencia').select('codigo, descricao');

    if (modo === 'inicio') {
        // Busca por código começando com
        query = query.ilike('codigo', `${q}%`);
    } else if (modo === 'contem') {
        // Busca por código contendo
        query = query.ilike('codigo', `%${q}%`);
    } else if (modo === 'descricao') {
        // Busca textual na descrição (usando tsvector)
        query = query.textSearch('descricao', q, { config: 'portuguese' });
    }

    const { data, error } = await query.limit(20);
    if (error) return res.status(500).json({ erro: error.message });
    res.json(data);
});

Endpoint de busca de produtos com filtro NCM
Adaptar o endpoint /api/buscar-produtos para aceitar filtro por NCM:

app.get('/api/buscar-produtos', async (req, res) => {
    const { termo, ncm, cidade, bairro } = req.query;
    
    let params = [];
    let conditions = [];
    
    // Filtro textual (nome do produto)
    if (termo && termo.length >= 3) {
        params.push(`%${termo}%`);
        conditions.push(`(p.codigo_barras ILIKE $${params.length} OR p.descricao ILIKE $${params.length})`);
    }
    
    // Filtro NCM
    if (ncm) {
        const ncmLimpo = ncm.replace(/[^0-9]/g, '');
        params.push(`${ncmLimpo}%`);
        conditions.push(`p.ncm ILIKE $${params.length}`);
    }
    
    // Construir WHERE dinamicamente
    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    
    const query = `
        SELECT p.codigo_barras AS cean, p.descricao AS descricao_produto, p.ncm,
               e.cnpj AS vendedor_cnpj, e.razao_social AS vendedor_razao_social,
               e.municipio AS vendedor_cidade, e.uf AS vendedor_uf
        FROM produtos_nfe p
        JOIN nfe_importadas ni ON p.nfe_id = ni.id
        JOIN notas_fiscais nf ON ni.chave_acesso = nf.chave_acesso
        JOIN atores a ON nf.emitente_id = a.id
        JOIN emitentes e ON a.identificador = e.cnpj
        ${whereClause}
        LIMIT 300
    `;
    
    // Executar query com os parâmetros...
});

6. Implementação no Frontend (JavaScript/React)
Input com autocomplete NCM

function NcmAutocomplete({ onSelect }) {
    const [input, setInput] = useState('');
    const [sugestoes, setSugestoes] = useState([]);
    const [carregando, setCarregando] = useState(false);

    useEffect(() => {
        if (input.length < 2) {
            setSugestoes([]);
            return;
        }
        
        const delayDebounce = setTimeout(() => {
            setCarregando(true);
            fetch(`/api/ncm/autocomplete?q=${input}&modo=inicio`)
                .then(res => res.json())
                .then(data => setSugestoes(data))
                .finally(() => setCarregando(false));
        }, 300);
        
        return () => clearTimeout(delayDebounce);
    }, [input]);

    const handleSelect = (ncm) => {
        setInput(ncm.codigo);
        setSugestoes([]);
        if (onSelect) onSelect(ncm);
    };

    return (
        <div className="ncm-autocomplete">
            <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Código NCM ou descrição"
            />
            {carregando && <div>Carregando...</div>}
            {sugestoes.length > 0 && (
                <ul className="sugestoes">
                    {sugestoes.map(s => (
                        <li key={s.codigo} onClick={() => handleSelect(s)}>
                            <strong>{s.codigo}</strong> - {s.descricao}
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}

7. Regras de Busca Recomendadas
Busca por código (padrão inicio):

Usuário digita 84 → Sugere NCMs começando com 84

Pode digitar mais dígitos para refinar: 8417 → mostra apenas fornos

Busca por descrição (modo descricao):

Usuário digita forno → Sugere NCMs com "forno" na descrição

Usa busca textual (tsvector) para português

Combinação com filtro de produtos:

Na busca principal, permitir que o usuário informe um NCM e/ou texto

Exibir resultados de produtos que atendem a ambos os filtros

8. Considerações Finais
Atualização da tabela NCM: O governo atualiza periodicamente. Recomenda-se um script que baixe a última versão e atualize a tabela.

Fallback: Se não houver tabela de referência, o autocomplete pode usar os NCMs já existentes nos produtos (produtos_nfe), mas a descrição será menos rica.

Validação: Aceitar NCMs com ou sem pontos (ex: 84172000 ou 8417.2000). Normalizar antes de buscar.

Exibição: Mostrar o código com pontos para melhor legibilidade (ex: 84.17.20.00), mas armazenar sem pontos.

Documentação oficial:

NCM: https://www.gov.br/receitafederal/pt-br/assuntos/aduana-e-comercio-exterior/classificacao-fiscal-de-mercadorias/ncm

Sistema Classif: https://www.gov.br/receitafederal/pt-br/sistemas/classif


---

Este guia fornece os elementos técnicos e a lógica necessária para que o Gemini/Antigravity implemente o filtro por NCM no xmlAnalise, seguindo as práticas e estrutura definidas pela Receita Federal.