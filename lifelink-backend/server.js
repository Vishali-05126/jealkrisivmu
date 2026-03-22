require('dotenv').config();
const express    = require('express');
const http       = require('http');
const path       = require('path');
const { Server } = require('socket.io');
const cors       = require('cors');
const connectDB  = require('./config/db');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
});

// ── Connect DB ───────────────────────────────
connectDB();

// ── Middleware ───────────────────────────────
app.use(cors());
app.use(express.json());

// Make io accessible inside routes
app.set('io', io);

// ── Routes ───────────────────────────────────
app.use('/api/auth',      require('./routes/auth'));
app.use('/api/alerts',    require('./routes/alerts'));
app.use('/api/hospitals', require('./routes/hospitals'));
app.use('/api/insights',  require('./routes/insights'));
app.use('/',              require('./routes/match'));

// Serve frontend
const FRONTEND_DIR = path.join(__dirname, '..', 'lifelink-frontend');
app.use(express.static(FRONTEND_DIR));
app.get('/', (req, res) => res.sendFile(path.join(FRONTEND_DIR, 'login.html')));

// ── Health check ─────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'LifeLink backend running 🚀', timestamp: new Date() });
});

// ── Socket.IO ────────────────────────────────
io.on('connection', (socket) => {
  console.log(`🔌 Client connected: ${socket.id}`);

  // Donor shares live GPS location
  socket.on('donor_location', ({ userId, lat, lng }) => {
    socket.broadcast.emit('donor_moved', { userId, lat, lng });
  });

  // Donor joins a city room for targeted alerts
  socket.on('join_city', (city) => {
    socket.join(city);
    console.log(`📍 ${socket.id} joined room: ${city}`);
  });

  // Hospital broadcasts urgent request to a city
  socket.on('emergency_broadcast', ({ city, alert }) => {
    io.to(city).emit('new_alert', alert);
  });

  socket.on('disconnect', () => {
    console.log(`❌ Client disconnected: ${socket.id}`);
  });
});

// ── Seed sample data (dev only) ───────────────
const isDev = (process.env.NODE_ENV || 'development') === 'development';
if (isDev) {
  app.post('/api/dev/seed', async (req, res) => {
    try {
      const Hospital = require('./models/Hospital');
      const Alert    = require('./models/Alert');

      await Hospital.deleteMany({});
      await Alert.deleteMany({});

      await Hospital.insertMany([
        {
          name: "St. Mary's Hospital", address: 'Anna Salai, Chennai',
          phone: '+91-44-2222-3333',
          location: { type: 'Point', coordinates: [80.2707, 13.0827], city: 'Chennai' },
          isOpen: true, openHours: '24/7', bedsAvailable: 12, doctorsOnDuty: 4,
          hasBloodBank: true, isTraumaCentre: true, acceptingDonors: true,
          bloodStock: { 'O-': 2, 'O+': 14, 'A-': 5, 'A+': 18, 'B-': 3, 'B+': 9, 'AB-': 1, 'AB+': 12 },
          rating: 4.8,
        },
        {
          name: 'City General Hospital', address: 'T. Nagar, Chennai',
          phone: '+91-44-2333-4444',
          location: { type: 'Point', coordinates: [80.2341, 13.0418], city: 'Chennai' },
          isOpen: true, openHours: '24/7', bedsAvailable: 8, doctorsOnDuty: 3,
          hasBloodBank: true, hasOrganFacility: true, acceptingDonors: true,
          bloodStock: { 'O-': 5, 'O+': 20, 'A-': 8, 'A+': 22, 'B-': 4, 'B+': 11, 'AB-': 2, 'AB+': 15 },
          rating: 4.6,
        },
        {
          name: 'Apollo Hospitals', address: 'Greams Road, Chennai',
          phone: '+91-44-2829-3333',
          location: { type: 'Point', coordinates: [80.2565, 13.0620], city: 'Chennai' },
          isOpen: true, openHours: '24/7', bedsAvailable: 25, doctorsOnDuty: 8,
          hasBloodBank: true, hasOrganFacility: true, isTraumaCentre: true, acceptingDonors: false,
          bloodStock: { 'O-': 8, 'O+': 30, 'A-': 12, 'A+': 28, 'B-': 6, 'B+': 16, 'AB-': 3, 'AB+': 20 },
          rating: 4.9,
        },
      ]);

      await Alert.insertMany([
        {
          type: 'blood_request', severity: 'critical',
          title: "St. Mary's needs O− urgently",
          message: "St. Mary's Hospital urgently needs O− blood for trauma surgery. Patient: Female, 34.",
          bloodType: 'O-', unitsNeeded: 2,
          hospital: {
            name: "St. Mary's Hospital", address: 'Anna Salai, Chennai',
            location: { type: 'Point', coordinates: [80.2707, 13.0827] },
          },
        },
        {
          type: 'low_stock', severity: 'warning',
          title: 'AB− critically low at City General',
          message: 'AB− stock critical (2 units). Donors with AB− blood needed urgently.',
          bloodType: 'AB-', unitsNeeded: 5,
          hospital: {
            name: 'City General', address: 'T. Nagar, Chennai',
            location: { type: 'Point', coordinates: [80.2341, 13.0418] },
          },
        },
      ]);

      res.json({ message: '✅ Seed data inserted successfully' });
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  });
}

// ── Start ─────────────────────────────────────
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`🚀 LifeLink backend running on http://localhost:${PORT}`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV}`);
});
