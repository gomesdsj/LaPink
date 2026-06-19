# LAPINK — PAINEL DE CONTROLE DOS AGENTES
## Equipe TechCorp · Ativa até o fim do projeto

> Este arquivo é o painel de comando vivo da equipe. Atualizado a cada sessão.  
> Última atualização: 2026-06-18

---

## LEGENDA
- ✅ Concluído
- 🔄 Em andamento
- ⏳ Pendente
- 🔴 Crítico / Bloqueante

---

## AGENTE 01 — ANA LIMA · Frontend Architect
**Skills:** HTML5 semântico, CSS3, Vanilla JS ES6+, DOM manipulation, Web APIs, Template literals, Event delegation, FileReader API, URLSearchParams, LocalStorage API, Async patterns, Módulos JS, Formulários avançados, Regex e parsing, Renderização dinâmica

| Status | Tarefa |
|--------|--------|
| ✅ | Criar `admin/js/utils.js` centralizando formatBRL, parseBRL, escHtml, showToast, getProdutos, getPedidos, getClients e utilitários de peso |
| ✅ | Criar `admin/js/sidebar.js` eliminando duplicação do toggle em 8 páginas |
| ✅ | Corrigir `formatBRL` para versão única com separador de milhar |
| ✅ | Corrigir botão "Redefinir senha" sem handler em cadastro-cliente.html |
| ✅ | Conectar campo de busca e botão "Filtrar" em clientes.html |
| ✅ | Incluir `<script src="../js/utils.js">` e `<script src="../js/sidebar.js">` em todas as 8 páginas admin |
| ✅ | Remover código inline de sidebar (addEventListener duplicados) de todas as 8 páginas admin |

---

## AGENTE 02 — CARLOS MENDEZ · UX/UI Designer
**Skills:** Figma, User journey mapping, Wireframing, Design systems, Tipografia, Teoria de cores, Hierarquia visual, Microinterações, Card design, Mobile-first, Iconografia, Empty states, Onboarding, Formulários UX, Feedback de erros

