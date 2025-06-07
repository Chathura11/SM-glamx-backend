const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const sizeQuantitySchema = new Schema({
  size: {
    type: String,
    enum: ['S', 'M', 'L', 'XL', 'XXL', 'XXXL'],
    required: true
  },
  quantity: {
    type: Number,
    required: true,
    min: 0
  }
}, { _id: false });

const inventorySchema = new Schema({
  product: {
    type: Schema.Types.ObjectId,
    ref: 'Product',
    required: true,
    unique: true
  },
  sizes: [sizeQuantitySchema],
  lastUpdated: {
    type: Date,
    default: Date.now
  }
}, { timestamps: true });

module.exports = mongoose.model('Inventory', inventorySchema);
