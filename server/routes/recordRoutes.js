const express = require('express');
const router = express.Router();
const WeightRecord = require('../models/WeightRecord');
const { protect } = require('../middleware/authMiddleware');
const { allowRoles } = require('../middleware/roleMiddleware');
const { sendServerError } = require('../utils/errorResponse');

router.use(protect);

// GET all records with filters + pagination
router.get('/', async (req, res) => {
  try {
    const { page = 1, limit = 10, search, machine, status } = req.query;
    const filter = {};
    if (machine) filter.machine = machine;
    if (status)  filter.status  = status;

    let records = await WeightRecord.find(filter)
      .populate('product', 'productName productId batchNumber')
      .populate('machine', 'machineId name')
      .populate('operator', 'name')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(Number(limit));

    // search filter on populated fields
    if (search) {
      const s = search.toLowerCase();
      records = records.filter(r =>
        r.product?.productName?.toLowerCase().includes(s) ||
        r.product?.productId?.toLowerCase().includes(s) ||
        r.product?.batchNumber?.toLowerCase().includes(s)
      );
    }

    const total = await WeightRecord.countDocuments(filter);
    res.json({ success: true, count: total, totalPages: Math.ceil(total / limit), currentPage: Number(page), records });
  } catch (err) {
    sendServerError(res, err, 'recordRoutes');
  }
});

// POST create record. Mutating/privileged operation — matches the same
// allowRoles('superadmin','admin') convention already used for the
// equivalent create routes in productRoutes.js, machineRoutes.js, and
// batchRoutes.js. Without this, any authenticated Admin — including the
// lowest-privilege Admin role, 'operator' — could create arbitrary
// WeightRecord documents with no role check at all.
router.post('/', allowRoles('superadmin', 'admin'), async (req, res) => {
  try {
    const { productId, machineId, actualWeight, nominalWeight, notes } = req.body;
    const record = await WeightRecord.create({
      product: productId,
      machine: machineId,
      operator: req.admin._id,
      actualWeight: Number(actualWeight),
      nominalWeight: Number(nominalWeight),
      notes,
    });
    await record.populate('product', 'productName productId batchNumber');
    await record.populate('machine', 'machineId name');
    await record.populate('operator', 'name');
    res.status(201).json({ success: true, message: 'Record saved', record });
  } catch (err) {
    sendServerError(res, err, 'recordRoutes');
  }
});

// DELETE record — destructive, restricted to superadmin only, matching
// productRoutes.js/machineRoutes.js's delete convention.
router.delete('/:id', allowRoles('superadmin'), async (req, res) => {
  try {
    await WeightRecord.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'Record deleted' });
  } catch (err) {
    sendServerError(res, err, 'recordRoutes');
  }
});

module.exports = router;