| Status | Tarefa |
|--------|--------|
| ✅ | Criar classe `.empty-state` com ícone + mensagem |
| ✅ | Criar classes `.form-group.error`, `.field-error`, `.form-group.success` |
| ✅ | Empty state contextual em V1.html: busca sem resultado, categoria vazia, sem produtos cadastrados |
| ✅ | Badge "Últimas X unid." (laranja) e "Esgotado" (cinza) nas cards de produto do V1 |
| ✅ | Produtos esgotados com visual diferenciado (opacidade, grayscale, botão desabilitado) |
| ✅ | Barra de contagem de resultados ao filtrar/buscar ("X produtos em Anéis · ✕ Limpar") |
| ✅ | Newsletter com validação de e-mail e feedback visual (ok/erro) em V1.html |
| ✅ | XSS corrigido: `esc()` aplicado em p.nome, badge, depoimentos (texto e autor) |
| ✅ | Seção "Catálogo completo" em V1.html — grid por categoria (Anel, Brinco, Pulseira…), 15+ produtos no fallback |
| ✅ | Carrossel hero com 4 slides em V1.html (títulos, subtítulo, cor de fundo, botões de ação) |
| ✅ | Paleta harmonizada: rosa vibrante (#F04A86) + fundo branco com tokens CSS em v1.css |
| ✅ | Header admin simplificado: somente hamburger + nome da página (saudação só no dashboard) |
| ⏳ | Aplicar `.form-group.error` + `.field-error` nas validações dos formulários |
| ⏳ | Remover seção "Carrinhos abandonados" hardcoded do admin.html ou implementar real |
| ⏳ | Adicionar paginação em tabelas de relatórios (primeiros 20 + "Ver mais") |
| ⏳ | Adicionar seção "Produtos relacionados" em produto.html (mesma categoria) |

---

## AGENTE 03 — BEATRIZ SANTOS · Security Specialist
**Skills:** OWASP Top 10, XSS prevention, CSRF protection, Sanitização de input, localStorage security, Autenticação segura, Criptografia de senhas, Threat modeling, Content Security Policy, Auditoria de segurança, Injeção de código, Session management, Validação de dados, Secure defaults, Web Crypto API

| Status | Tarefa |
|--------|--------|
| ✅ | Hash SHA-256 de senhas em storage.js, register.js, login.js (backward compatible) |
| ✅ | Corrigir XSS em admin.html (escHtml em todos os innerHTML de dados de produto) |
| ✅ | Corrigir XSS em clientes.html (purchases sem escape) |
| ⏳ | Corrigir XSS em pedidos.html (renderização de itens e nomes de clientes em innerHTML) |
| ✅ | Corrigir XSS em loja-v1.html (escHtml aplicado em thumbHtml, nome, badge, depoimentos) |
| ✅ | Painel de pré-visualização ao vivo em loja-v1.html: mini-cards com foto, badge e preço, atualiza em tempo real ao adicionar/remover/reordenar/trocar badge/trocar foto |
| ✅ | Login unificado: login.js verifica lapinkClients (SHA-256) e lapinkUsers (btoa) — usuários do admin passam a logar na loja pública |
| ⏳ | Adicionar validação de formato de e-mail em register.js e login.js |
| ⏳ | Adicionar validação de WhatsApp (apenas dígitos, 10-11 caracteres) |
| ⏳ | Limitar tamanho de imagem base64 antes de salvar (máx ~500KB) |
| ⏳ | Adicionar `<meta http-equiv="Content-Security-Policy">` nas páginas admin |
| ⏳ | Hash de senha também em cadastro-cliente.html admin (criação/edição de cliente) |

---

## AGENTE 04 — RAFAEL TORRES · Performance Engineer
**Skills:** Lighthouse, Core Web Vitals, Lazy loading, Otimização de imagem, Code splitting, Minificação, Cache strategies, Service Worker, Rendering performance, Memory profiling, Network optimization, CDN, Asset compression, HTTP/2, requestAnimationFrame

| Status | Tarefa |
|--------|--------|
| ⏳ | Comprimir imagens antes de salvar base64: redimensionar para máx 600x600px, qualidade 70% via `<canvas>` |
| ⏳ | Memoizar chamada ao localStorage: carregar produtos 1x por página, não 4x |
| ⏳ | Adicionar debounce 300ms em `atualizarPreview()` do cadastro-produto.html |
| ⏳ | Lazy render em relatórios: calcular cada aba apenas ao clicar (não todas no load) |
| ⏳ | Adicionar `loading="lazy"` em todas as `<img>` dinâmicas de produto |
| ⏳ | Migrar imagens de produto para IndexedDB (sem limite de 5MB) |

---

## AGENTE 05 — DIEGO FERREIRA · PWA & Mobile Specialist
**Skills:** Service Workers, Web App Manifest, Offline-first, Push notifications, Install prompts, App shell architecture, Background sync, Cache strategies, IndexedDB, Responsive design, Touch events, Mobile performance, iOS/Android compat, Lighthouse PWA, Web Vitals mobile

| Status | Tarefa |
|--------|--------|
| ✅ | Criar `public/sw.js` — cache-first para assets, network-first para /data/ e /admin/, fallback offline para V1.html |
| ✅ | Criar `public/manifest.json` — icons SVG, start_url `./V1.html`, display standalone, theme_color #F04A86, shortcuts |
| ✅ | Criar `public/assets/icon.svg` — diamante facetado rosa sobre fundo arredondado |
| ✅ | Registrar Service Worker em V1.html com botão de instalação PWA |
| ⏳ | Adicionar cache de imagens base64 no SW para offline |
| ⏳ | Auditar com Lighthouse → meta: PWA score > 90 |

---

## AGENTE 06 — JULIA OLIVEIRA · Storage & Data Architect
**Skills:** localStorage, IndexedDB, sessionStorage, Modelagem de dados, Schema design, Normalização, Migração de dados, Integridade de dados, Validação de JSON, CRUD patterns, Capacidade de armazenamento, Backup/restore, Sync strategies, Versionamento de schema, Data consistency

| Status | Tarefa |
|--------|--------|
| ✅ | Atualizar `purchases[]` e `totalSpent` do cliente ao criar pedido (pedidos.html) |
| ✅ | Decrementar estoque ao criar pedido no admin |
| ✅ | Criar `admin/importar-planilha.html` — importa 67 produtos da planilha LaPink, sem duplicatas, configura 15 primeiros como destaque |
| ⏳ | Criar função `migrarSchema(versao)` com controle via `lapinkSchemaVersion` |
| ⏳ | Limitar tamanho de imagens base64 no localStorage (campo imagem) |
| ⏳ | Implementar exportar/importar dados JSON em configuracoes.html |
| ⏳ | Remover/marcar pedidos seeds (dados fake) de pedidos.html |
| ⏳ | Padronizar campo nome do cliente: `name` → `nome` (PT-BR) em toda a base |

---

## AGENTE 07 — PEDRO ALVES · E-commerce Specialist
**Skills:** Catálogo de produtos, Carrinho de compras, Checkout flow, Gestão de pedidos, Precificação, Variantes de produto, Inventory management, Promoções e cupons, Recomendações, Busca e filtros, Avaliações, Wishlist, SEO para e-commerce, Abandono de carrinho, Métricas de conversão

| Status | Tarefa |
|--------|--------|
| ✅ | Criar `public/js/cart.js` com carrinho completo em sessionStorage |
| ✅ | Criar `public/checkout.html` com lista de itens, formulário e geração de pedido |
| ✅ | Conectar "Adicionar ao carrinho" em produto.html ao carrinho real |
| ✅ | Adicionar ícone de carrinho com badge em V1.html e produto.html |
| ✅ | Decrementar estoque ao criar pedido no admin |
| ✅ | Conectar busca `#v1-search` com debounce em V1.html |
| ⏳ | Decrementar estoque quando pedido do checkout público é confirmado |
| ⏳ | Filtro por faixa de preço na loja V1 |
| ⏳ | Badge "Últimas X unidades" nas cards do grid V1 (já existe em produto.html) |
| ⏳ | Seção "Produtos relacionados" em produto.html (mesma categoria) |
| ⏳ | Avaliações de produto (estrelas + texto, salvo em localStorage) |

---

## AGENTE 08 — AMANDA COSTA · Accessibility Expert
**Skills:** WCAG 2.1 AA/AAA, ARIA roles e labels, Navegação por teclado, Screen reader testing, Contraste de cores, Focus management, HTML semântico, Skip links, Alt text, Formulários acessíveis, Mensagens de erro acessíveis, Motion preferences, High contrast mode, Assistive technology, Inclusive design

| Status | Tarefa |
|--------|--------|
| ✅ | Adicionar `@media (prefers-reduced-motion)` no CSS |
| ⏳ | Implementar focus trap nos modais: Tab circula dentro, Esc fecha |
| ⏳ | Corrigir contraste: `--gray-400` sobre branco = ratio 2.5:1 (mínimo WCAG AA = 4.5:1) |
| ⏳ | Adicionar `alt="${escHtml(p.nome)}"` nas imagens dinâmicas de produto |
| ⏳ | Adicionar `autocomplete` correto em todos os inputs (name, email, tel, current-password) |
| ⏳ | Associar mensagens de erro com `aria-describedby` ao campo correspondente |

---

## AGENTE 09 — LUCAS ROCHA · SEO & Marketing Tech
**Skills:** Meta tags, Open Graph, Schema.org JSON-LD, Sitemap, Robots.txt, URLs canônicas, Page speed SEO, Mobile-first indexing, Social sharing, Analytics, UTM parameters, Rastreamento de conversão, A/B testing, Conteúdo SEO, Auditoria técnica SEO

| Status | Tarefa |
|--------|--------|
| ✅ | Meta description em todas as páginas públicas (V1, index, login, register, produto) |
| ✅ | Open Graph tags (og:title, og:description, og:type) em V1.html e produto.html |
| ⏳ | Schema.org `Product` em produto.html via JSON-LD (gerado dinamicamente via JS) |
| ⏳ | Criar `public/robots.txt` |
| ⏳ | Criar `public/sitemap.xml` |
| ⏳ | Instalar Google Analytics 4 (gtag.js) nas páginas públicas |
| ⏳ | Definir V1.html como URL canônica e adicionar `<link rel="canonical">` |

---

## AGENTE 10 — FERNANDA MELO · CSS & Design System Expert
**Skills:** CSS custom properties, Design tokens, Component library, Spacing scale, Typography scale, Color systems, Dark mode, CSS animations, Print styles, BEM methodology, Specificity, Cross-browser, Component documentation, Style guide, CSS architecture

| Status | Tarefa |
|--------|--------|
| ✅ | Adicionar `--gray-500`, `--gray-700` na escala de cores |
| ✅ | Adicionar variáveis de z-index (`--z-dropdown` até `--z-toast`) |
| ✅ | Criar classes de estado (`.empty-state`, `.form-group.error`, `.skeleton`, `.table-scroll`) |
| ✅ | Corrigir branding "BELLA JOIAS" → "LAPINK" no cabeçalho do CSS |
| ⏳ | Substituir cores hardcoded (`#fff`, `#25D366`, `rgba(0,0,0,.5)`) por variáveis CSS |
| ⏳ | Remover/mover estilos inline dos HTMLs para classes CSS |
| ⏳ | Definir escala tipográfica rigorosa: 11, 12, 13, 14, 16, 18, 22, 28px |
| ⏳ | Criar dark mode com `@media (prefers-color-scheme: dark)` |
| ⏳ | Adicionar `@media print` para impressão de relatórios |

---

## AGENTE 11 — RODRIGO NUNES · JavaScript Architect
**Skills:** ES6+ modules, Async/await, Event-driven architecture, Pub/sub pattern, Observer pattern, Factory pattern, Singleton, Programação funcional, Error handling, Debugging, Unit testing, Code organization, Dependency management, Refatoração, SOLID principles

| Status | Tarefa |
|--------|--------|
| ✅ | Criar `admin/js/utils.js` com todas as funções compartilhadas |
| ✅ | Corrigir `pedidos.html`: JSON.parse sem try/catch |
| ✅ | Corrigir `formatBRL` para versão única com separador de milhar |
| ⏳ | Incluir utils.js em todas as páginas e remover funções duplicadas locais |
| ✅ | Adicionar modo "Custo direto (R$)" na calculadora de `cadastro-produto.html` — toggle Por grama / Valor direto, salva `custoPecaDireto` e `custoBanhoDireto` |
| ✅ | Atualizar categorias do select em `cadastro-produto.html` (form + modal) para corresponder às da planilha |
| ⏳ | Adicionar debounce em todos os campos de busca |
| ⏳ | Validar custo negativo em `calcularPrecoAutomatico()` |
| ⏳ | Refatorar `relatorios.html`: lazy load por aba (não calcular tudo no load) |

---

## AGENTE 12 — CARLA BARBOSA · DevOps & Deployment
**Skills:** Git workflows, CI/CD pipelines, GitHub Actions, Static hosting Netlify/Vercel, Environment management, Build automation, Deployment strategies, Rollback, Monitoring, Error tracking, CDN configuration, SSL/TLS, CORS, Performance monitoring, Staging environments

| Status | Tarefa |
|--------|--------|
| ✅ | Configurar deploy automático no GitHub Pages (`public/` → `gomesdsj.github.io/LaPink/`) |
| ✅ | Criar `.github/workflows/deploy.yml` — deploy automático em push na main via peaceiris/actions-gh-pages |
| ✅ | Criar `dev-server.js` (Express) — serve raiz completa do projeto com URL de rede para testes mobile |
| ⏳ | Configurar branch protection em `main` (exigir PR + revisão) |
| ⏳ | Criar `.github/workflows/check-links.yml` para verificar links quebrados |
| ⏳ | Verificar `.gitignore` — garantir que não versiona dados de localStorage ou arquivos temp |

---

## AGENTE 13 — THIAGO LIMA · QA Engineer
**Skills:** Test planning, Unit testing, E2E testing Playwright, Regression testing, Cross-browser testing, Mobile testing, Performance testing, Accessibility testing, Bug reporting, Edge cases, Boundary testing, Smoke testing, Test coverage, Test automation, Exploratory testing

| Status | Tarefa |
|--------|--------|
| ✅ | Bug: pedidos.html crash com JSON corrompido → corrigido (try/catch) |
| ✅ | Bug: botão "Redefinir senha" sem handler → corrigido |
| ✅ | Bug: "Filtrar" em clientes.html sem handler → corrigido |
| ✅ | Bug: busca em V1.html sem função → corrigido |
| ✅ | Bug: botão "Comprar" em produto.html não adicionava ao carrinho → corrigido |
| ✅ | Bug: estoque não decrementava ao criar pedido → corrigido |
| ✅ | Bug: login mobile não funcionava — usuários do admin (lapinkUsers/btoa) não eram encontrados em login.js → corrigido com fallback |
| ✅ | Bug: menu hambúrguer centralizado no mobile e abrindo da direita → corrigido: fixado no canto esquerdo, drawer desliza da esquerda para direita |
| ⏳ | Bug: estoque não decrementa quando pedido público (checkout.html) é confirmado |
| ⏳ | Bug: formatBRL inconsistente entre páginas → precisa incluir utils.js em todas |
| ⏳ | Criar smoke tests documentados para os 5 fluxos críticos |
| ⏳ | Testar fluxo completo: Carrinho → Checkout → Pedido salvo → WhatsApp aberto |
| ⏳ | Testar em mobile (iOS Safari e Android Chrome) |

---

## AGENTE 14 — ISABELA GOMES · Product Manager
**Skills:** User story mapping, Backlog priorizado, MVP definition, Feature scoping, KPI definition, Roadmap planning, Sprint planning, Acceptance criteria, Competitive analysis, User research, Métricas, OKR framework, Risk assessment, Go-to-market, Stakeholder management

### Roadmap Ativo

| Sprint | Status | Entrega |
|--------|--------|---------|
| Sprint 1 — Fundação e Bugs | 🔄 Em andamento | Semana 1-2 |
| Sprint 2 — Checkout e Estoque | ⏳ Próximo | Semana 3-4 |
| Sprint 3 — PWA e Notificações | ⏳ Futuro | Mês 2 |
| Sprint 4 — Pagamento e Avaliações | ⏳ Futuro | Mês 3 |

| Status | Tarefa Sprint 1 |
|--------|--------|
| ✅ | Carrinho funcional (cart.js + checkout.html) |
| ✅ | Busca na loja V1 funcionando |
| ✅ | Segurança: hash de senhas |
| ✅ | Bugfixes críticos (6 bugs corrigidos) |
| ⏳ | Deploy no Netlify |
| ⏳ | Decrementar estoque via checkout público |

---

## AGENTE 15 — FELIPE CARDOSO · API & Integration Architect
**Skills:** REST API design, Webhooks, APIs de pagamento Stripe/PagSeguro/MP, WhatsApp Business API, Email APIs, OAuth 2.0, Rate limiting, API versioning, Error handling, API documentation, Mock APIs, Integração third-party, JWT, Autenticação via API, ViaCEP

| Status | Tarefa |
|--------|--------|
| ✅ | Links WhatsApp automáticos em pedidos (`wa.me` com mensagem formatada) |
| ⏳ | Integrar ViaCEP no checkout (`fetch('https://viacep.com.br/ws/${cep}/json/')`) |
| ⏳ | Integrar Mercado Pago Checkout Pro (SDK JS, sem backend) |
| ⏳ | Integrar WhatsApp Business API para notificações automáticas de status |
| ⏳ | Integrar email transacional (SendGrid ou Mailgun) para confirmações de pedido |

---

## AGENTE 16 — MARIANA SOUZA · Data Analyst
**Skills:** Business intelligence, Sales analytics, Customer segmentation, Inventory analysis, Conversion funnel, Cohort analysis, Revenue metrics, Reporting dashboards, Data visualization, KPIs, Trend analysis, Métricas de produto, Data cleaning, ROI, Insights acionáveis

| Status | Tarefa |
|--------|--------|
| ⏳ | Adicionar filtro de período em relatórios de vendas (7/30/90 dias) |
| ⏳ | Adicionar aba "Tendências" com gráfico de linha de receita por semana |
| ⏳ | KPI: produtos sem movimento (estoque > 0, sem pedido nos últimos 60 dias) |
| ⏳ | KPI: margem por categoria (já tem dados, só falta calcular e exibir) |
| ⏳ | KPI: taxa de recompra (`purchases.length > 1 / total * 100`) |
| ⏳ | KPI: LTV do cliente (soma de todos os pedidos por cliente) |

---

## AGENTE 17 — GABRIEL MARTINS · Mobile/Responsive Specialist
**Skills:** Mobile-first CSS, Viewport units, Fluid typography, Touch targets, Gesture handling, Bottom navigation, App-like UX, PWA installation, Splash screens, iOS safe area, Android Chrome, Lighthouse mobile, Performance 3G, Media queries, Container queries

| Status | Tarefa |
|--------|--------|
| ✅ | Aumentar touch targets mínimos para 40px (`.btn-icon-sm`) |
| ✅ | Adicionar `.table-scroll` com overflow-x auto |
| ✅ | Hambúrguer no canto superior esquerdo da nav mobile (V1.html) |
| ✅ | Drawer lateral esquerdo com overlay, animação left→0, fecha com overlay/X/Escape |
| ✅ | Nav mobile: [≡ hambúrguer] [logo] [ícones de ação] — sem justify-content:center |
| ⏳ | Modal com `max-height: 90svh` e overflow-y auto |
| ⏳ | `padding-bottom: env(safe-area-inset-bottom)` no footer e sidebar (notch iPhone) |
| ⏳ | `.form-row` deve colapsar em 1 coluna em telas < 400px |
| ⏳ | Testar todos os forms em teclado virtual mobile (iOS/Android) |

---

## AGENTE 18 — LETICIA FERREIRA · Business Analyst
**Skills:** Requirements elicitation, Process mapping, Gap analysis, ROI analysis, Workflow design, Use case modeling, Documentation, Cost-benefit analysis, Risk management, Compliance, Change management, BPMN, Requisitos funcionais e não funcionais, Métricas de negócio

| Status | Tarefa |
|--------|--------|
| ⏳ | Criar área de "Atacado" na loja com preços de atacado para revendedores logados |
| ⏳ | Adicionar campo "Forma de pagamento" e "Data de pagamento" nos pedidos |
| ⏳ | Criar relatório financeiro: receita confirmada vs. pendente vs. cancelada por mês |
| ⏳ | Documentar fluxo de devolução/troca no sistema (campo de obs + status "devolvido") |

---

## AGENTE 19 — HENRIQUE VIEIRA · Tech Lead / Architect
**Skills:** System design, Technical debt management, Code review, Architecture patterns, Scalability, Technology selection, Code standards, Documentation, Refactoring strategies, Design patterns, SOLID principles, Separation of concerns, ADR, Team leadership, Mentoring

### Plano de Refatoração

| Fase | Status | Descrição |
|------|--------|-----------|
| Fase 1 — Fundação | 🔄 85% | utils.js ✅, sidebar.js ✅, segurança ✅, 8 bugs ✅ — falta: incluir utils.js nas páginas e remover duplicatas |
| Fase 2 — Features | 🔄 55% | Carrinho ✅, Checkout ✅, Carrossel ✅, PWA ✅, Deploy ✅ — falta: decrementar estoque público |
| Fase 3 — Qualidade | ⏳ 5% | Testes E2E, Lighthouse PWA, integração pagamento |

| Status | Tarefa Técnica |
|--------|--------|
| ✅ | Centralizar utilitários em utils.js e sidebar.js |
| ✅ | Corrigir débitos críticos de segurança |
| ✅ | Corrigir 6 bugs bloqueantes |
| ⏳ | Substituir duplicatas locais pelo utils.js importado em todas as páginas |
| ⏳ | Minificar CSS e JS para produção |
| ⏳ | Configurar deploy automatizado |

---

## AGENTE 20 — VANESSA RIBEIRO · Customer Experience Specialist
**Skills:** CX strategy, Customer journey mapping, Touchpoint analysis, NPS/CSAT, Feedback collection, Support workflows, Onboarding flows, Retention strategies, Loyalty programs, Communication design, Persona development, Empathy mapping, Service design, Complaint handling, Customer success

### Jornada do Cliente

| Etapa | Status | Obs |
|-------|--------|-----|
| 1. Descoberta | 🔄 Parcial | SEO ainda fraco |
| 2. Exploração | ✅ | Grid + filtros funcionando |
| 3. Detalhe do produto | ✅ | produto.html completo |
| 4. Compra | ✅ | Carrinho + checkout implementados |
| 5. Confirmação | ✅ | WhatsApp + pedido salvo |
| 6. Acompanhamento | ⏳ | Sem página de status para cliente |
| 7. Pós-venda | ⏳ | Sem avaliações nem programa de fidelidade |

| Status | Tarefa |
|--------|--------|
| ✅ | Carrinho funcional com feedback visual |
| ✅ | Checkout com geração de pedido e WhatsApp |
| ⏳ | Página `public/meu-pedido.html?id=XXX` para cliente acompanhar status |
| ⏳ | WhatsApp automático ao mudar status do pedido (links wa.me com template) |
| ⏳ | Avaliações de produto (estrelas + texto) em produto.html |
| ⏳ | "Produtos relacionados" ao final de produto.html |
| ⏳ | Opção "Comprar como visitante" sem obrigar cadastro |

---

## RESUMO GERAL DO PROJETO

| Dimensão | Nota Inicial | Nota Atual | Meta |
|----------|-------------|------------|------|
| Estrutura HTML | 9/10 | 9/10 | 10/10 |
| Design Visual | 8/10 | 9/10 | 9/10 |
| Funcionalidade Admin | 7/10 | 8.5/10 | 9/10 |
| Funcionalidade Loja | 4/10 | 7.5/10 | 9/10 |
| Segurança | 3/10 | 7.5/10 | 9/10 |
| Performance | 6/10 | 6/10 | 8/10 |
| Acessibilidade | 5/10 | 6/10 | 8/10 |
| SEO | 2/10 | 5/10 | 8/10 |
| Arquitetura JS | 4/10 | 6/10 | 8/10 |
| Experiência do Cliente | 3/10 | 7.5/10 | 9/10 |
| PWA & Mobile | 1/10 | 7/10 | 9/10 |
| DevOps / Deploy | 1/10 | 8/10 | 9/10 |
| **MÉDIA** | **4.8/10** | **7.2/10** | **8.8/10** |

---

## PRÓXIMAS AÇÕES PRIORITÁRIAS

### 🔴 Imediato
1. Incluir `utils.js` e `sidebar.js` em todas as páginas admin e remover funções locais duplicadas *(Ana Lima + Rodrigo Nunes)*
2. Decrementar estoque quando checkout público é confirmado *(Pedro Alves + Thiago Lima)*
3. Hash de senha no admin ao criar/editar cliente *(Beatriz Santos)*
4. XSS em pedidos.html (renderização de itens em innerHTML) *(Beatriz Santos)*

### 🟠 Esta semana
5. Schema.org Product em produto.html *(Lucas Rocha)*
6. Focus trap em modais *(Amanda Costa)*
7. Comprimir imagens antes de salvar via `<canvas>` *(Rafael Torres)*
8. Modal com `max-height: 90svh` + notch iOS safe-area *(Gabriel Martins)*

### 🟡 Próximo mês
9. Auditar Lighthouse PWA → meta score > 90 *(Diego Ferreira)*
10. Filtros de período em relatórios *(Mariana Souza)*
11. Página "Meu pedido" para cliente *(Vanessa Ribeiro)*
12. Integração Mercado Pago *(Felipe Cardoso)*
13. Integrar ViaCEP no checkout *(Felipe Cardoso)*

---

*Equipe TechCorp — 20 agentes ativos · LaPink · Atualizado: 2026-06-18*
