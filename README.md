# LaPink

Loja de semijoias — site público + painel administrativo. Firebase
Hosting + Firestore + Cloud Functions + Auth + Storage. HTML/CSS/JS puro,
sem framework, sem build step.

> **Comece por aqui, depois leia [`docs/ARQUITETURA.md`](docs/ARQUITETURA.md).**
> Este README é orientação rápida; o documento de arquitetura explica o
> *porquê* de cada decisão não-óbvia (autenticação, Firestore rules, rate
> limiting, cache) — vale a leitura antes de mexer nessas áreas.

## Estrutura de pastas

```
public/          páginas da loja e do cliente (site público)
  V1.html          página inicial da loja
  produto.html     detalhe de produto
  login.html, register.html, recuperar-senha.html
  pagamento.html   checkout
  meus-pedidos.html, minha-conta.html
  privacidade.html, termos.html
  js/              storage.js, login.js, cloud-sync.js, cart.js…
  assets/          ícone único da marca (icon.svg) + manifest da loja
  sw.js            service worker da loja pública

admin/           painel administrativo (13 páginas)
  admin.html            dashboard
  cadastro-produto.html cadastro/edição/estoque de produtos
  pedidos.html           lista e gestão de pedidos
  clientes.html           clientes + aba de Analytics
  configuracoes.html      integrações (Mercado Pago, WhatsApp, Analytics, push…)
  financeiro.html, relatorios.html, gerenciar-usuarios.html…
  js/                    utils.js, auth.js, fotos.js, notificacoes-push.js…
  sw-admin.js            service worker do painel

functions/       Cloud Functions (Node 20) — ver docs/CLOUD_FUNCTIONS.md
  index.js         as 13 functions, num arquivo só
  .env             segredos (NÃO commitado — copie de .env.example)

docs/            documentação técnica
  ARQUITETURA.md      como as peças se encaixam e por quê
  CLOUD_FUNCTIONS.md  índice das Cloud Functions

firestore.rules   modelo de segurança do banco (bem comentado — leia o arquivo)
storage.rules     modelo de segurança das fotos de produto
firebase.json     hosting, rewrites, headers de cache
```

## Rodando localmente

Como não há build step, "rodar localmente" é basicamente servir os arquivos
estáticos — mas quase toda funcionalidade real (catálogo, login, pedidos,
pagamento) depende do Firebase de **produção** (não há emuladores
configurados neste projeto). Não existe ambiente de staging separado.

Forma mais simples, sem instalar nada:

```bash
node serve.js
```

Abre em `http://localhost:8787`.

> ⚠️ **Não confunda com `npm start` / `node dev-server.js`.** Esse outro
> servidor implementa uma API REST própria com "banco" local em
> `data/db.json` — é uma arquitetura alternativa que **nunca foi adotada
> pelo site real** (confirmado em `admin/js/api.js`: `USE_REMOTE = false`,
> hardcoded). Rodá-lo não reflete como o site funciona hoje. Fica no
> repositório por enquanto, mas não é o caminho para desenvolver ou testar
> nada. Detalhes em `docs/ARQUITETURA.md` § 10.

## Publicando (deploy)

Requer a Firebase CLI autenticada no projeto (`lapink-82a39`, ver
`.firebaserc`) e — para as Cloud Functions — as variáveis em
`functions/.env` preenchidas (copie de `functions/.env.example`).

```bash
# só o site (HTML/CSS/JS estáticos)
npx firebase deploy --only hosting

# só uma Cloud Function específica (mais rápido que publicar todas)
npx firebase deploy --only functions:nomeDaFunction

# todas as Cloud Functions
npx firebase deploy --only functions

# regras do Firestore
npx firebase deploy --only firestore:rules

# regras do Storage (fotos de produto)
npx firebase deploy --only storage
```

Como não existe staging, todo deploy vai direto para produção — depois de
qualquer mudança em `firestore.rules`, `storage.rules` ou nas Functions,
vale conferir ao vivo antes de considerar concluído.

## Variáveis de ambiente

Ver [`functions/.env.example`](functions/.env.example) — lista completa
com o que cada uma faz e se tem alternativa configurável pelo próprio
painel admin (Configurações → Integrações).

## Autenticação

Dois e-mails são super admin fixo (definidos em `functions/index.js`,
`SUPERADMINS_FIXOS`). Qualquer outro admin é cadastrado pelo painel em
Gerenciar Usuários. Não existe mais senha padrão fixa no código — a
autenticação real é 100% Firebase Auth. Detalhes do fluxo (custom claims,
por que o Firebase Auth sempre é a fonte da verdade) em
`docs/ARQUITETURA.md` § 3.

## Documentação adicional

- [`docs/ARQUITETURA.md`](docs/ARQUITETURA.md) — como os dados fluem
  (localStorage ↔ Firestore), modelo de segurança, rate limiting,
  notificações push, analytics, service workers, dívida técnica conhecida.
- [`docs/CLOUD_FUNCTIONS.md`](docs/CLOUD_FUNCTIONS.md) — o que cada uma das
  13 Cloud Functions faz, tipo de gatilho e autenticação exigida.
- [`firestore.rules`](firestore.rules) e [`storage.rules`](storage.rules) —
  as regras em si, comentadas explicando o porquê de cada uma.

`AGENTES_STATUS.md` e `RELATORIO_AGENTES.md`, na raiz, **não são
documentação técnica** — são artefatos de um processo de desenvolvimento
anterior e estão desatualizados. Ignore-os.
