# Documentação para Importação via Planilha e Macro XML

Este documento descreve a estrutura da planilha necessária para a importação manual de dados no sistema **AQUI TEM**, bem como o mapeamento dos campos do XML da NF-e para auxiliar na criação de macros de automação.

## 📊 Estrutura da Planilha (Colunas Necessárias)

Para que a busca pública funcione corretamente, os campos marcados com **(Obrigatório)** devem ser preenchidos. Se a macro/planilha não possuir os valores de quantidade ou preço, o sistema adotará **zero (0)** automaticamente.

| Coluna | Descrição | Obrigatório | Conteúdo XML (NF-e) | Formato Esperado |
| :--- | :--- | :--- | :--- | :--- |
| **perspectiva** | Papel no sistema (`vendedor`, `comprador`, `consumidor` ou `ambos`) | Sim | Fixo ou Lógica de Negócio | Texto minúsculo |
| **vendedor_cnpj** | CNPJ do Vendedor (apenas números) | Sim | `/infNFe/emit/CNPJ` | **14 dígitos (obrigatório)** |
| **vendedor_razao_social** | Razão Social do Vendedor | Sim | `/infNFe/emit/xNome` | Texto |
| **vendedor_nome_fantasia** | Nome Fantasia do Vendedor | Não | `/infNFe/emit/xFant` | Texto |
| **vendedor_logradouro** | Endereço (Rua, Av, etc) | Sim | `/infNFe/emit/enderEmit/xlgr` | Texto |
| **vendedor_numero** | Número do endereço | Sim | `/infNFe/emit/enderEmit/nro` | Texto |
| **vendedor_complemento** | Complemento (Sala, Loja, etc) | Não | `/infNFe/emit/enderEmit/xcpl` | Texto |
| **vendedor_bairro** | Bairro | Sim | `/infNFe/emit/enderEmit/xBairro` | Texto |
| **vendedor_cidade** | Nome do Município | Sim | `/infNFe/emit/enderEmit/xMun` | Texto |
| **vendedor_uf** | Sigla do Estado (UF) | Sim | `/infNFe/emit/enderEmit/UF` | 2 letras (Ex: MG) |
| **vendedor_cep** | CEP (apenas números) | Sim | `/infNFe/emit/enderEmit/CEP` | 8 dígitos |
| **vendedor_telefone** | Telefone de contato | Não | `/infNFe/emit/enderEmit/fone` | Apenas números |
| **produto_cean** | Código de Barras (EAN/GTIN) | Recomendado | `/infNFe/det/prod/cEAN` | Números |
| **produto_descricao** | Nome/Descrição do Produto | Sim | `/infNFe/det/prod/xProd` | Texto |
| **produto_ncm** | Código NCM (8 dígitos) | Sim | `/infNFe/det/prod/NCM` | 8 dígitos |
| **produto_unidade** | Unidade (UN, KG, LT, etc) | Não | `/infNFe/det/prod/uCom` | Texto |
| **produto_quantidade** | Quantidade Comercial | Não (Zero) | `/infNFe/det/prod/qCom` | **Número (Ponto como decimal)** |
| **produto_valor_unitario** | Valor Unitário | Não (Zero) | `/infNFe/det/prod/vUnCom` | **Número (Ponto como decimal)** |
| **data_emissao** | Data da Venda (AAAA-MM-DD) | Não (Hoje) | `/infNFe/ide/dhEmi` ou `dEmi` | **AAAA-MM-DD (ISO)** |

## 🛡️ Regras Críticas para a Macro (Checklist de Exportação)

A macro deve garantir os seguintes pontos para evitar erros de importação:

1.  **Separador Decimal**: Use obrigatoriamente o **ponto (`.`)** em vez da vírgula para as colunas de `quantidade` e `valor_unitario`.
2.  **Formato de Data**: Exporte as datas estritamente no formato **`AAAA-MM-DD`**. Datas no formato brasileiro (`DD/MM/AAAA`) serão ignoradas ou causarão erros de parse.
3.  **CNPJ Vendedor**: O sistema exige um CNPJ de **14 dígitos válidos** para aceitar o registro na perspectiva de `vendedor`. Se o XML for de um produtor rural com CPF, ele será rejeitado pelo sistema atual.
4.  **Codificação do Arquivo**: Prefira salvar o CSV com codificação **UTF-8** para garantir que caracteres especiais (acentos, cedilha) não sejam corrompidos.
5.  **Delimitador**: O sistema aceita vírgula (`,`) ou ponto-e-vírgula (`;`), mas a macro deve ser consistente.

---
*Documento gerado automaticamente para suporte à integração offline.*
