const fs = require('fs');
const xml2js = require('xml2js');
const NFEParser = require('./backend/parsers/nfe-parser.js');

async function testParse() {
    const xmlPath = 'dados/35260155083591000108550020000370901957077883.xml';
    if (!fs.existsSync(xmlPath)) {
        console.error('Arquivo não encontrado:', xmlPath);
        return;
    }

    const xmlContent = fs.readFileSync(xmlPath, 'utf-8');
    const parser = new xml2js.Parser({
        explicitArray: false,
        trim: true,
        normalize: true,
        normalizeTags: true
    });

    try {
        const resultado = await parser.parseStringPromise(xmlContent);
        console.log('✅ XML parseado com xml2js');

        const nfeParser = new NFEParser(resultado);
        const nfeData = nfeParser.extrairDadosCompletos();
        
        console.log('✅ Dados extraídos com sucesso:');
        console.log('Chave:', nfeData.nota_fiscal.chave_acesso);
        console.log('Emitente:', nfeData.emitente.razao_social);
        console.log('Destinatário:', nfeData.destinatario.razao_social);
        console.log('Qtd Produtos:', nfeData.produtos.length);
        
        if (nfeData.erros_validacao.length > 0) {
            console.log('⚠️  Erros de validação:', nfeData.erros_validacao);
        }
    } catch (err) {
        console.error('❌ Erro no teste:', err.message);
        console.error(err.stack);
    }
}

testParse();
