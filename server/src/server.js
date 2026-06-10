const express = require('express');
const cors = require('cors');
const clientRoutes = require('./routes/clients');
const orderRoutes = require('./routes/orders');

const app = express();
app.use(cors());
app.use(express.json());

app.use('/api/clients', clientRoutes);
app.use('/api/orders', orderRoutes);

app.get('/', (req, res) => {
  res.send('LaPink API está rodando. Use /api/clients ou /api/orders.');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor LaPink rodando em http://localhost:${PORT}`);
});
