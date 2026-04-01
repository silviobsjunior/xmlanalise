# Documentação para Importação via Planilha e Macro XML

Este documento descreve a estrutura da planilha necessária para a importação manual de dados no sistema **AQUI TEM**, bem como o mapeamento dos campos do XML da NF-e para auxiliar na criação de macros de automação.

## 📊 Estrutura da Planilha (Colunas Necessárias)

Para que a busca pública funcione corretamente, os campos marcados com **(Obrigatório)** devem ser preenchidos. Se a macro/planilha não possuir os valores de quantidade ou preço, o sistema adotará **zero (0)** automaticamente.

| Coluna | Descrição | Obrigatório | Conteúdo XML (NF-e) |
| :--- | :--- | :--- | :--- |
| **perspectiva** | Papel no sistema (`vendedor`, `comprador` ou `ambos`) | Sim | Fixo ou Lógica de Negócio |
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
| **data_emissao** | Data da Venda (AAAA-MM-DD) | Não (Hoje) | `/infNFe/ide/dhEmi` ou `dEmi` |

## 🛡️ Regras de Validação para a Macro

A macro de importação deve garantir que:

1.  **Colunas Mínimas**: Mesmo que o usuário remova colunas opcionais, a macro deve validar se as colunas **Sim** na tabela acima permanecem presentes.
2.  **Valores Padrão**: Se as colunas de `quantidade` ou `valor` forem removidas pelo usuário, a macro deve inserir `0` nestas colunas internamente antes do upload.
3.  **Perspectiva**: Se o usuário não definir, o padrão deve ser `vendedor`.
    *   `vendedor`: Vincula o produto ao emitente.
    *   `comprador`: Vincula o produto ao destinatário (útil para registrar que "eu comprei de X" e aparecer como revendedor).
    *   `ambos`: Registra as duas visões.

---
*Documento gerado automaticamente para suporte à integração offline.*
