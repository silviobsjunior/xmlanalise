'use strict';

/**
 * NFEParser — extrai dados completos de uma NF-e parseada pelo xml2js
 *
 * Configuração esperada do xml2js:
 *   { explicitArray: false, trim: true, normalize: true, normalizeTags: true }
 *
 * Com normalizeTags: true, todas as tags viram minúsculas:
 *   NFe → nfe, infNFe → infnfe, CNPJ → cnpj, xNome → xnome
 *   Atributos dentro de '$' NÃO são lowercased (Id permanece 'Id')
 */
class NFEParser {
    constructor(xmlObj) {
        this.xml = xmlObj;
        // Suporta nfeProc (procNFe), NFe avulso e variações
        const root = xmlObj?.nfeproc || xmlObj?.nfe || xmlObj;
        const nfe = root?.nfe || root;
        this.inf = nfe?.infnfe || {};
        this.nfeRoot = root;
    }

    // Retorna valor escalar de um caminho de chaves
    _v(obj, ...keys) {
        let cur = obj;
        for (const k of keys) {
            if (cur == null || typeof cur !== 'object') return null;
            cur = cur[k];
        }
        if (cur == null) return null;
        if (typeof cur === 'object' && !Array.isArray(cur)) return null;
        return String(cur).trim() || null;
    }

    _arr(val) {
        if (!val) return [];
        return Array.isArray(val) ? val : [val];
    }

    extrairDadosCompletos() {
        try {
            const inf = this.inf;
            const ide = inf.ide || {};
            const emit = inf.emit || {};
            const dest = inf.dest || {};
            const det = inf.det;
            const icmstot = (inf.total || {}).ictot || {};
            const transp = inf.transp || {};
            const cobr = inf.cobr || {};
            const infadic = inf.infadic || {};

            // Chave: atributo Id do infnfe (xml2js guarda attrs em $, sem lowercase)
            const idAttr = inf?.$ || {};
            const chave = (idAttr.Id || idAttr.id || '').replace(/^NFe/, '') || null;
            const versao = inf?.$?.versao || ide.versao || '4.00';

            console.log(`📋 XML detectado - Versão: ${versao}`);
            console.log(`🔍 Extraindo dados completos da NF-e...`);

            const result = {
                nota_fiscal: this._extrairNota(ide, chave),
                emitente: this._extrairEmitente(emit),
                destinatario: this._extrairDestinatario(dest),
                produtos: this._extrairProdutos(det),
                totais: this._extrairTotais(icmstot),
                transporte: this._extrairTransporte(transp),
                cobranca: this._extrairCobranca(cobr),
                informacoes_adicionais: this._v(infadic, 'infcpl'),
                impostos_produtos: [],
                erros_validacao: [],
            };

            // Validações
            const erros = result.erros_validacao;
            if (!result.nota_fiscal?.chave_acesso) erros.push('Chave de acesso não encontrada');
            if (!result.emitente?.cnpj && !result.emitente?.cpf) erros.push('CNPJ do emitente não encontrado');
            if (!result.emitente?.razao_social) erros.push('Nome do emitente não encontrado');
            if (!result.destinatario?.cnpj && !result.destinatario?.cpf && !result.destinatario?.id_estrangeiro)
                erros.push('CNPJ/CPF/ID Estrangeiro do destinatário não encontrado');
            if (result.produtos.length === 0) erros.push('Nenhum produto encontrado');
            if (erros.length > 0) console.log(`⚠️  Validação encontrou problemas:`, erros);

            const np = result.produtos.length;
            const nt = Object.values(result.totais).filter(Boolean).length;
            console.log(`✅ Extração concluída: ${np} produto${np !== 1 ? 's' : ''}, ${nt} totais`);

            return result;
        } catch (err) {
            console.error('❌ Erro no NFEParser:', err.message);
            throw err;
        }
    }

    _extrairNota(ide, chave) {
        const infprot = (this.nfeRoot?.protnfe || {})?.infprot || {};
        return {
            chave_acesso: chave,
            numero: this._v(ide, 'nnf'),
            serie: this._v(ide, 'serie'),
            modelo: this._v(ide, 'mod'),
            natureza_operacao: this._v(ide, 'natop'),
            tipo_operacao: this._v(ide, 'tpnf'),
            data_emissao: this._v(ide, 'dhemi') || this._v(ide, 'demi'),
            data_saida_entrada: this._v(ide, 'dhsaient') || this._v(ide, 'dsaient'),
            finalidade: this._v(ide, 'finnfe'),
            consumidor_final: this._v(ide, 'indfinal'),
            presenca_comprador: this._v(ide, 'indpres'),
            status: infprot.csit ? 'AUTORIZADA' : 'PROCESSADA',
            protocolo: this._v(infprot, 'nprot'),
        };
    }

