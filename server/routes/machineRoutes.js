const express = require('express');
const router = express.Router();
const Machine = require('../models/Machine');
const { protect } = require('../middleware/authMiddleware');
const { allowRoles } = require('../middleware/roleMiddleware');
const { sendServerError } = require('../utils/errorResponse');

router.use(protect);

// GET all machines
router.get('/', async (req, res) => {
  try {
    const { status, category } = req.query;
    const filter = {};
    if (status)   filter.status = status;
    if (category) filter.category = category;
    const machines = await Machine.find(filter).sort({ machineId: 1 });
    res.json({ success: true, count: machines.length, machines });
  } catch (err) {
    sendServerError(res, err, 'machineRoutes');
  }
});

// GET single machine
router.get('/:id', async (req, res) => {
  try {
    const machine = await Machine.findById(req.params.id);
    if (!machine) return res.status(404).json({ success: false, message: 'Machine not found' });
    res.json({ success: true, machine });
  } catch (err) {
    sendServerError(res, err, 'machineRoutes');
  }
});

// POST create machine
router.post('/', allowRoles('superadmin', 'admin'), async (req, res) => {
  try {
    const machine = await Machine.create(req.body);
    res.status(201).json({ success: true, message: 'Machine added', machine });
  } catch (err) {
    sendServerError(res, err, 'machineRoutes');
  }
});

// PUT update machine
router.put('/:id', allowRoles('superadmin', 'admin'), async (req, res) => {
  try {
    const machine = await Machine.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!machine) return res.status(404).json({ success: false, message: 'Machine not found' });
    res.json({ success: true, message: 'Machine updated', machine });
  } catch (err) {
    sendServerError(res, err, 'machineRoutes');
  }
});

// DELETE machine
router.delete('/:id', allowRoles('superadmin'), async (req, res) => {
  try {
    await Machine.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'Machine deleted' });
  } catch (err) {
    sendServerError(res, err, 'machineRoutes');
  }
});

module.exports = router;
