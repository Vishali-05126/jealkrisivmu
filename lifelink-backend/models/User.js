const mongoose = require('mongoose');
const bcrypt   = require('bcryptjs');

const UserSchema = new mongoose.Schema({
  // ── Common fields ─────────────────────────────────────
  name:     { type: String, required: true, trim: true },
  email:    { type: String, required: true, unique: true, lowercase: true },
  password: { type: String, required: true, minlength: 6 },
  phone:    { type: String },
  role: {
    type: String,
    enum: ['donor', 'receiver', 'hospital', 'bloodbank', 'admin'],
    required: true,
    default: 'donor',
  },
  isVerified:    { type: Boolean, default: false },
  verifiedBadge: { type: Boolean, default: false },
  profilePhoto:  { type: String },
  location: {
    type:        { type: String, default: 'Point' },
    coordinates: { type: [Number], default: [0, 0] },
    city:        { type: String, default: '' },
    address:     { type: String, default: '' },
  },
  createdAt: { type: Date, default: Date.now },

  // ── Donor-specific ────────────────────────────────────
  bloodType:     { type: String, enum: ['A+','A-','B+','B-','AB+','AB-','O+','O-'] },
  dateOfBirth:   { type: Date },
  gender:        { type: String, enum: ['male','female','other'] },
  weight:        { type: Number },             // kg — eligibility check
  trustScore:    { type: Number, default: 5.0, min: 0, max: 5 },
  donations:     { type: Number, default: 0 },
  livesSaved:    { type: Number, default: 0 },
  isAvailable:   { type: Boolean, default: true },
  lastDonation:  { type: Date },
  organDonor:    { type: Boolean, default: false },
  organsPledged: [{ type: String }],
  medicalConditions: { type: String },        // self-declared conditions

  // ── Receiver-specific ─────────────────────────────────
  requiredBloodType:  { type: String, enum: ['A+','A-','B+','B-','AB+','AB-','O+','O-'] },
  medicalCondition:   { type: String },       // reason for needing blood
  attendingHospital:  { type: String },
  urgency:            { type: String, enum: ['routine','urgent','critical'], default: 'routine' },
  guardianName:       { type: String },
  guardianPhone:      { type: String },

  // ── Hospital-specific ─────────────────────────────────
  hospitalName:        { type: String },
  registrationNumber:  { type: String },      // govt registration
  hospitalType:        { type: String, enum: ['government','private','trust'] },
  bedCount:            { type: Number },
  hasBloodBank:        { type: Boolean, default: false },
  hasOrganFacility:    { type: Boolean, default: false },
  isTraumaCentre:      { type: Boolean, default: false },
  contactPerson:       { type: String },
  website:             { type: String },

  // ── Blood Bank-specific ───────────────────────────────
  bankName:            { type: String },
  licenseNumber:       { type: String },      // NBTC / state license
  bankType:            { type: String, enum: ['government','private','charitable'] },
  storageCapacity:     { type: Number },      // total units
  operatingHours:      { type: String },
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
  acceptingDonors: { type: Boolean, default: true },
});

UserSchema.index({ location: '2dsphere' });
UserSchema.index({ role: 1, bloodType: 1 });

UserSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

UserSchema.methods.matchPassword = async function (entered) {
  return await bcrypt.compare(entered, this.password);
};

module.exports = mongoose.model('User', UserSchema);
