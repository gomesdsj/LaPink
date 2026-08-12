/* LaPink — Fotos no Firebase Storage
 *
 * As fotos de produto agora ficam no Storage e o catálogo guarda só a URL.
 * Antes ficavam em base64 dentro do próprio catálogo, o que:
 *   • enchia o localStorage (limite ~5 MB por navegador) — passando do
 *     limite, o produto simplesmente não era salvo;
 *   • enchia o documento do Firestore (limite de 1 MiB), obrigando o
 *     cloud-sync a quebrar o catálogo em várias partes;
 *   • fazia a loja baixar megabytes de foto junto com o catálogo.
 *
 * O catálogo continua guardando os mesmos campos ("imagem" e "imagens"),
 * só que com URL no lugar do base64 — tudo que só faz <img src="..."> "
 * (vitrine, miniaturas, prévia) funciona sem alteração.
 */

var LAPINK_FOTOS_PASTA = 'produtos';

/** Já é uma URL (foto no Storage) — não precisa subir de novo. */
function fotoEhUrl(v) {
  return typeof v === 'string' && /^https?:\/\//i.test(v);
}

/** É uma foto embutida em base64 (formato antigo). */
function fotoEhBase64(v) {
  return typeof v === 'string' && v.indexOf('data:image/') === 0;
}

function storageDisponivel() {
  return typeof firebase !== 'undefined'
    && firebase.apps && firebase.apps.length
    && typeof firebase.storage === 'function';
}

/* dataURL → Blob, sem usar fetch() (que alguns navegadores barram em data:) */
function _dataUrlParaBlob(dataUrl) {
  var partes = String(dataUrl).split(',');
  var mime = (partes[0].match(/data:([^;]+)/) || [])[1] || 'image/webp';
  var bin = atob(partes[1] || '');
  var bytes = new Uint8Array(bin.length);
  for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

function _extDoMime(mime) {
  mime = String(mime || '');
  if (mime.indexOf('webp') !== -1) return 'webp';
  if (mime.indexOf('png')  !== -1) return 'png';
  if (mime.indexOf('gif')  !== -1) return 'gif';
  if (mime.indexOf('avif') !== -1) return 'avif';
  return 'jpg';
}

/**
 * Sobe uma foto (dataURL base64) para o Storage e devolve a URL pública.
 * Se já receber uma URL, devolve ela mesma — a função é idempotente, então
 * pode ser chamada de novo em cima de um catálogo já migrado sem duplicar
 * nada no Storage.
 */
function uploadFoto(dataUrl, pasta) {
  if (fotoEhUrl(dataUrl)) return Promise.resolve(dataUrl);
  if (!fotoEhBase64(dataUrl)) return Promise.reject(new Error('Foto em formato não reconhecido.'));
  if (!storageDisponivel()) return Promise.reject(new Error('Firebase Storage não está disponível nesta página.'));

  var blob;
  try { blob = _dataUrlParaBlob(dataUrl); }
  catch (e) { return Promise.reject(new Error('Não foi possível ler a foto.')); }

  var nome = Date.now() + '-' + Math.random().toString(36).slice(2, 10) + '.' + _extDoMime(blob.type);
  var ref = firebase.storage().ref((pasta || LAPINK_FOTOS_PASTA) + '/' + nome);

  return ref.put(blob, {
    contentType: blob.type,
    // Foto nunca muda de conteúdo (o nome tem timestamp + aleatório), então
    // pode ser cacheada pelo navegador por bastante tempo.
    cacheControl: 'public, max-age=31536000'
  }).then(function(snap) {
    return snap.ref.getDownloadURL();
  });
}

/** Sobe uma lista de fotos em sequência (uma de cada vez). */
function uploadFotos(lista, pasta, onProgresso) {
  var out = [];
  return (lista || []).reduce(function(p, item, i) {
    return p.then(function() {
      return uploadFoto(item, pasta).then(function(url) {
        out.push(url);
        if (onProgresso) onProgresso(i + 1, lista.length);
      });
    });
  }, Promise.resolve()).then(function() { return out; });
}

/**
 * Sobe a foto e devolve a URL; se o upload falhar (Storage ainda não
 * configurado, sem internet, sessão de admin vencida), devolve o base64
 * original em vez de estourar. Perder a foto nunca é aceitável — no pior
 * caso ela volta a ficar no formato antigo e a migração converte depois.
 */
var _avisouFallbackFoto = false;
function uploadFotoOuManter(dataUrl, pasta) {
  return uploadFoto(dataUrl, pasta).catch(function(e) {
    console.warn('[fotos] upload falhou, mantendo a foto no formato antigo:', e && e.message);
    if (!_avisouFallbackFoto && typeof showToast === 'function') {
      _avisouFallbackFoto = true;
      showToast('Não foi possível enviar a foto para a nuvem — ela foi salva no formato antigo.', 'erro');
    }
    return dataUrl;
  });
}
