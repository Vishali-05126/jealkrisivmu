const express = require('express');
const router = express.Router();
const Alert = require('../models/Alert');
const Hospital = require('../models/Hospital');

// —— GET /api/insights/shortage ——
// Query: bloodType, lat, lng, radius
router.get('/shortage', async (req, res) => {
  try {
    const { bloodType, lat, lng, radius = 20000 } = req.query;
    if (!bloodType) return res.status(400).json({ message: 'bloodType is required' });
    const bloodTypeKey = bloodType.toUpperCase();

    const recentWindow = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const demandQuery = {
      status: 'open',
      bloodType: bloodTypeKey,
      createdAt: { $gte: recentWindow },
    };

    const hospitalGeo = lat && lng ? {
      $near: {
        $geometry: { type: 'Point', coordinates: [parseFloat(lng), parseFloat(lat)] },
        $maxDistance: parseInt(radius, 10),
      },
    } : null;

    if (hospitalGeo) {
      demandQuery['hospital.location'] = hospitalGeo;
    }

    const alerts = await Alert.find(demandQuery).select('unitsNeeded');
    const demand = alerts.reduce((sum, a) => sum + (a.unitsNeeded || 1), 0);

    const hospitalQuery = { hasBloodBank: true };
    if (hospitalGeo) {
      hospitalQuery.location = hospitalGeo;
    }

    const hospitals = await Hospital.find(hospitalQuery).select(`bloodStock.${bloodTypeKey}`);
    const supply = hospitals.reduce((sum, h) => sum + (h.bloodStock?.[bloodTypeKey] || 0), 0);

    const shortage = demand > supply;
    const message = shortage
      ? `High demand for ${bloodTypeKey} in this area`
      : `Supply stable for ${bloodTypeKey} in this area`;

    res.json({ bloodType: bloodTypeKey, demand, supply, shortage, message });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
