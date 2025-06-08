const express = require('express');
const router = express.Router();
const { createTransactionController,getAllTransactionsController } = require('../controllers/salesTransaction.controller');
const { isAuthenticated, checkPermission } = require('../middleware/middleware');

router.post('/', isAuthenticated,createTransactionController);

router.get('/', isAuthenticated, getAllTransactionsController);

module.exports = router;