# Arquitetura da LaPink

Este documento explica **como o site funciona de verdade** e, principalmente,
**por que** algumas decisões não-óbvias foram tomadas. O código sozinho mostra
o *o quê*; isto aqui é o *porquê* — a parte que normalmente fica só na cabeça
de quem construiu.

Se você está chegando agora neste projeto, leia isto antes de mexer em
autenticação, Firestore rules, rate limiting ou notificações. São as áreas
onde um ajuste "óbvio" e bem-intencionado já reabriu um problema de segurança
que tinha sido corrigido (ver a seção **"Rate limiting por IP"** abaixo).

> Documento irmão: [`CLOUD_FUNCTIONS.md`](./CLOUD_FUNCTIONS.md) lista cada
> Cloud Function individualmente. Este arquivo é sobre como as peças se
> encaixam.

---

## 1. Visão geral da stack

Site 100% sem build step — HTML/CSS/JS puro, sem framework, sem bundler.
Qualquer editor de texto e um navegador bastam para editar.

| Camada | Tecnologia |
|---|---|
| Hosting | Firebase Hosting (estático) |
| Banco de dados | Cloud Firestore |
| Backend | Cloud Functions (Node 20, Gen 1) |
| Autenticação | Firebase Authentication + Custom Claims |
| Fotos de produto | Firebase Storage |
| Pagamento | Mercado Pago (Checkout Pro + webhook) |
| Frete | Melhor Envio e/ou Manda Bem (Correios) |
| WhatsApp | Meta Cloud API (WhatsApp Business) |
| E-mail | EmailJS (client-side) |
| Notificação push | Web Push (VAPID), sem app nenhum |

Não existe ambiente de staging. Todo teste é feito direto contra o projeto
Firebase de produção (`lapink-82a39`) — não há emuladores configurados neste
repositório. Isso é uma escolha consciente para um projeto deste porte, não
um descuido, mas significa que qualquer mudança em Firestore rules, Storage
rules ou Cloud Functions **afeta o site real assim que é publicada**.

---

## 2. Como os dados fluem — o "write-through cache"

Esta é a parte mais fácil de entender errado, então merece destaque.

O painel admin **não fala com o Firestore diretamente** na maior parte do
código. Ele lê e escreve `localStorage` normalmente (`getProdutos()`,
`saveProdutos()` etc., em `admin/js/utils.js`), como se fosse a única fonte
de dados. Quem sincroniza isso com a nuvem é um script à parte:
[`public/js/cloud-sync.js`](../public/js/cloud-sync.js), carregado em quase
toda página (admin e pública).

Ele funciona assim:

1. **Na carga da página**: busca os documentos relevantes no Firestore
   (coleção `lapink`) e, se forem mais novos que o que está no
   `localStorage` local, sobrescreve o `localStorage`.
2. **Em todo `localStorage.setItem`** para uma das chaves em `SYNC_KEYS`
   (produtos, pedidos, config da loja, categorias, etc.), ele **intercepta**
   a chamada (troca `Storage.prototype.setItem`) e espelha o valor para
   `/lapink/{chave}` no Firestore, além de gravar localmente como sempre.

Ou seja: o código de cada página de admin nunca precisou saber que existe
Firestore — ele só usa `localStorage` e o `cloud-sync.js` cuida do resto nos
bastidores. Isso é conveniente, mas tem consequências que valem a pena
saber:

- **Catálogos grandes (com fotos) estouram o limite de 1 MiB por documento
  do Firestore.** Por isso, arrays grandes são divididos automaticamente em
  `lapinkProdutos_0`, `_1`, `_2`... com um documento-índice
  `{chunked: true, chunks: N}`. Isso está espalhado em duas cópias
  praticamente idênticas: dentro de `cloud-sync.js` (quem grava/lê) e dentro
  de `firestore.rules` na função `isDocPublico()` (quem autoriza acesso a
  essas partes). Se algum dia mudar uma, precisa mudar a outra.
