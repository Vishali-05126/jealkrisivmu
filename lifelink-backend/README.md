# 🩸 LifeLink Backend — Node.js + MongoDB

Full backend for the LifeLink Emergency Health Network.
Covers: **User Auth**, **Real-time Alerts**, **GPS Hospital Finder**, **Live Blood Stock**.

---

## 📁 Project Structure

```
lifelink-backend/
├── server.js              # Entry point — Express + Socket.IO
├── .env.example           # Environment variable template
├── lifelink-api.js        # Frontend integration script (drop into HTML)
├── config/
│   └── db.js              # MongoDB connection
├── models/
│   ├── User.js            # Donor/hospital user schema (with geo index)
│   ├── Alert.js           # Blood request / alert schema
│   └── Hospital.js        # Hospital schema (blood stock, GPS, status)
├── routes/
│   ├── auth.js            # Register, login, location update
│   ├── alerts.js          # CRUD alerts + nearby donor search
│   └── hospitals.js       # Hospital search, nearby GPS, blood stock
└── middleware/
    └── auth.js            # JWT protect + adminOnly middleware
```

---

## 🚀 Quick Start

### 1. Install dependencies
```bash
cd lifelink-backend
npm install
```

### 2. Set up environment
```bash
cp .env.example .env
# Edit .env with your values:
#   MONGO_URI = your MongoDB connection string
#   JWT_SECRET = any long random string
#   GOOGLE_MAPS_API_KEY = from console.cloud.google.com
```

### 3. Start MongoDB
```bash
# Local MongoDB
mongod --dbpath /data/db

# Or use MongoDB Atlas (cloud) — just paste your Atlas URI in .env
```

### 4. Run the server
```bash
npm run dev     # Development (auto-restart)
npm start       # Production
```

### 5. Seed sample data (development only)
```bash
curl -X POST http://localhost:5000/api/dev/seed
```

### 6. Connect to the frontend
Add these two lines to your `LifeLink_blue.html` before `</body>`:
```html
<script src="http://localhost:5000/socket.io/socket.io.js"></script>
<script src="lifelink-api.js"></script>
```

---

## 🔌 API Reference

### Auth
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/register` | Register a new donor |
| POST | `/api/auth/login` | Login, returns JWT token |
| GET  | `/api/auth/me` | Get logged-in user profile |
| PUT  | `/api/auth/location` | Update donor GPS location |
| PUT  | `/api/auth/availability` | Set donor available/unavailable |

### Alerts
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET  | `/api/alerts` | Get open alerts (filter by GPS + blood type) |
| POST | `/api/alerts` | Create new blood request alert |
| PUT  | `/api/alerts/:id/accept` | Donor accepts a request |
| PUT  | `/api/alerts/:id/fulfill` | Mark donation complete |
| GET  | `/api/alerts/nearby-donors` | Find donors near a location |

### Hospitals
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET  | `/api/hospitals` | All hospitals (filter by type/city) |
| GET  | `/api/hospitals/nearby` | Hospitals near GPS coordinates |
| GET  | `/api/hospitals/:id` | Single hospital details |
| POST | `/api/hospitals` | Add hospital (admin only) |
| PUT  | `/api/hospitals/:id/blood-stock` | Update blood inventory |
| PUT  | `/api/hospitals/:id/status` | Update open/beds/doctors |
| GET  | `/api/hospitals/geocode/search?q=` | Geocode an address |

---

## ⚡ Real-time Events (Socket.IO)

### Client → Server
| Event | Payload | Description |
|-------|---------|-------------|
| `donor_location` | `{ userId, lat, lng }` | Share live GPS location |
| `join_city` | `"Chennai"` | Subscribe to city alerts |
| `emergency_broadcast` | `{ city, alert }` | Broadcast to a city |

### Server → Client
| Event | Payload | Description |
|-------|---------|-------------|
| `new_alert` | Alert object | New blood request created |
| `alert_updated` | `{ id, status }` | Alert accepted/fulfilled |
| `blood_stock_updated` | `{ hospitalId, bloodStock }` | Hospital inventory changed |
| `donor_moved` | `{ userId, lat, lng }` | Nearby donor location |

---

## 🗺️ Google Maps Setup

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Create a project → Enable **Maps JavaScript API** + **Geocoding API**
3. Create an API key → Paste into `.env` as `GOOGLE_MAPS_API_KEY`
4. The geocode endpoint proxies all map calls server-side (keeps key hidden)

---

## 🔐 Auth Flow

```
Register/Login → JWT token returned
→ Store in localStorage
→ Send as: Authorization: Bearer <token>
→ All protected routes verify token automatically
```

---

## 🌍 Production Deployment

```bash
# MongoDB Atlas (free tier): mongodb.com/atlas
# Backend: Railway / Render / Fly.io / DigitalOcean
# Environment: Set NODE_ENV=production

# Build command: npm install
# Start command: npm start
```

Update `API_BASE` in `lifelink-api.js` to your production URL:
```js
const API_BASE = 'https://your-lifelink-api.railway.app/api';
```
