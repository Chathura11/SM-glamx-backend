const StockEntry = require('../models/stockEntry.model');
const StockEntryItem = require('../models/stockEntryItem.model');
const Inventory = require('../models/inventory.model');
const Product = require('../models/product.model');

exports.createStockEntry = async (data, user) => {
    const { supplier, invoiceNumber, items, location } = data;
  
    const stockEntry = await StockEntry.create({
      supplier,
      invoiceNumber,
      createdBy: user._id,
      location
    });
  
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
  
      await StockEntryItem.create({
        stockEntry: stockEntry._id,
        product,
        size,
        quantity,
        costPrice
      });
  
      let inventory = await Inventory.findOne({ product });
  
      if (!inventory) {
        inventory = await Inventory.create({
          product,
          sizes: [{ size, quantity }]
        });
      } else {
        const sizeEntry = inventory.sizes.find(s => s.size === size);
        if (sizeEntry) {
          sizeEntry.quantity += quantity;
        } else {
          inventory.sizes.push({ size, quantity });
        }
        inventory.lastUpdated = new Date();
        await inventory.save();
      }
  
      // Average cost price logic (optional per size, or overall)
      const prod = await Product.findById(product);
      prod.averageCostPrice = costPrice; // or calculate more precisely
      await prod.save();
    }
  
    stockEntry.totalAmount = totalAmount;
    await stockEntry.save();
  
    return stockEntry._id;
  };
  


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


  exports.getFIFOStockItem = async (productId, size, quantity) => {
    const items = await StockEntryItem.find({
      product: productId,
      size,
      quantity: { $gt: 0 }
    }).sort({ createdAt: 1 }); // FIFO order
  
    let totalCost = 0;
    let qtyLeft = quantity;
  
    for (const item of items) {
      const useQty = Math.min(qtyLeft, item.quantity);
      totalCost += useQty * item.costPrice;
      qtyLeft -= useQty;
      if (qtyLeft === 0) break;
    }
  
    if (qtyLeft > 0) throw new Error("Not enough stock available for FIFO");
  
    return totalCost / quantity; // average cost per unit using FIFO
  };