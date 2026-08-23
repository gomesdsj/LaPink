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
  assert.match(editor, /push\('lapinkLojaConfig'/);
  assert.match(editor, /push\('lapinkProdutos'/);
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

test('publicação do banner aguarda Firestore e a loja redesenha após sincronizar', () => {
  const editor = read('admin/loja-v1.html');
  const loja = read('public/V1.html');
  assert.match(editor, /return window\.LaPinkSync\.push\('lapinkCarrossel'/);
  assert.match(editor, /salvarCarrossel\(\)/);
  assert.match(editor, /await otimizarImagensCarrossel\(\)/);
  assert.match(editor, /700 \* 1024/);
  assert.match(loja, /lapinkCarrosselAtualizados/);
  assert.match(loja, /window\.reloadCarrossel\(\)/);
});