    _extrairEmitente(emit) {
        const end = emit.enderemit || {};
        return {
            cnpj: this._v(emit, 'cnpj'),
            cpf: this._v(emit, 'cpf'),
            razao_social: this._v(emit, 'xnome'),
            nome_fantasia: this._v(emit, 'xfant'),
            inscricao_estadual: this._v(emit, 'ie'),
            inscricao_estadual_st: this._v(emit, 'iest'),
            inscricao_municipal: this._v(emit, 'im'),
            cnae: this._v(emit, 'cnae'),
            endereco: {
                logradouro: this._v(end, 'xlgr'),
                numero: this._v(end, 'nro'),
                complemento: this._v(end, 'xcpl'),
                bairro: this._v(end, 'xbairro'),
                codigo_municipio: this._v(end, 'cmun'),
                municipio: this._v(end, 'xmun'),
                uf: this._v(end, 'uf'),
                cep: this._v(end, 'cep'),
                codigo_pais: this._v(end, 'cpais'),
                pais: this._v(end, 'xpais'),
                telefone: this._v(end, 'fone'),
            },
        };
    }

    _extrairDestinatario(dest) {
        if (!dest || Object.keys(dest).length === 0) return {};
        const end = dest.enderdest || {};
        return {
            cnpj: this._v(dest, 'cnpj'),
            cpf: this._v(dest, 'cpf'),
            id_estrangeiro: this._v(dest, 'idestrangeiro'),
            razao_social: this._v(dest, 'xnome'),
            inscricao_estadual: this._v(dest, 'ie'),
            indicador_ie: this._v(dest, 'inddest'),
            inscricao_municipal: this._v(dest, 'im'),
            email: this._v(dest, 'email'),
            endereco: {
                logradouro: this._v(end, 'xlgr'),
                numero: this._v(end, 'nro'),
                complemento: this._v(end, 'xcpl'),
                bairro: this._v(end, 'xbairro'),
                codigo_municipio: this._v(end, 'cmun'),
                municipio: this._v(end, 'xmun'),
                uf: this._v(end, 'uf'),
                cep: this._v(end, 'cep'),
                codigo_pais: this._v(end, 'cpais'),
                pais: this._v(end, 'xpais'),
                telefone: this._v(end, 'fone'),
            },
        };
    }

    _extrairProdutos(det) {
        return this._arr(det).map((item, idx) => {
            const prod = item.prod || {};
            return {
                numero_item: this._v(item, '$', 'nItem') || String(idx + 1),
                codigo_produto: this._v(prod, 'cprod'),
                codigo_barras: this._v(prod, 'cean'),
                descricao: this._v(prod, 'xprod'),
                ncm: this._v(prod, 'ncm'),
                cfop: this._v(prod, 'cfop'),
                unidade_comercial: this._v(prod, 'ucom'),
                quantidade_comercial: this._v(prod, 'qcom'),
                valor_unitario_comercial: this._v(prod, 'vuncom'),
                valor_total: this._v(prod, 'vprod'),
                codigo_barras_tributavel: this._v(prod, 'ceantrib'),
                unidade_tributavel: this._v(prod, 'utrib'),
                quantidade: this._v(prod, 'qtrib'),
                valor_unitario: this._v(prod, 'vuntrib'),
                valor_desconto: this._v(prod, 'vdesc'),
                valor_frete: this._v(prod, 'vfrete'),
                valor_seguro: this._v(prod, 'vseg'),
                valor_outras: this._v(prod, 'voutro'),
            };
        });
    }

    _extrairTotais(t) {
        return {
            base_calculo_icms: this._v(t, 'vbc'),
            valor_icms: this._v(t, 'vicms'),
            valor_icms_deson: this._v(t, 'vicmsdeson'),
            valor_fcp: this._v(t, 'vfcp'),
            base_calculo_icms_st: this._v(t, 'vbcst'),
            valor_icms_st: this._v(t, 'vst'),
            valor_total_produtos: this._v(t, 'vprod'),
            valor_frete: this._v(t, 'vfrete'),
            valor_seguro: this._v(t, 'vseg'),
            valor_desconto: this._v(t, 'vdesc'),
            valor_ii: this._v(t, 'vii'),
            valor_ipi: this._v(t, 'vipi'),
            valor_pis: this._v(t, 'vpis'),
            valor_cofins: this._v(t, 'vcofins'),
            valor_outras_despesas: this._v(t, 'voutro'),
            valor_total_nf: this._v(t, 'vnf'),
            valor_tributos_aprox: this._v(t, 'vtottrib'),
        };
    }

    _extrairTransporte(transp) {
        const vol = transp.vol || {};
        return {
            modalidade_frete: this._v(transp, 'modfrete'),
            volumes: this._v(vol, 'qvol'),
            especie: this._v(vol, 'esp'),
            peso_liquido: this._v(vol, 'pesoliq'),
            peso_bruto: this._v(vol, 'pesobruto'),
        };
    }

    _extrairCobranca(cobr) {
        const fat = cobr.fat || {};
        return {
            fatura_numero: this._v(fat, 'nfat'),
            fatura_valor: this._v(fat, 'vorig'),
            fatura_desconto: this._v(fat, 'vdesc'),
            fatura_liquido: this._v(fat, 'vliq'),
        };
    }
}

module.exports = NFEParser;