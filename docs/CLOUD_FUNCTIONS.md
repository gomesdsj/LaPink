# Índice das Cloud Functions

Todas as 13 functions vivem num arquivo só:
[`functions/index.js`](../functions/index.js). Não existe um índice dentro
do próprio arquivo — as seções são numeradas `1.` a `6.` e depois pulam pra
letras `N.`, `O.`, `P.` (sobra de edições incrementais em sessões
diferentes; não afeta o funcionamento). Esta tabela serve de mapa.

Para o *porquê* das decisões de segurança de cada uma, ver
[`ARQUITETURA.md`](./ARQUITETURA.md) — aqui é só o *o quê* e *onde*.

## Pagamento e frete

| Function | Tipo | Auth | O que faz |
|---|---|---|---|
| `createPreference` | HTTP público | nenhuma (checkout de visitante) | Cria a preferência de pagamento no Mercado Pago para o carrinho atual. Sanitiza `cliente`/`endereco` antes de gravar (fecha um XSS armazenado que já existiu). |
| `mpWebhook` | HTTP público | validado por assinatura do MP (`MP_WEBHOOK_SECRET`) | Recebe a confirmação de pagamento do Mercado Pago. Responde `200` imediatamente (o MP re-tenta se não receber 200 rápido) e processa depois. Ao virar `'pago'` pela 1ª vez: baixa estoque e dispara a notificação push de venda (`_notificarVendaAdmins`). |
| `cotarFrete` | HTTP público | nenhuma | Cotação de frete por CEP. Consulta Melhor Envio e/ou Manda Bem em paralelo (o que estiver ativado em `lapinkEntregaConfig`) e devolve tudo ordenado por preço. |

## Autenticação

| Function | Tipo | Auth | O que faz |
|---|---|---|---|
| `sincronizarClaimsAdmin` | HTTP | Bearer (ID token do próprio usuário) | Decide o papel real (`admin`/`superadmin`/nenhum) e grava como **custom claim** no token — fonte da verdade usada pelas Firestore rules. Só sincroniza a claim do dono do token, nunca de outra pessoa. |
| `enviarLinkRedefinicaoSenha` | HTTP público | nenhuma (por design — é o fluxo de "esqueci a senha") | Gera o link de reset via Admin SDK (mais confiável que o e-mail padrão do Firebase em provedores como Hotmail/Outlook) e envia por EmailJS. |

## WhatsApp e carrinho abandonado

| Function | Tipo | Auth | O que faz |
|---|---|---|---|
| `cobrarAbandonados` | HTTP | Bearer + `isAdmin` | Manda WhatsApp (Meta Cloud API) para carrinhos abandonados há mais de 30 min. Disparo **manual** (botão no painel) — não roda sozinha. Requer `WHATSAPP_TOKEN` configurado. |
| `verificarCarrinhosAbandonados` | **Agendada** (Cloud Scheduler, a cada 10 min) | — (não tem URL pública) | Notifica o(s) admin(s) por push quando um carrinho fica 15+ min sem interação. Cada carrinho notifica só 1 vez (`notificadoAdmin`). Só processa carrinhos abandonados depois de `_EPOCH_ABANDONO` (a data em que este recurso entrou no ar) — evita notificar em massa carrinhos antigos no primeiro deploy. |

## Segurança / limites

| Function | Tipo | Auth | O que faz |
|---|---|---|---|
| `verificarLimiteIP` | HTTP público | nenhuma (é o próprio limitador) | Bloqueia um IP após muitas falhas de login/cadastro numa janela de 15 min. **Usa `_ipReal()`, nunca `req.ip` puro** — ver ARQUITETURA.md § 6 antes de mexer aqui. Modos: `checar` (não gasta nada), `consumir` (gasta 1 tentativa), `limpar` (zera — exige token válido). |

## Analytics

| Function | Tipo | Auth | O que faz |
|---|---|---|---|
| `registrarVisita` | HTTP público | nenhuma | Registra 1 visita à loja, deduplicada por IP+dia. |
| `registrarVisualizacaoProduto` | HTTP público | nenhuma | Registra 1 visualização de produto, deduplicada por IP+dia+produto. |

## Notificação push (Web Push)

| Function | Tipo | Auth | O que faz |
|---|---|---|---|
| `salvarInscricaoPush` | HTTP | Bearer + `isAdmin` | Grava a inscrição push do navegador do admin (`endpoint` + chaves) em `pushSubscriptions`. |
| `removerInscricaoPush` | HTTP | Bearer + `isAdmin` | Remove a inscrição (botão "Desativar" em Configurações). |
| `enviarNotificacaoTeste` | HTTP | Bearer + `isAdmin` | Manda uma notificação de teste só para os dispositivos do **próprio** chamador — nunca para outros admins. |

O envio de verdade (venda concluída, carrinho abandonado) não tem endpoint
próprio — acontece dentro de `mpWebhook` e
`verificarCarrinhosAbandonados`, via o helper interno
`_enviarPushTodasInscricoes()`.

---

## Helpers internos (não são Functions exportadas)

Vale saber que existem, porque são reaproveitados por várias das functions
acima:

- **`_exigirAdmin(req)`** — confere o Bearer token e se o e-mail é admin
  (super admin fixo ou está em `lapinkUsers` com `role` admin/superadmin).
  Usado por `cobrarAbandonados` e pelas de push.
- **`_ipReal(req)`** — extrai o IP real de forma segura (ver ARQUITETURA.md
  § 6). Usado por `verificarLimiteIP`, `registrarVisita`,
  `registrarVisualizacaoProduto`.
- **`_sanitizarTexto`/`_sanitizarCliente`/`_sanitizarEndereco`** — limpam
  campos de texto livre vindos do checkout antes de gravar (fecham um XSS
  armazenado que já existiu).
- **`_enviarPushTodasInscricoes(payload, apenasEmail?)`** — envia Web Push
  para todas as inscrições, ou só para as de um e-mail específico (usado
  pelo teste). Remove sozinha inscrições mortas (resposta 404/410).
- **`decrementarEstoque(itens)`** — baixa estoque no catálogo, chamado só
  por `mpWebhook` na primeira confirmação de pagamento.

## Variáveis de ambiente que essas functions precisam

Ver [`functions/.env.example`](../functions/.env.example) para a lista
completa com descrição de cada uma.
