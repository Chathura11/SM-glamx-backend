const Account = require('../models/account.model.js');
const JournalEntry = require('../models/journal.model.js');

exports.buyStock = async (amount, session = null) => {
  const cash = await Account.findOne({ name: 'Cash' }).session(session);
  const inventory = await Account.findOne({ name: 'Inventory' }).session(session);

  cash.balance -= amount;
  inventory.balance += amount;

  await Promise.all([
    cash.save({ session }),
    inventory.save({ session })
  ]);

  return await JournalEntry.create([{
    description: 'Stock Purchase',
    debit: { account: inventory._id, amount },
    credit: { account: cash._id, amount }
  }], { session });
};

exports.recordSale = async ({ salePrice, costPrice,customerName }) => {
    const cash = await Account.findOne({ name: 'Cash' });
    const inventory = await Account.findOne({ name: 'Inventory' });
    const cogs = await Account.findOne({ name: 'COGS' });
    const sales = await Account.findOne({ name: 'Sales Revenue' });
  
    cash.balance += salePrice;
    sales.balance += salePrice;
    inventory.balance -= costPrice;
    cogs.balance += costPrice;
  
    await Promise.all([cash.save(), sales.save(), inventory.save(), cogs.save()]);
  
    return JournalEntry.insertMany([
      {
        description: `Product Sale Revenue - ${customerName}`,
        debit: { account: cash._id, amount: salePrice },
        credit: { account: sales._id, amount: salePrice }
      },
      {
        description: `Product Cost(COGS) - ${customerName}`,
        debit: { account: cogs._id, amount: costPrice },
        credit: { account: inventory._id, amount: costPrice }
      }
    ]);
  };


  exports.addMoneyAsset = async ({ amount, source, target,description}) => {
    const sourceAcc = await Account.findOne({ name: source });
    const targetAcc = await Account.findOne({ name: target });
  
    if (!sourceAcc || !targetAcc) throw new Error('Invalid account name');
  
    sourceAcc.balance += amount; // Equity grows
    targetAcc.balance += amount; // Cash grows
  
    await Promise.all([sourceAcc.save(), targetAcc.save()]);
  
    return await JournalEntry.create({
      description,
      debit: { account: targetAcc._id, amount },
      credit: { account: sourceAcc._id, amount }
    });
  };


  exports.addExpense = async ({ amount, category, paidFrom, description }) => {
    const expenseAcc = await Account.findOne({ name: category });
    const paidFromAcc = await Account.findOne({ name: paidFrom });
  
    if (!expenseAcc || !paidFromAcc) throw new Error('Invalid account name');
  
    expenseAcc.balance += amount; // Expense increases
    paidFromAcc.balance -= amount; // Asset (Cash/Bank) decreases
  
    await Promise.all([expenseAcc.save(), paidFromAcc.save()]);
  
    return await JournalEntry.create({
      description: description || `Expense - ${category}`,
      debit: { account: expenseAcc._id, amount },
      credit: { account: paidFromAcc._id, amount }
    });
  };

  exports.getAllAccounts = async () => {
    return await Account.find().sort({ type: 1, name: 1 });
  };

  exports.getAllJournalEntries = async () => {
    return await JournalEntry.find()
      .populate('debit.account')
      .populate('credit.account')
      .sort({ date: -1 });
  };