- **Depois de mudar uma Firestore rule que exige uma claim nova** (por
  exemplo, `isAdmin()`), uma aba de admin **já aberta antes da mudança**
  continua com o token antigo até a pessoa **sair e entrar de novo**. Isso
  já causou confusão real durante esta sessão — pareceu bug ("não consigo
  mais cadastrar produto"), mas era só token desatualizado.
- **`lapinkUsers` e `lapinkClients` (PII e hashes de senha) NÃO estão em
  `SYNC_KEYS`** — de propósito. Não devem trafegar para um Firestore de
  leitura pública. Contas de admin de verdade são resolvidas via Firebase
  Auth + custom claims (seção 3), não por essa sincronização.

Fotos de produto **não** passam por esse mecanismo desde a migração para o
Storage — ver seção 5.

---

## 3. Autenticação e autorização

Duas coisas competem para dizer "quem é este usuário": o `localStorage`
(`lapinkSession`, gravado no login) e o Firebase Auth (o token JWT de
verdade). **O Firebase Auth sempre vence.**

- `login.js` tenta autenticar via Firebase Auth primeiro
  (`signInWithEmailAndPassword`). Contas antigas (pré-Firebase Auth) são
  migradas de forma transparente no primeiro login bem-sucedido
  (`_ensureAuthAccount`).
- Depois de autenticar, `_resolverRoleReal()` chama a Cloud Function
  `sincronizarClaimsAdmin`, que decide o **papel de verdade** do usuário
  (`admin`/`superadmin`/nada) no servidor — usando Admin SDK, então o
  cliente nunca escreve o próprio papel — e grava isso como **custom claim**
  no token do Firebase Auth. Em seguida força um refresh do token
  (`getIdTokenResult(true)`) para já usar a claim nova nesta mesma sessão.
- Dois e-mails são super admin fixo, direto no código
  (`SUPERADMINS_FIXOS`, em `functions/index.js`) — nunca dependem de nenhum
  documento do Firestore. Qualquer outro admin vem de `lapinkUsers`.
- As **Firestore rules** (`isAdmin()` em `firestore.rules`) leem
  `request.auth.token.role` — ou seja, dependem inteiramente dessa claim
  estar correta no token. Um usuário com claim desatualizada (token antigo)
  é tratado como não-admin pelas rules, mesmo que `lapinkSession` diga o
  contrário.

**Recuperação de senha** (`enviarLinkRedefinicaoSenha`) usa o Admin SDK para
gerar o link de reset de verdade (não o e-mail padrão do Firebase, que tem
entrega ruim em alguns provedores) e envia via EmailJS — o mesmo serviço já
configurado para o e-mail de boas-vindas.

---

## 4. Firestore — modelo de segurança

Postura **default-deny**: se não existe uma regra permitindo, o acesso é
negado. Ver [`firestore.rules`](../firestore.rules) — está bem comentado,
vale ler o arquivo inteiro pelo menos uma vez.

Resumo por coleção:

| Coleção | Leitura | Escrita |
|---|---|---|
| `lapink/{doc}` | pública **só** para os docs em `isDocPublico()` (catálogo, config da loja — nunca segredos) | exige `isAdmin()` |
| `lapink/apiConfig` | **nunca** (nem admin) — só a Cloud Function lê via Admin SDK | exige `isAdmin()` |
| `usuarios/{uid}` | só o próprio usuário | só o próprio usuário, e não pode se auto-promover a admin |
| `abandonados/{id}` | `get` público (o cliente grava o próprio carrinho) | `list` exige `isAdmin()` |
| `enderecos/{id}` | `get` público, `list` bloqueado | pública (endereço do próprio cliente) |
| `pedidos/{id}` | `get` público (acompanhar 1 pedido pelo número), `list` exige login | `update` exige `isAdmin()`, e só nos campos `rastreio`/`status` |
| `analytics/*` | exige `isAdmin()` | **nunca** — só a Function (Admin SDK) |
| `analyticsDedupe/*`, `rateLimites/*`, `resetLimites/*` | **nunca** | **nunca** — uso interno das Functions |
| `pushSubscriptions/*` | **nunca** | **nunca** — só a Function |

Por que tanta coisa "nunca" para o cliente, mesmo autenticado como admin? Por
que essas coleções não têm razão nenhuma para ser lidas/escritas fora de uma
Cloud Function — abrir "só para admin" seria uma permissão real que
ninguém usa, e portanto só risco sem benefício.

### O incidente que motivou o modelo atual

Até uma correção nesta sessão, `/lapink/{doc}` (catálogo, config) e
`/lapink/apiConfig` (segredos: token do Mercado Pago, etc.) tinham
**escrita liberada para qualquer um, sem login nenhum**. Qualquer pessoa que
soubesse o nome do documento podia vandalizar o catálogo, sabotar o token de
pagamento, ou injetar HTML/JS no nome de um produto (que o painel exibia sem
escapar — XSS persistente contra qualquer admin que abrisse a lista). Foi
testado ao vivo com uma simulação de 10 ataques diferentes, todos bloqueados
depois da correção.

---

## 5. Firebase Storage — fotos de produto

Fotos **não ficam mais em base64 dentro do catálogo**. Isso já causou dois
problemas reais: estourar o limite de ~5 MB do `localStorage` por navegador
(silenciosamente — o produto simplesmente não salvava) e estourar o limite
de 1 MiB por documento do Firestore (obrigando a dividir o catálogo em
partes, ver seção 2).

Hoje: `admin/js/fotos.js` sobe a foto para `Storage:/produtos/{arquivo}` e o
catálogo guarda só a **URL**. Ver [`storage.rules`](../storage.rules):
leitura pública (a vitrine precisa mostrar a foto), escrita só de admin
autenticado, limitada a 5 MB e a `Content-Type: image/*`.

Duas ferramentas de admin existem só por causa da migração:
`admin/recuperar-fotos.html` (reconstrói o catálogo a partir das "partes"
antigas que o `cloud-sync.js` deixa no Firestore) e
`admin/migrar-fotos.html` (converte fotos antigas em base64 para o Storage,
uma a uma, salvando progresso). Não são fluxo normal de uso — são utilitários
de recuperação, deixados no painel para o caso de precisar de novo.

---

## 6. Rate limiting por IP — o bug que voltou duas vezes

Vale um destaque próprio porque é o exemplo mais concreto de "correção
óbvia que não foi suficiente" deste projeto.

`verificarLimiteIP` bloqueia um IP depois de várias falhas de login (ou
cadastros) numa janela de tempo. A primeira versão confiava em
`req.headers['x-forwarded-for']` — óbvio que está errado, é um header que o
próprio cliente controla, então bastava mandar um valor diferente a cada
tentativa para nunca ser bloqueado.

A "correção" trocou isso por `req.ip`. **Isso também não bastou.** O
Express que roda por baixo do Cloud Functions Gen 1 usa `trust proxy`
ativado (correto, já que o Google Front End é um proxy legítimo) — e isso
faz `req.ip` **consultar automaticamente** o `X-Forwarded-For`, pegando o
**primeiro** valor da lista, exatamente o que o cliente controla. O bug
estava um nível abaixo de onde a correção mexeu, e só foi descoberto porque
alguém testou de propósito forjando o header de novo depois da "correção".

A versão certa está em `_ipReal()`, em `functions/index.js`: pega o
**último** valor de `X-Forwarded-For`, porque o Google Front End sempre
anexa o IP real do cliente como o último hop ao encaminhar a requisição —
tudo antes disso é o que o cliente (ou um proxy do lado dele) inseriu.

**Lição para quem for mexer aqui de novo:** nunca confiar em `req.ip` puro
neste ambiente. Sempre usar `_ipReal(req)`, já compartilhado por
`verificarLimiteIP`, `registrarVisita` e `registrarVisualizacaoProduto`.

---

## 7. Notificações push (Web Push) — sem aplicativo

Quando um pedido é confirmado como pago (dentro de `mpWebhook`, no exato
ponto em que o estoque é baixado) e quando um carrinho fica abandonado por
tempo demais (function agendada `verificarCarrinhosAbandonados`, a cada 10
min), o(s) admin(s) recebem uma notificação nativa do navegador — sem
instalar app nenhum.

Peças do quebra-cabeça:

- **Par de chaves VAPID** — pública embutida em
  `admin/js/notificacoes-push.js` (não é segredo, é feita para ir ao
  navegador); privada só em `functions/.env` (nunca commitada).
- **`admin/sw-admin.js`** (o mesmo service worker já registrado em toda
  página do admin para cache) ganhou os listeners `push` e
  `notificationclick` — não foi criado um SW separado só para isso.
- **`pushSubscriptions`** no Firestore guarda `{email, endpoint, keys}` por
  dispositivo inscrito — só a Function grava e lê.
- **iOS/iPadOS exige "Adicionar à Tela de Início" primeiro** — restrição da
  própria Apple desde a versão 16.4, sem alternativa. No Android
  (Chrome/Edge/Firefox) funciona direto numa aba normal, sem instalar nada.
  Por isso `admin/manifest.json` + as tags `apple-mobile-web-app-*` em
  `admin/admin.html` existem: sem elas, o atalho adicionado abriria o
  Safari por cima em vez de rodar "solo", e a notificação não chegaria
  mesmo depois de instalado.
- **Carrinho abandonado não é um evento, é um estado.** Diferente de "pedido
  pago" (que o webhook do Mercado Pago avisa na hora certa), não existe
  "webhook de abandono" — por isso `verificarCarrinhosAbandonados` é uma
  function **agendada** (Cloud Scheduler), não um gatilho de evento. Ela
  varre `abandonados` procurando quem ficou 15+ min sem interação
  (`updatedAt`) e ainda não foi notificado (`notificadoAdmin`).
- Ao ativar, o próprio botão "Enviar notificação de teste"
  (Configurações → Integrações) existe justamente para não depender de uma
  venda real para confirmar que está tudo funcionando.

---

## 8. Analytics próprio — sem cookies, sem serviço externo

`registrarVisita` e `registrarVisualizacaoProduto` implementam uma medição
bem simples: visitas ao site e produtos mais vistos, mostradas na aba
Analytics dentro de Clientes no painel.

Decisão de design: sem cookies e sem fingerprinting — a deduplicação é
**só no servidor**, por IP + dia (`analyticsDedupe`), usando o mesmo
`_ipReal()` da seção 6. Isso aproxima de "visitantes únicos por dia" em vez
de contar cada carregamento de página, mas tem uma limitação assumida:
visitantes atrás do mesmo IP público (uma rede/escritório compartilhado)
contam como 1 só. Para métricas de precisão, existe um campo de Google
Analytics 4 em Configurações → Integrações — este analytics interno é
deliberadamente simples, não um substituto.

---

## 9. Service Workers e cache — duas instâncias separadas

Existem **dois** service workers independentes, com escopos diferentes:

| | Escopo | O que cacheia |
|---|---|---|
| `public/sw.js` | `/public/` | Pré-cacheia o shell da loja; HTML/CSS/JS são *network-first* (sempre busca a versão mais nova, cai pro cache só offline); imagens são *cache-first* |
| `admin/sw-admin.js` | `/admin/` | Nunca guarda HTML (evitar rodar versão antiga do painel depois de um deploy); CSS/JS/fontes/imagens do próprio site em *stale-while-revalidate* |

**Armadilha real que já aconteceu:** trocar o *conteúdo* de um arquivo
cacheado (ex.: `public/assets/icon.svg`, ao rebrandear o ícone do
diamante para a borboleta) **não é suficiente**. A URL continua igual, e
três camadas de cache diferentes continuam servindo a versão antiga: o
Cache Storage do service worker, e o `Cache-Control: max-age=604800` (7
dias) que `firebase.json` aplica a imagens. A correção que funciona de
verdade é **mudar a URL** (`icon.svg?v=2`) — só isso força as três camadas a
buscar de novo, e é isso que se deve fazer sempre que um asset estático
precisar ser atualizado "na hora".

Quando `public/sw.js` muda de verdade (não só o conteúdo de um asset
cacheado, mas o próprio arquivo do SW), sobe a constante `CACHE` no topo do
arquivo (`lapink-vNN`) — isso faz o navegador tratar como uma versão nova,
reinstalar, e o `activate` apaga o cache antigo.

---

## 10. Coisas que existem no repositório mas **não são usadas hoje**

Achado ao levantar esta documentação — vale saber antes de perder tempo:

- **`dev-server.js`** (raiz) é um backend REST completo e independente,
  com seu próprio "banco" em `data/db.json` e autenticação por token em
  memória. `npm start`/`npm run dev` apontam para ele. **Ele não reflete o
  site real** — é uma arquitetura alternativa que nunca foi adotada. A
  confirmação está em `admin/js/api.js`: `USE_REMOTE = false`, hardcoded,
  com o comentário "URL do **futuro** back-end". Só a página `admin.html`
  usa essa camada `LaPinkAPI`, e mesmo assim com `USE_REMOTE` sempre falso
  (ou seja, ainda lendo `localStorage`, nunca o REST). As outras 12 páginas
  do admin nem isso — leem `localStorage`/Firestore direto.
- **`serve.js`** (raiz) é um servidor estático de ~20 linhas, zero
  dependências, não referenciado por nenhum script do `package.json`. Serve
  arquivo estático puro, sem nenhuma lógica — se algum dia precisar só
  servir os arquivos localmente sem instalar nada, é a opção mais simples
  que existe no repo (`node serve.js`, porta 8787).
- **`AGENTES_STATUS.md`** e **`RELATORIO_AGENTES.md`** (raiz) são artefatos
  de um processo de desenvolvimento anterior orientado a IA (um "time
  fictício" usado para organizar tarefas), não documentação técnica.
  Parados desde antes de toda a segurança/push/analytics descritos aqui.
  Não use como referência do estado atual do sistema.

Nada disso está quebrado, só desconectado da realidade do site. Não foi
apagado nesta rodada de documentação — é uma decisão que vale conversar
antes de agir (apagar vs. manter como estava).

---

## 11. Dívida técnica conhecida

Coisas que funcionam, mas que quem for mexer no projeto deveria saber que
existem:

- **Zero testes automatizados** em todo o projeto (~24 mil linhas somando
  admin/public/functions). Qualquer mudança depende de teste manual.
- **Duplicação real, não hipotética.** `showToast()` está redefinida
  localmente em 8 das 13 páginas do admin, mesmo existindo uma versão
  central em `admin/js/utils.js`. `getProdutos()` existe em pelo menos 3
  lugares (`admin/js/utils.js`, `public/V1.html`, `public/produto.html`).
  Uma correção em um lugar não se propaga para os outros.
- **Numeração inconsistente em `functions/index.js`**: as seções vão de
  `1.` a `6.` e então pulam direto para `N.`, `O.`, `P.` — sobrou de uma
  sessão anterior de edições incrementais e nunca foi corrigido. Não afeta
  o funcionamento, só a navegação por quem lê o arquivo.
- **`apple-touch-icon` sem PNG dedicado.** Safari historicamente só
  garante esse ícone específico em PNG; hoje aponta pro SVG da marca, que
  funciona na maioria das versões recentes mas pode cair para uma miniatura
  da página em iOS mais antigo.

---

## 12. Mapa rápido — onde cada coisa mora

```
functions/index.js       → todas as 13 Cloud Functions (ver CLOUD_FUNCTIONS.md)
functions/.env           → segredos (gitignored — ver .env.example)
firestore.rules          → modelo de segurança do Firestore (bem comentado)
storage.rules            → modelo de segurança das fotos de produto

public/js/cloud-sync.js  → ponte localStorage ↔ Firestore (seção 2)
public/js/storage.js     → hash de senha, rate-limit client-side, analytics client-side
public/js/login.js       → fluxo de login (Firebase Auth + fallback legado)
public/sw.js             → service worker da loja pública

admin/js/utils.js        → helpers compartilhados do painel (getProdutos, escHtml, formatBRL…)
admin/js/auth.js         → sessão do painel, checkAuth(), custom claims
admin/js/api.js          → camada LaPinkAPI — NÃO É USADA de verdade (seção 10)
admin/js/fotos.js        → upload de foto pro Storage
admin/js/notificacoes-push.js → inscrição/teste de notificação push
admin/sw-admin.js        → service worker do painel (cache + push)
admin/recuperar-fotos.html / migrar-fotos.html → utilitários de recuperação (seção 5)
```
