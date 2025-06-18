const StockEntry = require('../models/stockEntry.model');
const StockEntryItem = require('../models/stockEntryItem.model');
const Inventory = require('../models/inventory.model');
const Product = require('../models/product.model');
const accountService = require('./account.service.js'); 
const mongoose = require('mongoose');

exports.createStockEntry = async (data, user) => {
  const { supplier, invoiceNumber, items, location } = data;

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const stockEntry = await StockEntry.create([{ 
      supplier,
      invoiceNumber,
      createdBy: user._id,
      location
    }], { session });

    let totalAmount = 0;

    for (const item of items) {
      const product = item.product;
      const size = item.size;
      const quantity = Number(item.quantity);
      const costPrice = Number(item.costPrice);

      if (!product || !size || isNaN(quantity) || isNaN(costPrice)) {
        throw new Error('Invalid product, size, quantity, or cost price');
      }

      totalAmount += quantity * costPrice;

      await StockEntryItem.create([{
        stockEntry: stockEntry[0]._id,
        product,
        size,
        quantity,
        costPrice
      }], { session });

      let inventory = await Inventory.findOne({ product }).session(session);

      if (!inventory) {
        inventory = await Inventory.create([{
          product,
          sizes: [{ size, quantity }]
        }], { session });
      } else {
        const sizeEntry = inventory.sizes.find(s => s.size === size);
        if (sizeEntry) {
          sizeEntry.quantity += quantity;
        } else {
          inventory.sizes.push({ size, quantity });
        }
        inventory.lastUpdated = new Date();
        await inventory.save({ session });
      }

      // Optional: Update average cost price
      const prod = await Product.findById(product).session(session);
      prod.averageCostPrice = costPrice;
      await prod.save({ session });
    }

    stockEntry[0].totalAmount = totalAmount;
    await stockEntry[0].save({ session });

    // ===>> ACCOUNTING ENTRY HERE
    await accountService.buyStock(totalAmount, session); // passing session to keep consistency

    await session.commitTransaction();
    session.endSession();

    return stockEntry[0]._id;
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    throw error;
  }
};
  
  exports.getAllStockEntriesDetailed = async ()=> {
    // Find all stock entries
    const entries = await StockEntry.find()
      .populate('supplier', 'name') // Populate supplier name only
      .populate('createdBy', 'username') // Populate creator username
      .lean();
  
    // For each entry, find related StockEntryItems and populate product info
    const entriesWithItems = await Promise.all(
      entries.map(async (entry) => {
        const items = await StockEntryItem.find({ stockEntry: entry._id })
          .populate('product', 'name')
          .lean();
  
        return {
          ...entry,
          items,
        };
      })
    );
  
    return entriesWithItems;
  }


exports.getAllStockEntries = async () => {
    return await StockEntry.find()
      .populate('supplier', 'name') // only get supplier name
      .sort({ createdAt: -1 });     // latest first
  };


  exports.getAllStockEntryItems = async () => {
    return await StockEntryItem.find().populate('product', 'name code');
  };
  
  exports.getStockEntryItemByProductAndSize = async (productId, size) => {
    return await StockEntryItem.findOne({ product: productId, size });
  };


  // exports.getFIFOStockItem = async (productId, size, quantity) => {
  //   const items = await StockEntryItem.find({
  //     product: productId,
  //     size,
  //     quantity: { $gt: 0 }
  //   }).sort({ createdAt: 1 }); // FIFO order
  
  //   let totalCost = 0;
  //   let qtyLeft = quantity;
  
  //   for (const item of items) {
  //     const useQty = Math.min(qtyLeft, item.quantity);
  //     totalCost += useQty * item.costPrice;
  //     qtyLeft -= useQty;
  //     if (qtyLeft === 0) break;
  //   }
  
  //   if (qtyLeft > 0) throw new Error("Not enough stock available for FIFO");
  
  //   return totalCost / quantity; // average cost per unit using FIFO
  // };

  exports.getFIFOStockItem = async (productId, size, quantity) => {
    const quantityToSell = quantity;
  
    // Step 1: Get current remaining quantity from inventory
    const inventory = await Inventory.findOne({ product: productId });
    if (!inventory) throw new Error('Inventory not found for product');
  
    const sizeEntry = inventory.sizes.find(s => s.size === size);
    if (!sizeEntry || sizeEntry.quantity < quantityToSell) {
      throw new Error(`Not enough stock for product (Size ${size})`);
    }
  
    const remainingQtyInInventory = sizeEntry.quantity;
  
    // Step 2: Get all historical stock entries sorted by createdAt (FIFO)
    const stockEntries = await StockEntryItem.find({
      product: productId,
      size
    }).sort({ createdAt: 1 });
  
    // Step 3: Calculate how many items were sold before this transaction
    const soldQuantity = stockEntries.reduce((acc, entry) => acc + entry.quantity, 0) - remainingQtyInInventory;
  
    // Step 4: Loop through entries to find which batches this sale should use
    let cumulativeQty = 0;
    let remainingSaleQty = quantityToSell;
    let totalCost = 0;
  
    for (const entry of stockEntries) {
      cumulativeQty += entry.quantity;
  
      if (soldQuantity >= cumulativeQty) {
        // This batch is already fully consumed
        continue;
      }
  
      const availableQtyFromThisBatch = cumulativeQty - soldQuantity;
      const usedQty = Math.min(availableQtyFromThisBatch, remainingSaleQty);
  
      totalCost += usedQty * entry.costPrice;
      remainingSaleQty -= usedQty;
  
      if (remainingSaleQty === 0) break;
    }
  
    if (remainingSaleQty > 0) {
      throw new Error('Not enough valid stock to calculate FIFO cost');
    }
  
    return totalCost / quantityToSell; // average cost per unit
  };