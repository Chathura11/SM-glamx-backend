const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const salesTransactionSchema = new Schema({
    user: { 
        type: Schema.Types.ObjectId, 
        ref: 'User', 
        required: true 
    }, // staff who made the sale
    customerName: { 
        type: String 
    }, // optional field for walk-in or named customer
    totalAmount: { 
        type: Number, 
        required: true 
    }, // total sale price
    totalProfit: { 
        type: Number, 
        required: true 
    }, // calculated profit
    paymentMethod: { 
        type: String, 
        enum: ['Cash', 'Card', 'Online'], 
        default: 'Cash' 
    },
    status: { 
        type: String, 
        enum: ['Completed', 'Cancelled'], 
        default: 'Completed' 
    },
    createdAt: { 
        type: Date, 
        default: Date.now 
    }
}, { timestamps: true });

module.exports = mongoose.model('SalesTransaction', salesTransactionSchema);