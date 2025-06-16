// services/salesTransaction.service.js
const mongoose = require('mongoose');
const SalesTransaction = require('../models/salesTransaction.model');
const TransactionItem = require('../models/transactionItem.model');
const Product = require('../models/product.model');
const Inventory = require('../models/inventory.model');
const accountService = require('./account.service.js'); 
const JournalEntry = require('../models/journal.model');
const Account = require('../models/account.model');

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

    const saleAmount = status === 'Free' ? 0 : (totalAmount - discount);

    // Apply journal accounting entry
    await accountService.recordSale({
      salePrice: saleAmount,
      costPrice: totalCost,
      customerName:customerName
    });

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


async function reverseTransaction(transactionId, userId) {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const transaction = await SalesTransaction.findById(transactionId).session(session);
    if (!transaction) throw new Error('Transaction not found');
    if (transaction.status === 'Cancelled') throw new Error('Transaction already cancelled');

    const totalSale =transaction.status ==='Free' ? 0 : transaction.totalAmount;

    // Mark as cancelled
    transaction.status = 'Cancelled';
    transaction.reversedBy = userId;
    transaction.reversedAt = new Date();
    await transaction.save({ session });

    const items = await TransactionItem.find({ transaction: transactionId }).session(session);

    let totalCost = 0;
    for (const item of items) {
      const inventory = await Inventory.findOne({ product: item.product }).session(session);
      const sizeEntry = inventory.sizes.find(s => s.size === item.size);

      if (!sizeEntry) {
        inventory.sizes.push({ size: item.size, quantity: item.quantity });
      } else {
        sizeEntry.quantity += item.quantity;
      }

      inventory.lastUpdated = new Date();
      await inventory.save({ session });

      totalCost += item.costPrice * item.quantity;
    }

    // === Account reversal ===
    const cash = await Account.findOne({ name: 'Cash' }).session(session);
    const sales = await Account.findOne({ name: 'Sales Revenue' }).session(session);
    const inventoryAcc = await Account.findOne({ name: 'Inventory' }).session(session);
    const cogs = await Account.findOne({ name: 'COGS' }).session(session);

    if (!cash || !sales || !inventoryAcc || !cogs) {
      throw new Error('One or more required accounts not found');
    }

    const journalEntries = [];

    // If it was a paid sale
    if (totalSale > 0) {
      cash.balance -= totalSale;
      sales.balance -= totalSale;

      journalEntries.push({
        description: `Reversal - Sale Refund for transaction ${transactionId}`,
        debit: { account: sales._id, amount: totalSale },
        credit: { account: cash._id, amount: totalSale }
      });
    }

    // Always reverse COGS and Inventory
    inventoryAcc.balance += totalCost;
    cogs.balance -= totalCost;

    journalEntries.push({
      description: totalSale > 0
        ? `Reversal - Restore Inventory for transaction ${transactionId}`
        : `Reversal - Free Sale Return ${transactionId}`,
      debit: { account: inventoryAcc._id, amount: totalCost },
      credit: { account: cogs._id, amount: totalCost }
    });

    const updates = [inventoryAcc.save({ session }), cogs.save({ session })];
    if (totalSale > 0) updates.push(cash.save({ session }), sales.save({ session }));
    await Promise.all(updates);

    await JournalEntry.insertMany(journalEntries, { session });

    await session.commitTransaction();
    session.endSession();
    return { message: 'Transaction reversed successfully' };
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    throw err;
  }
}

async function markTransactionCompleted (transactionId){
  const transaction = await SalesTransaction.findById(transactionId);
  
  if (!transaction) {
    const error = new Error('Transaction not found');
    error.status = 404;
    throw error;
  }

  if (transaction.status !== 'Pending') {
    const error = new Error('Only pending transactions can be marked as completed');
    error.status = 400;
    throw error;
  }

  transaction.status = 'Completed';
  await transaction.save();

  return transaction;
};

async function getTransactionWithItems(transactionId){
  const transaction = await SalesTransaction.findById(transactionId)
    .populate('user', 'username') // Populate user who did the sale
    .lean();

  const items = await TransactionItem.find({ transaction: transactionId })
    .populate({
      path: 'product',
      select: 'name brand category',
      populate: [
        { path: 'brand', select: 'name' },
        { path: 'category', select: 'name' }
      ]
    })
    .lean();

  return { transaction, items };
};


module.exports = {
  createSalesTransaction,
  getAllSalesTransactions,
  reverseTransaction,
  markTransactionCompleted,
  getTransactionWithItems 
};
