const mongoose = require('mongoose');

const HospitalSchema = new mongoose.Schema({
  name:     { type: String, required: true },
  address:  { type: String, required: true },
  phone:    { type: String },
  email:    { type: String },
  website:  { type: String },
  location: {
    type:        { type: String, default: 'Point' },
    coordinates: { type: [Number], required: true }, // [lng, lat]
    city:        { type: String },
    state:       { type: String },
  },

  // Live status
  isOpen:         { type: Boolean, default: true },
  openHours:      { type: String, default: '24/7' },
  bedsAvailable:  { type: Number, default: 0 },
  doctorsOnDuty:  { type: Number, default: 0 },

  // Capabilities
  hasBloodBank:     { type: Boolean, default: false },
  hasOrganFacility: { type: Boolean, default: false },
  isTraumaCentre:   { type: Boolean, default: false },
  acceptingDonors:  { type: Boolean, default: true },

  // Blood stock
  bloodStock: {
    'A+':  { type: Number, default: 0 },
    'A-':  { type: Number, default: 0 },
    'B+':  { type: Number, default: 0 },
    'B-':  { type: Number, default: 0 },
    'AB+': { type: Number, default: 0 },
    'AB-': { type: Number, default: 0 },
    'O+':  { type: Number, default: 0 },
    'O-':  { type: Number, default: 0 },
  },

  rating:    { type: Number, default: 4.0 },
  updatedAt: { type: Date, default: Date.now },
});

HospitalSchema.index({ location: '2dsphere' });

module.exports = mongoose.model('Hospital', HospitalSchema);
