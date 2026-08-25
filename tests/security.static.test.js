const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

test('dados pessoais não possuem leitura pública nas regras', () => {
  const rules = read('firestore.rules');
  for (const collection of ['abandonados', 'enderecos', 'pedidos']) {
    const match = rules.match(new RegExp(`match /${collection}/\\{[^}]+\\} \\{([\\s\\S]*?)\\n    \\}`));
    assert.ok(match, `regra de ${collection} não encontrada`);
    assert.doesNotMatch(match[1], /allow\s+(?:get|read|list)\s*:\s*if\s+true/);
  }
  assert.doesNotMatch(rules, /'lapinkPedidos'/, 'documento legado de pedidos não pode ser público');
});

test('checkout usa token secreto para consulta de pedido', () => {
  const functions = read('functions/index.js');
  const sucesso = read('public/sucesso.html');
  assert.match(functions, /exports\.obterPedido/);
  assert.match(functions, /timingSafeEqual/);
  assert.match(sucesso, /cloudfunctions\.net\/obterPedido/);
  assert.doesNotMatch(sucesso, /collection\(['"]pedidos['"]\)\.doc\(id\)\.get/);
});

test('cadastro local nunca persiste credencial de cliente', () => {
  const storage = read('public/js/storage.js');
  const register = read('public/js/register.js');
  assert.match(storage, /delete seguro\.password/);
  assert.doesNotMatch(register, /password:\s*hash/);
});

test('webhook valida valor e atualiza estoque de forma transacional', () => {
  const functions = read('functions/index.js');
  assert.match(functions, /function processarPagamentoAtomico/);
  assert.match(functions, /payment\.transaction_amount/);
  assert.match(functions, /payment\.currency_id/);
  assert.match(functions, /estoqueProcessado/);
  assert.match(functions, /estoqueEstornado/);
  assert.match(functions, /db\.runTransaction/);
  assert.doesNotMatch(functions, /Responde 200 imediatamente para o MP não retentar/);
});

test('hosting envia cabeçalhos mínimos de segurança', () => {
  const firebase = read('firebase.json');
  for (const header of ['Content-Security-Policy', 'X-Content-Type-Options', 'Referrer-Policy', 'Permissions-Policy']) {
    assert.match(firebase, new RegExp(header));
  }
});

test('rotas reescritas não ficam presas no cache do domínio personalizado', () => {
  const config = read('firebase.json');
  ['/','/admin','/login'].forEach(function (rota) {
    assert.match(config, new RegExp('"source"\\s*:\\s*"' + rota.replace('/', '\\/') + '"[\\s\\S]*?no-cache, no-store, must-revalidate'));
  });
});

test('domínio personalizado persiste no Firebase e alimenta retornos do pagamento', () => {
  const rules = read('firestore.rules');
  const functions = read('functions/index.js');
  const config = read('admin/configuracoes.html');
  assert.match(rules, /lapinkDomainConfig/);
  assert.match(rules, /match \/lapink\/lapinkDomainConfig[\s\S]*?allow write: if isSuperAdmin\(\)/);
  assert.match(functions, /baseUrlDe\(req, _domainConfig\)/);
  assert.match(config, /doc\(['"]lapinkDomainConfig['"]\)/);
  assert.match(config, /function salvarDominio/);
});

test('pedidos da conta usam token verificado e recuperam vínculo legado no servidor', () => {
  const functions = read('functions/index.js');
  const pedidos = read('public/meus-pedidos.html');
  assert.match(functions, /exports\.listarMeusPedidos/);
  assert.match(functions, /where\(['"]cliente\.email['"], ['"]==['"], email\)/);
  assert.match(pedidos, /cloudfunctions\.net\/listarMeusPedidos/);
});

test('assinatura do webhook usa somente data.id recebido na query', () => {
  const functions = read('functions/index.js');
  assert.match(functions, /var dataIdAssinatura = \(req\.query && req\.query\['data\.id'\]\) \|\| ''/);
  assert.match(functions, /if \(dataId\) manifest \+=/);
});

test('remoção de pedido remoto é arquivamento autenticado e preserva histórico', () => {
  const functions = read('functions/index.js');
  const adminPedidos = read('admin/pedidos.html');
  assert.match(functions, /exports\.arquivarPedido/);
  assert.match(functions, /_exigirAdmin\(req\)/);
  assert.match(functions, /arquivado:\s*true/);
  assert.doesNotMatch(functions.match(/exports\.arquivarPedido[\s\S]*?\n\}\);/)[0], /\.delete\(\)/);
  assert.match(adminPedidos, /getIdToken\(\)/);
  assert.match(adminPedidos, /cloudfunctions\.net\/arquivarPedido/);
  assert.match(adminPedidos, /if \(!d\.arquivado\)/);
});

test('painel renova claim antes de gravar pedidos e confirma tags na nuvem', () => {
  const auth = read('admin/js/auth.js');
  const pedidos = read('admin/pedidos.html');
  const editor = read('admin/loja-v1.html');
  const sync = read('public/js/cloud-sync.js');
  assert.match(auth, /function garantirAdminFirebase/);
  assert.match(auth, /sincronizarClaimsAdmin/);
  assert.match(pedidos, /garantirAdminFirebase\(\).*collection\('pedidos'\)/s);
  assert.match(editor, /await Promise\.all/);
  assert.match(editor, /lapinkCloudSave\('lapinkLojaConfig'/);
  assert.match(editor, /lapinkCloudSave\('lapinkProdutos'/);
  assert.match(sync, /return prepararAuth\.then/);
});

test('filtros de pedidos normalizam status e usam listener explícito', () => {
  const pedidos = read('admin/pedidos.html');
  assert.match(pedidos, /function normalizarStatus/);
  assert.match(pedidos, /pending:\s*'pagamento_analise'/);
  assert.match(pedidos, /getElementById\('statusTabs'\)\.addEventListener\('click'/);
  assert.match(pedidos, /var passaStatus = filtroAtual === 'todos' \|\| st === filtroAtual/);
});

test('renovação de claim devolve o usuário e exclusão em massa arquiva pedidos MP', () => {
  const auth = read('admin/js/auth.js');
  const pedidos = read('admin/pedidos.html');
  assert.match(auth, /var usuarioFirebase = null/);
  assert.match(auth, /usuarioFirebase\.getIdToken\(true\)/);
  assert.match(pedidos, /function _arquivarPedidoRemoto/);
  assert.match(pedidos, /Promise\.all\(arquivamentos\)/);
  assert.doesNotMatch(pedidos, /Use o botão Arquivar no pedido do Mercado Pago/);
});

test('rastreio aparece para cliente e WhatsApp informa a etapa atual', () => {
  const adminPedidos = read('admin/pedidos.html');
  const meusPedidos = read('public/meus-pedidos.html');
  assert.match(adminPedidos, /function _mensagemWhatsPedido/);
  assert.match(adminPedidos, /Código de rastreio:/);
  assert.match(adminPedidos, /pagamento confirmado e está sendo preparado/);
  assert.match(meusPedidos, /O código de rastreio aparecerá aqui assim que for enviado/);
  assert.match(meusPedidos, /Em transporte/);
  assert.match(meusPedidos, /rastreamento\.correios\.com\.br/);
});

test('itens do pedido exibem foto no painel e na impressão', () => {
  const pedidos = read('admin/pedidos.html');
  assert.match(pedidos, /function _imagemDoItemPedido/);
  assert.match(pedidos, /String\(p\.id\)===id/);
  assert.match(pedidos, /produto\.imagens\)\&\&produto\.imagens\[0\]/);
  assert.match(pedidos, /_fotoItemHtml\(it,'pedido-item-foto'\)/);
  assert.match(pedidos, /_fotoItemHtml\(it,'nota-item-foto'\)/);
});

test('publicação do banner aguarda Firestore e a loja redesenha após sincronizar', () => {
  const editor = read('admin/loja-v1.html');
  const loja = read('public/V1.html');
  assert.match(editor, /cloudfunctions\.net\/salvarCarrosselAdmin/);
  assert.match(editor, /salvarCarrossel\(\)/);
  assert.match(editor, /await otimizarImagensCarrossel\(\)/);
  assert.match(editor, /700 \* 1024/);
  assert.match(loja, /lapinkCarrosselAtualizados/);
  assert.match(loja, /window\.reloadCarrossel\(\)/);
});

test('carrossel é publicado uma única vez pelo servidor e atualiza o cache confirmado', () => {
  const functions = read('functions/index.js');
  const editor = read('admin/loja-v1.html');
  const trecho = functions.match(/exports\.salvarCarrosselAdmin[\s\S]*?\n\}\);/)[0];
  assert.match(trecho, /_exigirPermissao\(req, 'loja-v1'\)/);
  assert.match(trecho, /db\.runTransaction/);
  assert.match(trecho, /lapinkCarrossel_/);
  assert.match(editor, /cloudfunctions\.net\/salvarCarrosselAdmin/);
  assert.match(editor, /lapinkCloudCache\('lapinkCarrossel'/);
  assert.doesNotMatch(editor.match(/function salvarCarrossel\(\)[\s\S]*?\n\}/)[0], /localStorage\.setItem|LaPinkSync\.push/);
  assert.match(editor, /lapinkCarrosselAtualizados/);
});

test('status e rastreio são atualizados por função administrativa restrita', () => {
  const functions = read('functions/index.js');
  const pedidos = read('admin/pedidos.html');
  assert.match(functions, /exports\.atualizarPedidoAdmin/);
  assert.match(functions, /_exigirAdmin\(req\)/);
  assert.match(functions, /statusPermitidos/);
  assert.match(functions, /alteracoes\.rastreio = rastreio/);
  assert.match(pedidos, /cloudfunctions\.net\/atualizarPedidoAdmin/);
  assert.doesNotMatch(pedidos, /collection\('pedidos'\)\.doc\(pedidoId\)\.update/);
});

test('usuários e permissões são gerenciados no servidor por superadmin', () => {
  const functions = read('functions/index.js');
  const auth = read('admin/js/auth.js');
  const usuarios = read('admin/gerenciar-usuarios.html');
  assert.match(functions, /exports\.gerenciarUsuarioAdmin/);
  assert.match(functions, /_exigirSuperAdmin\(req\)/);
  assert.match(functions, /setCustomUserClaims/);
  assert.match(functions, /admin\.auth\(\)\.updateUser/);
  assert.match(auth, /function _operacaoUsuarioAdmin/);
  assert.match(auth, /cloudfunctions\.net\/gerenciarUsuarioAdmin/);
  assert.match(usuarios, /await updateUser/);
  assert.match(usuarios, /await deleteUser/);
});

test('pagamento manual remoto é auditado no servidor e processa estoque', () => {
  const functions = read('functions/index.js');
  const financeiro = read('admin/financeiro.html');
  assert.match(functions, /exports\.registrarPagamentoManualAdmin/);
  assert.match(functions, /processarPagamentoAtomico/);
  assert.match(functions, /pagamentoManualPor/);
  assert.match(functions, /Pedidos do Mercado Pago só podem ser confirmados pelo webhook/);
  assert.match(financeiro, /carregarPedidosFinanceiroRemotos/);
  assert.match(financeiro, /cloudfunctions\.net\/registrarPagamentoManualAdmin/);
});

test('configuração financeira só confirma depois da gravação na nuvem', () => {
  const sync = read('public/js/cloud-sync.js');
  const financeiro = read('admin/financeiro.html');
  assert.match(sync, /window\.lapinkCloudWrite = writeToFirestore/);
  assert.match(financeiro, /async function salvarPagamentos/);
  assert.match(financeiro, /await window\.lapinkCloudWrite\(PAY_KEY, cfg\)/);
});

test('pedido legado por e-mail exige e-mail verificado', () => {
  const functions = read('functions/index.js');
  assert.match(functions, /decoded\.email_verified === true/);
  assert.match(functions, /where\(['"]ownerUid['"], ['"]==['"], decoded\.uid\)/);
});

test('permissões por aba são aplicadas no servidor e nas regras', () => {
  const functions = read('functions/index.js');
  const rules = read('firestore.rules');
  assert.match(functions, /function _exigirPermissao/);
  assert.match(functions, /_exigirPermissao\(req, 'pedidos'\)/);
  assert.match(functions, /_exigirPermissao\(req, 'financeiro'\)/);
  assert.match(rules, /function hasPage\(page\)/);
  assert.match(rules, /adminPermissions/);
});

test('carrinho abandonado usa token do servidor e não aceita create direto', () => {
  const functions = read('functions/index.js');
  const pagamento = read('public/pagamento.html');
  const rules = read('firestore.rules');
  assert.match(functions, /exports\.registrarCarrinhoAbandonado/);
  assert.match(functions, /exports\.converterCarrinhoAbandonado/);
  assert.match(pagamento, /registrarCarrinhoAbandonado/);
  assert.match(pagamento, /converterCarrinhoAbandonado/);
  assert.match(rules, /match \/abandonados\/\{id\}[\s\S]*?allow create: if false/);
});

test('sincronização detecta conflito de edição concorrente', () => {
  const sync = read('public/js/cloud-sync.js');
  assert.match(sync, /runTransaction/);
  assert.match(sync, /Conflito: estes dados foram alterados em outro dispositivo/);
  assert.match(sync, /_lapinkCloudBase_/);
});

test('analytics deduplica em transação e não usa IP legível no ID', () => {
  const functions = read('functions/index.js');
  assert.match(functions, /createHash\('sha256'\)\.update\(String\(chave\)\)/);
  assert.match(functions, /tx\.create\(ref/);
});

test('desconto de boas-vindas tem uma única tela de edição e atualização transacional', () => {
  const loja = read('admin/loja-v1.html');
  const descontos = read('admin/descontos.html');
  const functions = read('functions/index.js');
  assert.doesNotMatch(loja, /id="cfg-desc-ativo"|id="cfg-desc-pct"/);
  assert.match(loja, /Gerenciar em Descontos/);
  assert.match(descontos, /id="welcome-pct"/);
  assert.match(functions, /exports\.configurarDescontoBoasVindas[\s\S]*?runTransaction/);
  assert.match(functions, /Percentual deve ficar entre 0% e 90%/);
});

test('financeiro e relatórios usam fonte única sem persistir pedidos remotos no cache local', () => {
  const utils = read('admin/js/utils.js');
  const financeiro = read('admin/financeiro.html');
  const relatorios = read('admin/relatorios.html');
  assert.match(utils, /function carregarPedidosNuvemAdmin/);
  assert.match(utils, /p\._fonte !== 'fs'/);
  assert.match(financeiro, /carregarPedidosNuvemAdmin\(\)/);
  assert.match(relatorios, /carregarPedidosNuvemAdmin\(200\)/);
  assert.doesNotMatch(relatorios, /getPedidos\s*=\s*function/);
});
