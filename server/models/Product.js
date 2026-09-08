const mongoose = require('mongoose');

const ProductSchema = new mongoose.Schema(
  {
    productName: { type: String, required: true, trim: true },
    productNumber: { type: String, required: true, trim: true },
    productId:   { type: String, required: true, unique: true, trim: true },
    batchNumber: { type: String, required: true, trim: true },
    storageLocation: {
      type: String,
      required: true,
      enum: [
        'Warehouse A - Cold Storage',
        'Warehouse B - Ambient',
        'Greenhouse Section 04',
        'Distribution Hub 12',
      ],
    },
    seedType: {
      type: String,
      required: true,
      enum: ['Organic', 'Hybrid', 'Heirloom', 'Modified'],
    },
    imageUrl:   { type: String, default: '' },
    qrCodeUrl:  { type: String, default: '' },
    qrCodeData: { type: String, default: '' },
    createdBy:  { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Product', ProductSchema);
