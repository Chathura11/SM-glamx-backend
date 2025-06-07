const mongoose = require('mongoose');
const SalesTransaction = require('../models/salesTransaction.model');
const TransactionItem = require('../models/transactionItem.model');
const Product = require('../models/product.model');
const Inventory = require('../models/inventory.model');

async function createSalesTransaction({ userId, customerName, paymentMethod = 'Cash', items }) {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    let totalAmount = 0;
    let totalProfit = 0;

    // Step 1: Prepare item details
    const transactionItems = [];

    for (const item of items) {
      const product = await Product.findById(item.product).session(session);
      if (!product) throw new Error(`Product not found: ${item.product}`);

      const inventory = await Inventory.findOne({ product: product._id }).session(session);
      if (!inventory) throw new Error(`Inventory not found for product: ${product.name}`);

      const sizeEntry = inventory.sizes.find(s => s.size === item.size);
      if (!sizeEntry || sizeEntry.quantity < item.quantity) {
        throw new Error(`Not enough stock for product ${product.name} - Size ${item.size}`);
      }

      // Reduce inventory
      sizeEntry.quantity -= item.quantity;
      inventory.lastUpdated = new Date();
      await inventory.save({ session });

      const sellingPrice = item.sellingPrice;
      const costPrice = item.costPrice; // ✅ Use costPrice from frontend
      const profit = item.profit ?? (sellingPrice - costPrice) * item.quantity; // Fallback if needed

      totalAmount += sellingPrice * item.quantity;
      totalProfit += profit;

      transactionItems.push({
        product: product._id,
        quantity: item.quantity,
        sellingPrice,
        costPrice,
        profit,
        size: item.size // Not in schema, but may be added to support size tracking
      });
    }

    // Step 2: Create SalesTransaction
    const salesTransaction = new SalesTransaction({
      user: userId,
      customerName,
      totalAmount,
      totalProfit,
      paymentMethod,
      status: 'Completed',
    });

    await salesTransaction.save({ session });

    // Step 3: Save each TransactionItem
    for (const item of transactionItems) {
      await TransactionItem.create([{
        transaction: salesTransaction._id,
        product: item.product,
        quantity: item.quantity,
        sellingPrice: item.sellingPrice,
        costPrice: item.costPrice,
        profit: item.profit,
        size: item.size // ✅ This is the missing field
      }], { session });
    }

    await session.commitTransaction();
    session.endSession();

    return salesTransaction;

  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    throw error;
  }
}

module.exports = {
  createSalesTransaction
};
