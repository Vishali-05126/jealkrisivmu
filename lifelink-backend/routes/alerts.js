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
    const { type, severity, title, message, bloodType, unitsNeeded, hospital, location } = req.body;

    let alertHospital = hospital;

    // For SOS alerts, find nearest hospital if not provided
    if (type === 'emergency_sos' && !hospital && location) {
      const Hospital = require('../models/Hospital');
      const nearest = await Hospital.findOne({
        location: {
          $near: {
            $geometry: { type: 'Point', coordinates: [location.lng, location.lat] },
            $maxDistance: 20000, // 20km
          },
        },
        hasBloodBank: true,
        isOpen: true,
      });
      if (nearest) {
        alertHospital = {
          name: nearest.name,
          address: nearest.address,
          location: {
            type: 'Point',
            coordinates: nearest.location.coordinates,
          },
        };
      }
    }

    const alert = await Alert.create({
      type, severity, title, message, bloodType, unitsNeeded,
      hospital: alertHospital, requestedBy: req.user._id,
    });

    // Emit to all connected clients via Socket.IO
    const io = req.app.get('io');
    if (io) {
      io.emit('new_alert', alert);
      if (type === 'emergency_sos' || severity === 'critical') {
        io.emit('emergency_alert', {
          bloodType,
          location: alertHospital?.location || location || null,
          message: message || title || 'Emergency blood request',
        });
      }
    }

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
    const { lat, lng, bloodType, radius = 10000, isEmergency = false } = req.query;
    const isEmergencyBool = isEmergency === 'true' || isEmergency === true;

    const donors = await User.find({
      role: 'donor',
      location: {
        $near: {
          $geometry: { type: 'Point', coordinates: [parseFloat(lng), parseFloat(lat)] },
          $maxDistance: parseInt(radius),
        },
      },
    })
      .select('name bloodType trustScore donations location isAvailable status verifiedBadge lastDonation diseases hemoglobin healthScore')
      .limit(100); // Get more for ranking

    // Calculate distance for each donor
    const donorsWithDistance = donors.map(donor => {
      const donorLng = donor.location.coordinates[0];
      const donorLat = donor.location.coordinates[1];
      const distance = getDistance(parseFloat(lat), parseFloat(lng), donorLat, donorLng);
      return { ...donor.toObject(), distance };
    });

    const DonorEligibility = require('../utils/donorEligibility');
    const request = {
      bloodType,
      location: { lat: parseFloat(lat), lng: parseFloat(lng) },
      isEmergency: isEmergencyBool,
    };

    const rankedDonors = DonorEligibility.filterAndRankDonors(donorsWithDistance, request);
    res.json({ donors: rankedDonors, count: rankedDonors.length });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Helper function to calculate distance between two points (Haversine formula)
function getDistance(lat1, lng1, lat2, lng2) {
  const R = 6371; // Radius of the Earth in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

module.exports = router;
