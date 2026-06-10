const express = require('express');
const path = require('path');
const os = require('os');

const app = express();
const PORT = 3000;

// Servir arquivos estáticos da pasta public
app.use(express.static(path.join(__dirname, 'public')));

// Rota raiz
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/index.html'));
});

app.listen(PORT, () => {
  const interfaces = os.networkInterfaces();
  let localIP = 'localhost';

  // Encontrar IP local
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        localIP = iface.address;
        break;
      }
    }
  }

  console.log(`
╔═══════════════════════════════════════════════════╗
║        LaPink - Servidor de Desenvolvimento       ║
╚═══════════════════════════════════════════════════╝

🌐 Servidor rodando em:
   Local:    http://localhost:${PORT}
   Rede:     http://${localIP}:${PORT}

📱 Para acessar no celular:
   1. Certifique-se de que o celular está na mesma rede WiFi
   2. Abra o navegador no celular
   3. Acesse: http://${localIP}:${PORT}

Pressione CTRL+C para parar o servidor.
  `);
});
