const express = require('express');
const router = express.Router();
const clientController = require('../controllers/clientController');

router.get('/', clientController.getClients);
router.get('/:email', clientController.getClientByEmail);
router.post('/', clientController.createClient);
router.put('/:email', clientController.updateClient);
router.delete('/:email', clientController.deleteClient);

module.exports = router;
