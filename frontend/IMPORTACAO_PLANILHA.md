# Documentação para Importação via Planilha e Macro XML

Este documento descreve a estrutura da planilha necessária para a importação manual de dados no sistema **AQUI TEM**, bem como o mapeamento dos campos do XML da NF-e para auxiliar na criação de macros de automação.

## 📊 Estrutura da Planilha (Colunas Necessárias)

Para que a busca pública funcione corretamente, os campos marcados com **(Obrigatório)** devem ser preenchidos.

| Coluna | Descrição | Obrigatório | Conteúdo XML (NF-e) |
| :--- | :--- | :--- | :--- |
| **vendedor_cnpj** | CNPJ do Vendedor (apenas números) | Sim | `/infNFe/emit/CNPJ` |
| **vendedor_razao_social** | Razão Social do Vendedor | Sim | `/infNFe/emit/xNome` |
| **vendedor_nome_fantasia** | Nome Fantasia do Vendedor | Não | `/infNFe/emit/xFant` |
| **vendedor_logradouro** | Endereço (Rua, Av, etc) | Sim | `/infNFe/emit/enderEmit/xlgr` |
| **vendedor_numero** | Número do endereço | Sim | `/infNFe/emit/enderEmit/nro` |
| **vendedor_complemento** | Complemento (Sala, Loja, etc) | Não | `/infNFe/emit/enderEmit/xcpl` |
| **vendedor_bairro** | Bairro | Sim | `/infNFe/emit/enderEmit/xBairro` |
| **vendedor_cidade** | Nome do Município | Sim | `/infNFe/emit/enderEmit/xMun` |
| **vendedor_uf** | Sigla do Estado (UF) | Sim | `/infNFe/emit/enderEmit/UF` |
| **vendedor_cep** | CEP (apenas números) | Sim | `/infNFe/emit/enderEmit/CEP` |
| **vendedor_telefone** | Telefone de contato | Não | `/infNFe/emit/enderEmit/fone` |
| **produto_cean** | Código de Barras (EAN/GTIN) | Recomendado | `/infNFe/det/prod/cEAN` |
| **produto_descricao** | Nome/Descrição do Produto | Sim | `/infNFe/det/prod/xProd` |
| **produto_ncm** | Código NCM (8 dígitos) | Sim | `/infNFe/det/prod/NCM` |
| **produto_unidade** | Unidade (UN, KG, LT, etc) | Não | `/infNFe/det/prod/uCom` |
| **produto_quantidade** | Quantidade Comercial | Não (Zero) | `/infNFe/det/prod/qCom` |
| **produto_valor_unitario** | Valor Unitário | Não (Zero) | `/infNFe/det/prod/vUnCom` |
| **produto_valor_total** | Valor Total do Item | Não (Zero) | `/infNFe/det/prod/vProd` |
| **data_emissao** | Data da Venda (AAAA-MM-DD) | Sim | `/infNFe/ide/dhEmi` ou `dEmi` |

## 🛠️ Instruções para a Macro (Excel/VBA ou Google Apps Script)

Ao criar a macro para importar XMLs offline, siga estas diretrizes:

1.  **Loop nos Itens**: Cada arquivo XML de NF-e possui um ou mais itens no caminho `/infNFe/det`. A macro deve percorrer todos os itens.
2.  **Dados do Vendedor**: Os dados do emitente (`/infNFe/emit`) são os mesmos para todos os itens daquela nota.
3.  **GTIN/EAN**: Se o campo `cEAN` contiver "SEM GTIN", deixe a coluna `produto_cean` vazia ou com valor nulo.
4.  **Campos Numéricos**: Se não conseguir extrair valores de quantidade ou preço, insira `0`.
5.  **Datas**: Converta a data de emissão para o formato padrão `AAAA-MM-DD` (ISO 8601).
6.  **Limpeza**: Remova caracteres especiais de CNPJ e CEP (mantenha apenas números).

---
*Documento gerado automaticamente para suporte à integração offline.*
