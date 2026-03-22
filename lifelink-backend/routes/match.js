const express = require('express');
const router = express.Router();
const User = require('../models/User');
const DonorEligibility = require('../utils/donorEligibility');

function getDistanceKm(lat1, lng1, lat2, lng2) {
  const R = 6371; // km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

async function findNearbyDonors({ lat, lng, radiusMeters }) {
  return User.find({
    role: 'donor',
    location: {
      $near: {
        $geometry: { type: 'Point', coordinates: [lng, lat] },
        $maxDistance: radiusMeters,
      },
    },
  })
    .select('name bloodType trustScore donations location status isAvailable lastDonation diseases hemoglobin healthScore')
    .limit(200);
}

// —— POST /match-donors ——
// Input: bloodType, lat, lng, isEmergency
router.post('/match-donors', async (req, res) => {
  try {
    const { bloodType, lat, lng, isEmergency = false } = req.body || {};
    const isEmergencyBool = isEmergency === true || isEmergency === 'true';
    if (!bloodType || lat === undefined || lng === undefined) {
      return res.status(400).json({ message: 'bloodType, lat, and lng are required' });
    }

    const baseRadius = parseInt(req.body.radius || 20000, 10); // meters
    const latNum = parseFloat(lat);
    const lngNum = parseFloat(lng);
    if (Number.isNaN(latNum) || Number.isNaN(lngNum)) {
      return res.status(400).json({ message: 'lat and lng must be valid numbers' });
    }
    const coords = { lat: latNum, lng: lngNum };

    const donors = await findNearbyDonors({
      lat: coords.lat,
      lng: coords.lng,
      radiusMeters: baseRadius,
    });

    const donorsWithDistance = donors.map(donor => {
      const donorLng = donor.location.coordinates[0];
      const donorLat = donor.location.coordinates[1];
      const distance = getDistanceKm(coords.lat, coords.lng, donorLat, donorLng);
      return { ...donor.toObject(), distance };
    });

    const standardRequest = { bloodType, location: coords, isEmergency: false };
    const emergencyRequest = { bloodType, location: coords, isEmergency: true };
    const standardDonors = DonorEligibility.filterAndRankDonors(donorsWithDistance, standardRequest);
    let rankedDonors = isEmergencyBool
      ? DonorEligibility.filterAndRankDonors(donorsWithDistance, emergencyRequest)
      : standardDonors;

    let expanded = false;
    let radiusUsed = baseRadius;
    let message = '';

    if (isEmergencyBool && standardDonors.length === 0) {
      expanded = true;
      message = 'No eligible donors found. Expanding search...';
      radiusUsed = baseRadius + 10000;
      const expandedDonors = await findNearbyDonors({
        lat: coords.lat,
        lng: coords.lng,
        radiusMeters: radiusUsed,
      });
      const expandedWithDistance = expandedDonors.map(donor => {
        const donorLng = donor.location.coordinates[0];
        const donorLat = donor.location.coordinates[1];
        const distance = getDistanceKm(coords.lat, coords.lng, donorLat, donorLng);
        return { ...donor.toObject(), distance };
      });
      rankedDonors = DonorEligibility.filterAndRankDonors(expandedWithDistance, emergencyRequest);
    }

    if (isEmergencyBool) {
      const io = req.app.get('io');
      if (io) {
        io.emit('emergency_alert', {
          bloodType,
          location: coords,
          radius: radiusUsed,
          count: rankedDonors.length,
          expanded,
          message: message || 'Emergency request received',
        });
      }
    }

    res.json({
      donors: rankedDonors,
      count: rankedDonors.length,
      expanded,
      radius: radiusUsed,
      message,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
