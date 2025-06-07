const express = require('express');
const router = express.Router();
const { createTransactionController } = require('../controllers/salesTransaction.controller');
const { isAuthenticated, checkPermission } = require('../middleware/middleware');

router.post('/', isAuthenticated,createTransactionController);

module.exports = router;