const { createSalesTransaction,getAllSalesTransactions  } = require('../services/salesTransaction.service');

exports.createTransactionController = async (req, res) => {
  try {
    const userId = req.user._id; // assuming authentication middleware
    const result = await createSalesTransaction({
      userId,
      customerName: req.body.customerName || '',
      paymentMethod: req.body.paymentMethod || 'Cash',
      status: req.body.status || 'Completed',
      items: req.body.items,
      discount:req.body.discount
    });

    res.status(201).json({
      message: 'Transaction created successfully',
      transaction: result
    });
  } catch (error) {
    res.status(500).json({
      message: 'Transaction failed',
      error: error.message
    });
    console.log(error);
  }
};

exports.getAllTransactionsController = async (req, res) => {
  try {
    const transactions = await getAllSalesTransactions();
    res.json({ data: transactions });
  } catch (error) {
    console.error('Error getting sales transactions:', error);
    res.status(500).json({ error: 'Server error' });
  }
};
