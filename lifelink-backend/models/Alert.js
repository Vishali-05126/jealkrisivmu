const mongoose = require('mongoose');

const AlertSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: ['blood_request', 'organ_match', 'low_stock', 'hospital_update', 'mission_complete', 'emergency_sos'],
    required: true,
  },
  severity: { type: String, enum: ['critical', 'warning', 'info', 'success'], default: 'info' },
  title: { type: String, required: true },
  message: { type: String, required: true },
  bloodType: { type: String },
  unitsNeeded: { type: Number, default: 1 },

  hospital: {
    name: { type: String },
    address: { type: String },
    location: {
      type: { type: String, default: 'Point' },
      coordinates: { type: [Number] }, // [lng, lat]
    },
  },

  requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  acceptedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

  status: { type: String, enum: ['open', 'accepted', 'fulfilled', 'expired'], default: 'open' },
  expiresAt: { type: Date, default: () => new Date(Date.now() + 2 * 60 * 60 * 1000) }, // 2 hours
  createdAt: { type: Date, default: Date.now },
});

AlertSchema.index({ 'hospital.location': '2dsphere' });
AlertSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model('Alert', AlertSchema);
