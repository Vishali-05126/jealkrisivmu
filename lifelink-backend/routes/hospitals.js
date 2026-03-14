const express = require('express');
const router = express.Router();
const Hospital = require('../models/Hospital');
const { protect, adminOnly } = require('../middleware/auth');

// ── GET /api/hospitals ───────────────────────
// Get all hospitals or filter by capability
router.get('/', async (req, res) => {
  try {
    const { type, city } = req.query;
    let query = {};
    if (type === 'blood')  query.hasBloodBank = true;
    if (type === 'organ')  query.hasOrganFacility = true;
    if (type === 'trauma') query.isTraumaCentre = true;
    if (type === 'open')   query.isOpen = true;
    if (city) query['location.city'] = new RegExp(city, 'i');

    const hospitals = await Hospital.find(query).sort({ rating: -1 });
    res.json({ hospitals });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── GET /api/hospitals/nearby ────────────────
// Find hospitals near GPS coordinates
router.get('/nearby', async (req, res) => {
  try {
    const { lat, lng, radius = 15000, type } = req.query;
    if (!lat || !lng) return res.status(400).json({ message: 'lat and lng required' });

    let query = {
      location: {
        $near: {
          $geometry: { type: 'Point', coordinates: [parseFloat(lng), parseFloat(lat)] },
          $maxDistance: parseInt(radius),
        },
      },
    };
    if (type === 'blood')  query.hasBloodBank = true;
    if (type === 'organ')  query.hasOrganFacility = true;
    if (type === 'trauma') query.isTraumaCentre = true;

    const hospitals = await Hospital.find(query).limit(15);
    res.json({ hospitals });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── GET /api/hospitals/:id ───────────────────
router.get('/:id', async (req, res) => {
  try {
    const hospital = await Hospital.findById(req.params.id);
    if (!hospital) return res.status(404).json({ message: 'Hospital not found' });
    res.json({ hospital });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── POST /api/hospitals ──────────────────────
// Admin adds a hospital
router.post('/', protect, adminOnly, async (req, res) => {
  try {
    const hospital = await Hospital.create(req.body);
    res.status(201).json({ hospital });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── PUT /api/hospitals/:id/blood-stock ───────
// Hospital updates its blood stock levels
router.put('/:id/blood-stock', protect, async (req, res) => {
  try {
    const { bloodStock } = req.body;
    const hospital = await Hospital.findByIdAndUpdate(
      req.params.id,
      { bloodStock, updatedAt: new Date() },
      { new: true }
    );

    // Emit real-time update
    const io = req.app.get('io');
    if (io) io.emit('blood_stock_updated', { hospitalId: req.params.id, bloodStock });

    res.json({ hospital });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── PUT /api/hospitals/:id/status ────────────
// Update open/close, beds, doctors on duty
router.put('/:id/status', protect, async (req, res) => {
  try {
    const { isOpen, bedsAvailable, doctorsOnDuty, acceptingDonors } = req.body;
    const hospital = await Hospital.findByIdAndUpdate(
      req.params.id,
      { isOpen, bedsAvailable, doctorsOnDuty, acceptingDonors, updatedAt: new Date() },
      { new: true }
    );

    const io = req.app.get('io');
    if (io) io.emit('hospital_status_updated', { hospitalId: req.params.id, isOpen, bedsAvailable });

    res.json({ hospital });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── GET /api/hospitals/geocode ───────────────
// Proxy Google Maps geocoding (keeps API key server-side)
router.get('/geocode/search', async (req, res) => {
  try {
    const { q } = req.query;
    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    if (!apiKey) return res.status(503).json({ message: 'Maps API not configured' });

    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(q)}&key=${apiKey}`;
    const response = await fetch(url);
    const data = await response.json();

    if (data.results?.length) {
      const { lat, lng } = data.results[0].geometry.location;
      res.json({ lat, lng, formatted: data.results[0].formatted_address });
    } else {
      res.status(404).json({ message: 'Location not found' });
    }
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
