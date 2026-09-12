const path = require('path');
const Product = require('../models/Product');
const generateQR = require('../utils/generateQR');
const { streamQrFile } = require('../utils/qrStorage');

// Matches the new GridFS-backed qrCodeUrl format (/api/qr/<fileId>). Older
// products predate GridFS and still carry a /uploads/qr/... filesystem path
// in this same field — those are left completely alone (see downloadQR).
const GRIDFS_QR_URL_RE = /^\/api\/qr\/([a-f\d]{24})$/i;

// POST /api/products  (multipart/form-data with optional image)
const createProduct = async (req, res) => {
  try {
    const { productName, productNumber, batchNumber, storageLocation, seedType } = req.body;

    // Auto-generate a unique productId
    const productId = `PRD-${productNumber}-${Date.now().toString(36).toUpperCase()}`;

    // Optional uploaded image
    const imageUrl = req.file ? `/uploads/products/${req.file.filename}` : '';

    const productData = { productName, productNumber, productId, batchNumber, storageLocation, seedType, imageUrl, createdBy: req.admin._id };
    const { qrCodeUrl, qrCodeData } = await generateQR(productData);

    const product = await Product.create({ ...productData, qrCodeUrl, qrCodeData });
    await product.populate('createdBy', 'name email');

    res.status(201).json({
      success: true,
      message: 'Product created and QR generated',
      product,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/products
const getProducts = async (req, res) => {
  try {
    const { page = 1, limit = 10, search, seedType, storageLocation } = req.query;

    const filter = {};
    if (search) {
      filter.$or = [
        { productName: { $regex: search, $options: 'i' } },
        { productId:   { $regex: search, $options: 'i' } },
        { batchNumber: { $regex: search, $options: 'i' } },
      ];
    }
    if (seedType)         filter.seedType = seedType;
    if (storageLocation)  filter.storageLocation = storageLocation;

    const total = await Product.countDocuments(filter);
    const products = await Product.find(filter)
      .populate('createdBy', 'name email')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(Number(limit));

    res.json({
      success: true,
      count: total,
      totalPages: Math.ceil(total / limit),
      currentPage: Number(page),
      products,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/products/:id
const getProduct = async (req, res) => {
  try {
    const product = await Product.findById(req.params.id).populate('createdBy', 'name email');
    if (!product) return res.status(404).json({ success: false, message: 'Product not found' });
    res.json({ success: true, product });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/products/:id/qr — download PNG
const downloadQR = async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ success: false, message: 'Product not found' });

    const gridfsMatch = (product.qrCodeUrl || '').match(GRIDFS_QR_URL_RE);
    if (gridfsMatch) {
      const stream = await streamQrFile(gridfsMatch[1]);
      if (!stream) return res.status(404).json({ success: false, message: 'QR not found' });
      res.set('Content-Type', 'image/png');
      res.set('Content-Disposition', `attachment; filename="QR-${product.productId}.png"`);
      stream.on('error', () => {
        if (!res.headersSent) res.status(404).json({ success: false, message: 'QR not found' });
      });
      return stream.pipe(res);
    }

    // Legacy pre-GridFS product: qrCodeUrl is still a filesystem path.
    const filePath = path.join(__dirname, '..', product.qrCodeUrl);
    res.download(filePath, `QR-${product.productId}.png`);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// PUT /api/products/:id
const updateProduct = async (req, res) => {
  try {
    const { productName, batchNumber, storageLocation, seedType } = req.body;
    const updateFields = { productName, storageLocation, seedType };
    if (batchNumber) updateFields.batchNumber = batchNumber;
    const product = await Product.findByIdAndUpdate(
      req.params.id,
      updateFields,
      { new: true, runValidators: true }
    ).populate('createdBy', 'name email');

    if (!product) return res.status(404).json({ success: false, message: 'Product not found' });

    res.json({ success: true, message: 'Product updated', product });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// DELETE /api/products/:id — superadmin only
const deleteProduct = async (req, res) => {
  try {
    const product = await Product.findByIdAndDelete(req.params.id);
    if (!product) return res.status(404).json({ success: false, message: 'Product not found' });
    res.json({ success: true, message: 'Product deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = { createProduct, getProducts, getProduct, downloadQR, updateProduct, deleteProduct };
