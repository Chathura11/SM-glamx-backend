// services/salesTransaction.service.js
const mongoose = require('mongoose');
const SalesTransaction = require('../models/salesTransaction.model');
const TransactionItem = require('../models/transactionItem.model');
const Product = require('../models/product.model');
const Inventory = require('../models/inventory.model');

async function createSalesTransaction({ userId, customerName, paymentMethod,status, items, discount}) {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    let totalAmount = 0;    // total selling price before discount
    let totalCost = 0;      // total cost price of items

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

      totalAmount += item.sellingPrice * item.quantity;
      totalCost += item.costPrice * item.quantity;

      const profitBeforeDiscount = (item.sellingPrice - item.costPrice) * item.quantity;

      transactionItems.push({
        product: product._id,
        quantity: item.quantity,
        sellingPrice: item.sellingPrice,
        costPrice: item.costPrice,
        profit: profitBeforeDiscount,
        size: item.size
      });
    }

    // Calculate total profit after discount applied proportionally
    // Profit after discount = totalAmount - discount - totalCost
    const totalProfitAfterDiscount = (totalAmount - discount) - totalCost;

    // Create SalesTransaction document
    const salesTransaction = new SalesTransaction({
      user: userId,
      customerName,
      totalAmount,
      totalProfit: totalProfitAfterDiscount,
      discount,
      paymentMethod,
      status,
    });

    await salesTransaction.save({ session });

    // Save each TransactionItem with ref to salesTransaction
    for (const item of transactionItems) {
      await TransactionItem.create([{
        transaction: salesTransaction._id,
        product: item.product,
        quantity: item.quantity,
        sellingPrice: item.sellingPrice,
        costPrice: item.costPrice,
        profit: item.profit,
        size: item.size
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

async function getAllSalesTransactions() {
  // Fetch all sales transactions with user populated
  const transactions = await SalesTransaction.find()
    .populate('user', 'name')   // only fetch user name
    .sort({ createdAt: -1 });

  // For each transaction, fetch related transaction items with product name populated
  const detailedTransactions = await Promise.all(
    transactions.map(async (tx) => {
      const items = await TransactionItem.find({ transaction: tx._id })
        .populate({
          path: 'product',
          select: 'name code category brand',
          populate: [
            { path: 'category', select: 'name' },
            { path: 'brand', select: 'name' }
          ]
        });

      return {
        ...tx.toObject(),
        items,
      };
    })
  );

  return detailedTransactions;
}

module.exports = {
  createSalesTransaction,
  getAllSalesTransactions
};
