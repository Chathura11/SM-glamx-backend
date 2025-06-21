const mongoose = require('mongoose');
const SalesTransaction = require('../models/salesTransaction.model');
const TransactionItem = require('../models/transactionItem.model');
const Inventory = require('../models/inventory.model');
const SalesReturn = require('../models/salesReturn.model');
const Account = require('../models/account.model');
const JournalEntry = require('../models/journal.model');

exports.processReturn = async ({ transactionId, items, userId }) => {
  const session = await mongoose.startSession();

  try {
    let returnDoc = null;

    await session.withTransaction(async () => {
      const transaction = await SalesTransaction.findById(transactionId).session(session);
      if (!transaction) throw new Error('Original transaction not found');

      if (transaction.status === 'Cancelled') {
        throw new Error('This transaction has already been canceled!');
      }

      const originalItems = await TransactionItem.find({ transaction: transactionId }).session(session);
      const isFree = transaction.status === 'Free';

      let totalReturnAmount = 0;
      let totalReturnCost = 0;
      const journalEntries = [];

      for (const returnItem of items) {
        const match = originalItems.find(
          i => i.product.toString() === returnItem.product && i.size === returnItem.size
        );
        if (!match) throw new Error(`Product/size not found in original transaction`);

        // --- Validate already returned quantity ---
        const productId = typeof match.product === 'string'
          ? new mongoose.Types.ObjectId(match.product)
          : match.product;

        const totalPreviousReturns = await SalesReturn.aggregate([
          { $match: { transaction: new mongoose.Types.ObjectId(transaction._id) } },
          { $unwind: '$items' },
          {
            $match: {
              'items.product': productId,
              'items.size': match.size
            }
          },
          {
            $group: {
              _id: null,
              total: { $sum: '$items.quantity' }
            }
          }
        ]).session(session);

        const alreadyReturnedQty = totalPreviousReturns[0]?.total || 0;
        const remainingQty = match.quantity - alreadyReturnedQty;

        if (returnItem.quantity > remainingQty) {
          throw new Error(`Return quantity exceeds sold quantity for product`);
        }

        // --- Update Inventory ---
        const inventory = await Inventory.findOne({ product: returnItem.product }).session(session);
        if (!inventory) throw new Error('Inventory record not found');

        const sizeEntry = inventory.sizes.find(s => s.size === returnItem.size);
        if (sizeEntry) {
          sizeEntry.quantity += returnItem.quantity;
        } else {
          inventory.sizes.push({ size: returnItem.size, quantity: returnItem.quantity });
        }

        await inventory.save({ session });

        // --- Calculate for accounts ---
        const returnAmount = match.sellingPrice * returnItem.quantity;
        const returnCost = match.costPrice * returnItem.quantity;
        totalReturnAmount += returnAmount;
        totalReturnCost += returnCost;
      }

      // --- Record the return document ---
      returnDoc = await SalesReturn.create([{
        transaction: transactionId,
        items,
        returnedBy: userId
      }], { session });

      // --- Accounting & Journal ---
      if (!isFree && totalReturnAmount > 0) {
        const [cash, sales, inventoryAcc, cogs] = await Promise.all([
          Account.findOne({ name: 'Cash' }).session(session),
          Account.findOne({ name: 'Sales Revenue' }).session(session),
          Account.findOne({ name: 'Inventory' }).session(session),
          Account.findOne({ name: 'COGS' }).session(session),
        ]);

        if (!cash || !sales || !inventoryAcc || !cogs) {
          throw new Error('Required accounts not found');
        }

        // Update balances
        cash.balance -= totalReturnAmount;
        sales.balance -= totalReturnAmount;
        inventoryAcc.balance += totalReturnCost;
        cogs.balance -= totalReturnCost;

        await Promise.all([
          cash.save({ session }),
          sales.save({ session }),
          inventoryAcc.save({ session }),
          cogs.save({ session })
        ]);

        journalEntries.push(
          {
            description: `Sales Return - Refund for ${transaction.customerName}`,
            debit: { account: sales._id, amount: totalReturnAmount },
            credit: { account: cash._id, amount: totalReturnAmount }
          },
          {
            description: `Sales Return - Restore inventory for ${transaction.customerName}`,
            debit: { account: inventoryAcc._id, amount: totalReturnCost },
            credit: { account: cogs._id, amount: totalReturnCost }
          }
        );

        await JournalEntry.insertMany(journalEntries, { session });
      }

      if (isFree) {
        const inventoryAcc = await Account.findOne({ name: 'Inventory' }).session(session);
        const cogsAcc = await Account.findOne({ name: 'COGS' }).session(session);

        if (!inventoryAcc || !cogsAcc) throw new Error('Inventory or COGS account not found');

        await JournalEntry.create([{
          description: `Return of Free Item - Transaction ${transactionId}`,
          debit: { account: inventoryAcc._id, amount: totalReturnCost },
          credit: { account: cogsAcc._id, amount: totalReturnCost }
        }], { session });

        inventoryAcc.balance += totalReturnCost;
        cogsAcc.balance -= totalReturnCost;

        await Promise.all([
          inventoryAcc.save({ session }),
          cogsAcc.save({ session }),
        ]);
      }
    });

    return returnDoc?.[0];
  } catch (err) {
    console.error('Sales return failed:', err);
    throw err;
  } finally {
    session.endSession();
  }
};

exports.getReturnsByTransaction = async (transactionId) => {
  const returns = await SalesReturn.find({ transaction: transactionId })
    .populate('returnedBy', 'name')
    .populate({
      path: 'items.product',
      populate: [
        { path: 'category', select: 'name' },
        { path: 'brand', select: 'name' }
      ],
      select: 'name category brand'
    })
    .lean();

  return returns;
};

exports.getAllSalesReturns = async () => {
  const returns = await SalesReturn.find()
    .populate('returnedBy', 'name')
    .populate({
      path: 'items.product',
      populate: [
        { path: 'category', select: 'name' },
        { path: 'brand', select: 'name' }
      ],
      select: 'name category brand'
    })
    .populate('transaction', 'customerName createdAt totalAmount')
    .sort({ createdAt: -1 }) // Optional: newest first
    .lean();

  return returns;
};
