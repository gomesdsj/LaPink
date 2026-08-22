'use strict';

// Teste manual do bucket real. Não guarda nem imprime tokens e sempre tenta
// remover o objeto temporário ao terminar.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const BUCKET = 'lapink-82a39.firebasestorage.app';
const objectName = `produtos/teste-persistencia-${Date.now()}.png`;
const documentId = `teste-persistencia-${Date.now()}`;
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
);

function findAccessToken(value) {
  if (!value || typeof value !== 'object') return null;
  if (typeof value.access_token === 'string') return value.access_token;
  for (const child of Object.values(value)) {
    const found = findAccessToken(child);
    if (found) return found;
  }
  return null;
}

async function main() {
  const configPath = path.join(os.homedir(), '.config', 'configstore', 'firebase-tools.json');
  const token = findAccessToken(JSON.parse(fs.readFileSync(configPath, 'utf8')));
  if (!token) throw new Error('Token ativo do Firebase CLI não encontrado. Execute firebase projects:list primeiro.');

  const encodedBucket = encodeURIComponent(BUCKET);
  const encodedName = encodeURIComponent(objectName);
  const uploadUrl = `https://storage.googleapis.com/upload/storage/v1/b/${encodedBucket}/o?uploadType=media&name=${encodedName}`;
  const objectUrl = `https://storage.googleapis.com/storage/v1/b/${encodedBucket}/o/${encodedName}`;
  const mediaUrl = `${objectUrl}?alt=media`;
  const headers = { Authorization: `Bearer ${token}` };
  const firestoreUrl = `https://firestore.googleapis.com/v1/projects/lapink-82a39/databases/(default)/documents/diagnosticos/${documentId}`;
  let uploaded = false;
  let documentCreated = false;

  try {
    const upload = await fetch(uploadUrl, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=31536000' },
      body: png
    });
    if (!upload.ok) throw new Error(`upload falhou (${upload.status}): ${await upload.text()}`);
    uploaded = true;
    const metadata = await upload.json();

    const download = await fetch(mediaUrl, { headers });
    if (!download.ok) throw new Error(`leitura falhou (${download.status}): ${await download.text()}`);
    const downloaded = Buffer.from(await download.arrayBuffer());
    if (!downloaded.equals(png)) throw new Error('bytes lidos são diferentes dos bytes enviados');
    if (metadata.contentType !== 'image/png') throw new Error(`contentType inesperado: ${metadata.contentType}`);
    if (Number(metadata.size) !== png.length) throw new Error(`tamanho inesperado: ${metadata.size}`);

    // Simula o catálogo: o Firestore guarda a referência persistente da foto,
    // nunca os bytes/base64 da imagem.
    const imageReference = `gs://${BUCKET}/${objectName}`;
    const writeDocument = await fetch(firestoreUrl, {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: {
        tipo: { stringValue: 'teste-persistencia-imagem' },
        imagem: { stringValue: imageReference },
        bytes: { integerValue: String(png.length) }
      } })
    });
    if (!writeDocument.ok) throw new Error(`gravação Firestore falhou (${writeDocument.status}): ${await writeDocument.text()}`);
    documentCreated = true;
    const readDocument = await fetch(firestoreUrl, { headers });
    if (!readDocument.ok) throw new Error(`leitura Firestore falhou (${readDocument.status}): ${await readDocument.text()}`);
    const saved = await readDocument.json();
    if (saved.fields?.imagem?.stringValue !== imageReference) throw new Error('referência da imagem não persistiu no Firestore');

    process.stdout.write(JSON.stringify({
      ok: true,
      bucket: BUCKET,
      object: objectName,
      bytes: downloaded.length,
      contentType: metadata.contentType,
      generation: metadata.generation
      ,firestoreDocument: `diagnosticos/${documentId}`
      ,imageReferencePersisted: true
    }, null, 2) + '\n');
  } finally {
    if (documentCreated) {
      const removedDocument = await fetch(firestoreUrl, { method: 'DELETE', headers });
      if (!removedDocument.ok && removedDocument.status !== 404) {
        throw new Error(`não foi possível remover o documento de teste (${removedDocument.status})`);
      }
    }
    if (uploaded) {
      const removed = await fetch(objectUrl, { method: 'DELETE', headers });
      if (!removed.ok && removed.status !== 404) {
        throw new Error(`não foi possível remover o objeto de teste (${removed.status})`);
      }
    }
  }
}

main().catch((error) => {
  console.error('[storage-live-test]', error.message);
  process.exitCode = 1;
});
