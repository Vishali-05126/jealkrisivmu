const express = require('express');
const router = express.Router();
const Alert = require('../models/Alert');
const User = require('../models/User');
const { protect } = require('../middleware/auth');

// ── GET /api/alerts ──────────────────────────
// Fetch open alerts, optionally filtered by blood type or location
router.get('/', protect, async (req, res) => {
  try {
    const { bloodType, lat, lng, radius = 20000 } = req.query; // radius in meters

    let query = { status: 'open', expiresAt: { $gt: new Date() } };
    if (bloodType) query.bloodType = { $in: [bloodType, 'O-'] }; // O- is universal

    let alerts;

    if (lat && lng) {
      // Geo query — find alerts near user
      alerts = await Alert.find({
        ...query,
        'hospital.location': {
          $near: {
            $geometry: { type: 'Point', coordinates: [parseFloat(lng), parseFloat(lat)] },
            $maxDistance: parseInt(radius),
          },
        },
      })
        .populate('requestedBy', 'name bloodType')
        .sort({ createdAt: -1 })
        .limit(20);
    } else {
      alerts = await Alert.find(query)
        .populate('requestedBy', 'name bloodType')
        .sort({ severity: 1, createdAt: -1 })
        .limit(20);
    }

    res.json({ alerts });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── POST /api/alerts ─────────────────────────
// Hospital or admin creates a new blood request alert
router.post('/', protect, async (req, res) => {
  try {
    const { type, severity, title, message, bloodType, unitsNeeded, hospital } = req.body;

    const alert = await Alert.create({
      type, severity, title, message, bloodType, unitsNeeded,
      hospital, requestedBy: req.user._id,
    });

    // Emit to all connected clients via Socket.IO
    const io = req.app.get('io');
    if (io) io.emit('new_alert', alert);

    res.status(201).json({ alert });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── PUT /api/alerts/:id/accept ───────────────
// Donor accepts a blood request
router.put('/:id/accept', protect, async (req, res) => {
  try {
    const alert = await Alert.findById(req.params.id);
    if (!alert) return res.status(404).json({ message: 'Alert not found' });
    if (alert.status !== 'open') return res.status(400).json({ message: 'Alert already accepted' });

    alert.status = 'accepted';
    alert.acceptedBy = req.user._id;
    await alert.save();

    // Notify all clients of the status change
    const io = req.app.get('io');
    if (io) io.emit('alert_updated', { id: alert._id, status: 'accepted', acceptedBy: req.user.name });

    res.json({ alert, message: 'Request accepted — navigate to hospital' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── PUT /api/alerts/:id/fulfill ──────────────
// Mark donation as complete
router.put('/:id/fulfill', protect, async (req, res) => {
  try {
    const alert = await Alert.findByIdAndUpdate(
      req.params.id,
      { status: 'fulfilled' },
      { new: true }
    );

    // Increment donor's donation count and lives saved
    await User.findByIdAndUpdate(req.user._id, {
      $inc: { donations: 1, livesSaved: 1 },
      lastDonation: new Date(),
    });

    const io = req.app.get('io');
    if (io) io.emit('alert_updated', { id: alert._id, status: 'fulfilled' });

    res.json({ alert, message: 'Donation confirmed — life saved!' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── GET /api/alerts/nearby-donors ────────────
// Find verified donors near a hospital for a specific blood type
router.get('/nearby-donors', protect, async (req, res) => {
  try {
    const { lat, lng, bloodType, radius = 10000 } = req.query;

    const donors = await User.find({
      role: 'donor',
      isAvailable: true,
      bloodType: { $in: [bloodType, 'O-'] },
      location: {
        $near: {
          $geometry: { type: 'Point', coordinates: [parseFloat(lng), parseFloat(lat)] },
          $maxDistance: parseInt(radius),
        },
      },
    })
      .select('name bloodType trustScore donations location isAvailable verifiedBadge')
      .limit(10);

    res.json({ donors, count: donors.length });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
