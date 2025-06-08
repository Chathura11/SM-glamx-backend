const { createSalesTransaction } = require('../services/salesTransaction.service');

exports.createTransactionController = async (req, res) => {
  try {
    const userId = req.user._id; // assuming authentication middleware
    const result = await createSalesTransaction({
      userId,
      customerName: req.body.customerName || '',
      paymentMethod: req.body.paymentMethod || 'Cash',
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
