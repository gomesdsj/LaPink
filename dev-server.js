const express = require('express');
const path    = require('path');
const os      = require('os');

const app  = express();
const PORT = process.env.PORT || Math.floor(Math.random() * 6000) + 3000;
const ROOT = __dirname;

// Serve a raiz inteira: /admin, /public, /data, /css, /assets, etc.
app.use(express.static(ROOT, { dotfiles: 'ignore' }));

// Rota raiz → loja V1
app.get('/', (req, res) => {
  res.redirect('/public/V1.html');
});

function getLocalIP() {
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const i of ifaces) {
      if (i.family === 'IPv4' && !i.internal) return i.address;
    }
  }
  return 'localhost';
}

app.listen(PORT, '0.0.0.0', () => {
  const ip = getLocalIP();
  console.log(`
╔══════════════════════════════════════════════════════╗
║         LaPink — Servidor de Desenvolvimento         ║
╚══════════════════════════════════════════════════════╝

  Local :  http://localhost:${PORT}
  Rede  :  http://${ip}:${PORT}

  Loja  :  http://${ip}:${PORT}/public/V1.html
  Admin :  http://${ip}:${PORT}/admin/login.html

  Celular: conecte ao mesmo Wi-Fi e acesse a URL de Rede.
  CTRL+C para parar.
`);
});
