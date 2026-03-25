# xmlAnalise - Controle de Banco de Dados e Planejamento

## 📂 Status Atual (Março 2026)
O projeto está estruturado em:
- **Backend**: Node.js (Express) + PostgreSQL (Render/Supabase).
- **Frontend**: HTML/JS Vanilla (Hospedado no GitHub/Render).
- **Banco de Dados**: Supabase (PostgreSQL).
- **Integração**: Autenticação via Google/Supabase integrada com banco local.

### Funcionalidades Ativas:
- Upload e parse de XML (NF-e).
- Gestão de emitentes, destinatários e produtos.
- Busca pública de produtos e vendedores (sem exibição de dados sensíveis LGPD).
- Área do usuário logado para acompanhamento de notas importadas.

## 🚀 Plano de Evolução e Mudanças Solicitadas

### 1. Governança e Acesso por Perfil (Admin vs Usuário)
- **Desafio**: Usuários têm receio de que seus detalhes de arquivos sejam visíveis para outros ou superexpostos.
- **Solução**: Restringir a visualização detalhada de "Arquivos" apenas para o Administrador. O usuário comum terá apenas um resumo estatístico de sua contribuição.
- **Ações**:
  - [x] Adicionar coluna `is_admin` na tabela `usuarios`. (Implementado via código no backend)
  - [x] Alterar o endpoint `/api/minha-nota/:id` para validar permissão de Admin.
  - [x] No Frontend, desativar o botão "Ver" (detalhes) para usuários comuns.

### 2. Painel de Estatísticas de Contribuição (Frontend)
- **Desafio**: Dar feedback ao usuário sobre o valor dos dados que ele carregou sem expor detalhes sensíveis.
- **Solução**: Inserir na `index.html` estatísticas agregadas (Total de produtos, fornecedores, cidades).
- **Performance**: Os dados são pré-calculados no backend com cache de 1h.
- **Ações**:
  - [x] Criar endpoint `/api/estatisticas-gerais`.
  - [x] Implementar lógica de cache de 1h para estas estatísticas no backend.
  - [x] Exibir estatísticas na `index.html` via `globalStats`.

### 3. Migração para Domínio Próprio (santanaecia.com.br)
- **Meta**: Hospedar o ecossistema no HostGator sob o domínio principal.
- **Ações**:
  - [x] Criar `INSTRUCOES_HOME_SANTANAECIA.md` com o modelo da página raiz.
  - [ ] Mover frontend para subdiretórios `/aquitem` e `/maspiofmg` no HostGator.

---

## 📝 Próximos Passos
1. **Validar o acesso Admin**: Testar com os emails definidos (`contato@santanaecia.com.br`, `silviobsjunior@gmail.com`).
2. **Refinar Dashboard do Usuário**: Adicionar mais gráficos de resumo na aba de arquivos se necessário.
3. **Migração Física**: Subir os arquivos para o HostGator conforme as instruções geradas.

Obrigado por contar com minha ajuda. Continuaremos daqui em todas as sessões.
