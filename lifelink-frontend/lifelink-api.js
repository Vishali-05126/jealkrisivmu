// ═══════════════════════════════════════════════════════
//  LifeLink Frontend ↔ Backend Integration
//  Drop this <script src="lifelink-api.js"> into the HTML
// ═══════════════════════════════════════════════════════

const ORIGIN = (typeof window !== 'undefined'
  && window.location
  && window.location.origin
  && window.location.origin !== 'null')
  ? window.location.origin
  : 'http://localhost:5000';
const API_BASE = `${ORIGIN}/api`;
const DEV_SEED_KEY = 'll_dev_seeded_v1';
let _token = localStorage.getItem('ll_token') || null;
let _user  = JSON.parse(localStorage.getItem('ll_user') || 'null');
let _socket = null;

// ── Helpers ──────────────────────────────────────────────
const apiCall = async (method, path, body = null) => {
  const headers = { 'Content-Type': 'application/json' };
  if (_token) headers['Authorization'] = `Bearer ${_token}`;
  const res = await fetch(`${API_BASE}${path}`, {
    method, headers,
    body: body ? JSON.stringify(body) : null,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'API error');
  return data;
};

// ── Auth ─────────────────────────────────────────────────
const LL = {

  // Register a new donor
  async register({ name, email, password, bloodType, phone, city }) {
    const data = await apiCall('POST', '/auth/register', { name, email, password, bloodType, phone, city });
    _token = data.token;
    _user  = data.user;
    localStorage.setItem('ll_token', _token);
    localStorage.setItem('ll_user', JSON.stringify(_user));
    LL.updateUI();
    return data;
  },

  // Login
  async login({ email, password }) {
    const data = await apiCall('POST', '/auth/login', { email, password });
    _token = data.token;
    _user  = data.user;
    localStorage.setItem('ll_token', _token);
    localStorage.setItem('ll_user', JSON.stringify(_user));
    LL.updateUI();
    LL.connectSocket();
    return data;
  },

  // Logout
  logout() {
    _token = null; _user = null;
    localStorage.removeItem('ll_token');
    localStorage.removeItem('ll_user');
    if (_socket) _socket.disconnect();
    LL.updateUI();
  },

  // Update user info displayed in nav
  updateUI() {
    const nameEl = document.querySelector('.sidenav-user-name');
    const subEl  = document.querySelector('.sidenav-user-sub');
    const chipEl = document.querySelector('.nav-user-chip');
    if (_user) {
      if (nameEl) nameEl.textContent = _user.name;
      if (subEl)  subEl.textContent  = `${_user.bloodType} · ★${_user.trustScore} · ${_user.donations} donations`;
      if (chipEl) chipEl.childNodes[2].textContent = ` ${_user.name} · ${_user.bloodType} · ★${_user.trustScore}`;
    }
  },

  // ── Location ───────────────────────────────────────────
  async shareLocation() {
    if (!navigator.geolocation) return;
    navigator.geolocation.watchPosition(async ({ coords }) => {
      const { latitude: lat, longitude: lng } = coords;

      // Update DB
      if (_token) await apiCall('PUT', '/auth/location', { lat, lng });

      // Broadcast via socket
      if (_socket) _socket.emit('donor_location', { userId: _user?.id, lat, lng });

      // Update map pin position
      LL.updateMapPin(lat, lng);
    }, null, { enableHighAccuracy: true, maximumAge: 30000 });
  },

  updateMapPin(lat, lng) {
    // Convert real GPS to map % position (approximate for demo area)
    // For production use Google Maps or Leaflet instead
    const mapEl = document.querySelector('.map-you');
    if (mapEl) {
      console.log(`📍 GPS: ${lat.toFixed(4)}, ${lng.toFixed(4)}`);
      // In a real implementation you'd use a proper map library
    }
  },

  // ── Alerts ─────────────────────────────────────────────
  async loadAlerts() {
    try {
      let url = '/alerts';
      if (navigator.geolocation) {
        const pos = await new Promise(r => navigator.geolocation.getCurrentPosition(r));
        url = `/alerts?lat=${pos.coords.latitude}&lng=${pos.coords.longitude}`;
        if (_user?.bloodType) url += `&bloodType=${_user.bloodType}`;
      }
      const { alerts } = await apiCall('GET', url);
      LL.renderAlerts(alerts);
    } catch (err) {
      console.warn('Could not load real alerts, using demo data:', err.message);
    }
  },

  renderAlerts(alerts) {
    const list = document.getElementById('alertsList');
    if (!list || !alerts?.length) return;

    const severityClass = { critical: 'critical', warning: 'warning', info: 'info', success: 'success' };
    const severityIcon  = { critical: '🩸', warning: '⚠', info: '🏥', success: '✅' };

    list.innerHTML = alerts.map(a => `
      <div class="alert-item ${severityClass[a.severity] || 'info'}">
        <div class="alert-type">${severityIcon[a.severity] || '🔔'} ${a.severity?.toUpperCase()} — ${a.type?.replace('_',' ')}</div>
        <div class="alert-msg">${a.message}</div>
        <div class="alert-meta">
          <span>${a.hospital?.name || ''}</span>
          <span>${new Date(a.createdAt).toLocaleTimeString()}</span>
          ${a.bloodType ? `<span>Blood: ${a.bloodType}</span>` : ''}
        </div>
        ${a.status === 'open' ? `
          <button class="alert-accept btn-accept" onclick="LL.acceptAlert('${a._id}', this)">Accept & Donate</button>
        ` : `<span style="font-size:11px;color:var(--green);">✓ ${a.status}</span>`}
      </div>
    `).join('');

    // Update critical count badge
    const critical = alerts.filter(a => a.severity === 'critical').length;
    const badge = document.getElementById('alertCount');
    if (badge) badge.textContent = `${critical} Critical`;
  },

  async acceptAlert(alertId, btn) {
    try {
      btn.textContent = '⏳ Confirming...';
      btn.disabled = true;
      await apiCall('PUT', `/alerts/${alertId}/accept`);
      btn.textContent = '✅ Accepted!';
      btn.style.background = 'var(--green)';
      showNotif('Request Accepted!', 'Navigate to the hospital. Team has been notified. Thank you!');
    } catch (err) {
      btn.disabled = false;
      btn.textContent = 'Accept & Donate';
      showNotif('❌ Error', err.message);
    }
  },

  // ── Hospitals ──────────────────────────────────────────
  async loadNearbyHospitals() {
    try {
      let url = '/hospitals';
      if (navigator.geolocation) {
        const pos = await new Promise(r => navigator.geolocation.getCurrentPosition(r));
        url = `/hospitals/nearby?lat=${pos.coords.latitude}&lng=${pos.coords.longitude}`;
      }
      const { hospitals } = await apiCall('GET', url);
      if (hospitals?.length) {
        console.log(`🏥 Loaded ${hospitals.length} real hospitals`);
        // renderHospitals() in the main app will pick these up
        window._realHospitals = hospitals;
      }
    } catch (err) {
      console.warn('Could not load real hospitals, using demo data:', err.message);
    }
  },

  // ── Socket.IO ──────────────────────────────────────────
  connectSocket() {
    if (typeof io === 'undefined') {
      console.warn('Socket.IO client not loaded. Add: <script src="http://localhost:5000/socket.io/socket.io.js">');
      return;
    }
    _socket = io(ORIGIN);

    _socket.on('connect', () => {
      console.log('🔌 Connected to LifeLink real-time server');
      if (_user?.location?.city) _socket.emit('join_city', _user.location.city);
    });

    // Real-time new alert
    _socket.on('new_alert', (alert) => {
      showNotif('🚨 New Alert', alert.message);
      LL.loadAlerts(); // Refresh the alert list
    });

    // Alert status changed
    _socket.on('alert_updated', ({ id, status }) => {
      LL.loadAlerts();
    });

    // Blood stock updated
    _socket.on('blood_stock_updated', ({ hospitalId, bloodStock }) => {
      console.log('🩸 Blood stock updated for hospital', hospitalId);
      // Re-render inventory if on dashboard
    });

    // Another donor moved nearby
    _socket.on('donor_moved', ({ userId, lat, lng }) => {
      console.log(`👤 Donor ${userId} at ${lat}, ${lng}`);
    });

    _socket.on('disconnect', () => console.log('❌ Disconnected from real-time server'));
  },

  // ── Init ───────────────────────────────────────────────
  async init() {
    // Restore session if token exists
    if (_token && _user) {
      LL.updateUI();
      LL.connectSocket();
    }

    // Lightweight backend check + optional demo seed
    LL.checkApi();
    LL.trySeedDemo();

    // Load real data in background
    LL.loadAlerts();
    LL.loadNearbyHospitals();

    // Share live GPS location if logged in
    if (_token) LL.shareLocation();

    console.log('✅ LifeLink API initialized');
  },

  async checkApi() {
    try {
      const res = await fetch(`${API_BASE}/health`);
      if (!res.ok) throw new Error('Health check failed');
      const data = await res.json();
      console.log('✅ Backend reachable:', data.message || 'ok');
      return true;
    } catch (err) {
      console.warn('⚠️ Backend not reachable:', err.message);
      return false;
    }
  },

  async trySeedDemo() {
    if (localStorage.getItem(DEV_SEED_KEY)) return;
    try {
      const res = await fetch(`${API_BASE}/dev/seed`, { method: 'POST' });
      if (!res.ok) throw new Error('Seed route not available');
      const data = await res.json();
      localStorage.setItem(DEV_SEED_KEY, new Date().toISOString());
      console.log('✅ Demo data seeded:', data.message || 'ok');
    } catch (err) {
      // Not in dev mode or backend unavailable — ignore quietly
      console.warn('ℹ️ Demo seed skipped:', err.message);
    }
  },

  // ── Auth Modal helpers ─────────────────────────────────
  showAuthModal() {
    const existing = document.getElementById('llAuthModal');
    if (existing) { existing.style.display = 'flex'; return; }

    const modal = document.createElement('div');
    modal.id = 'llAuthModal';
    modal.style.cssText = `
      position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.5);
      display:flex;align-items:center;justify-content:center;
    `;
    modal.innerHTML = `
      <div style="background:#fff;border-radius:20px;padding:36px;width:420px;max-width:95vw;box-shadow:0 20px 60px rgba(0,0,0,0.3);">
        <h2 style="font-family:'Syne',sans-serif;font-size:22px;font-weight:800;color:#1D4ED8;margin-bottom:6px;">Join LifeLink</h2>
        <p style="font-size:13px;color:#6B7280;margin-bottom:24px;">Sign in or create an account to donate blood and save lives.</p>

        <div style="display:flex;gap:8px;margin-bottom:20px;">
          <button id="llTabLogin" onclick="LL._switchAuthTab('login')"
            style="flex:1;padding:8px;border-radius:8px;border:2px solid #1D4ED8;background:#1D4ED8;color:#fff;font-weight:700;font-size:13px;cursor:pointer;">
            Sign In
          </button>
          <button id="llTabReg" onclick="LL._switchAuthTab('register')"
            style="flex:1;padding:8px;border-radius:8px;border:2px solid #DBEAFE;background:#fff;color:#1D4ED8;font-weight:700;font-size:13px;cursor:pointer;">
            Register
          </button>
        </div>

        <div id="llAuthForm"></div>
        <div id="llAuthErr" style="color:#EF4444;font-size:12px;margin-top:8px;"></div>
        <button onclick="document.getElementById('llAuthModal').style.display='none'"
          style="margin-top:16px;width:100%;padding:8px;background:transparent;border:none;color:#6B7280;font-size:12px;cursor:pointer;">
          Cancel
        </button>
      </div>
    `;
    document.body.appendChild(modal);
    LL._switchAuthTab('login');
  },

  _switchAuthTab(tab) {
    const form = document.getElementById('llAuthForm');
    const btnLogin = document.getElementById('llTabLogin');
    const btnReg   = document.getElementById('llTabReg');

    if (btnLogin && btnReg) {
      if (tab === 'login') {
        btnLogin.style.background = '#1D4ED8'; btnLogin.style.color = '#fff';
        btnReg.style.background = '#fff';    btnReg.style.color = '#1D4ED8';
      } else {
        btnReg.style.background = '#1D4ED8';   btnReg.style.color = '#fff';
        btnLogin.style.background = '#fff'; btnLogin.style.color = '#1D4ED8';
      }
    }

    const inputStyle = `width:100%;padding:10px 14px;border:1px solid #DBEAFE;border-radius:8px;font-size:13px;margin-bottom:10px;outline:none;font-family:'DM Sans',sans-serif;`;
    const btnStyle   = `width:100%;padding:12px;background:#1D4ED8;color:#fff;border:none;border-radius:10px;font-weight:800;font-size:14px;cursor:pointer;font-family:'Syne',sans-serif;margin-top:4px;`;

    if (tab === 'login') {
      form.innerHTML = `
        <input id="llEmail" type="email" placeholder="Email address" style="${inputStyle}">
        <input id="llPass"  type="password" placeholder="Password" style="${inputStyle}">
        <button style="${btnStyle}" onclick="LL._submitLogin()">Sign In →</button>
      `;
    } else {
      const bloodTypes = ['A+','A-','B+','B-','AB+','AB-','O+','O-'];
      form.innerHTML = `
        <input id="llName"  type="text"     placeholder="Full name" style="${inputStyle}">
        <input id="llEmail" type="email"    placeholder="Email address" style="${inputStyle}">
        <input id="llPass"  type="password" placeholder="Password (min 6 chars)" style="${inputStyle}">
        <input id="llPhone" type="tel"      placeholder="Phone number (optional)" style="${inputStyle}">
        <input id="llCity"  type="text"     placeholder="City" style="${inputStyle}">
        <select id="llBlood" style="${inputStyle}background:#fff;">
          <option value="">Select blood type</option>
          ${bloodTypes.map(b => `<option value="${b}">${b}</option>`).join('')}
        </select>
        <button style="${btnStyle}" onclick="LL._submitRegister()">Create Account →</button>
      `;
    }
  },

  async _submitLogin() {
    const email    = document.getElementById('llEmail')?.value;
    const password = document.getElementById('llPass')?.value;
    const errEl    = document.getElementById('llAuthErr');
    try {
      await LL.login({ email, password });
      document.getElementById('llAuthModal').style.display = 'none';
      showNotif('✅ Welcome back!', `Signed in as ${_user.name}`);
    } catch (err) {
      if (errEl) errEl.textContent = err.message;
    }
  },

  async _submitRegister() {
    const name      = document.getElementById('llName')?.value;
    const email     = document.getElementById('llEmail')?.value;
    const password  = document.getElementById('llPass')?.value;
    const bloodType = document.getElementById('llBlood')?.value;
    const phone     = document.getElementById('llPhone')?.value;
    const city      = document.getElementById('llCity')?.value;
    const errEl     = document.getElementById('llAuthErr');
    try {
      await LL.register({ name, email, password, bloodType, phone, city });
      document.getElementById('llAuthModal').style.display = 'none';
      showNotif('🎉 Welcome to LifeLink!', `Account created. You can now receive blood donation alerts, ${name}.`);
    } catch (err) {
      if (errEl) errEl.textContent = err.message;
    }
  },
};

// Auto-init on page load
document.addEventListener('DOMContentLoaded', () => LL.init());

// Add Sign In button to nav if not logged in
document.addEventListener('DOMContentLoaded', () => {
  if (!_user) {
    const navRight = document.querySelector('.nav-right');
    if (navRight) {
      const signinBtn = document.createElement('button');
      signinBtn.textContent = '🔐 Sign In';
      signinBtn.style.cssText = `padding:8px 16px;background:#EFF6FF;color:#1D4ED8;border:1px solid #BFDBFE;border-radius:8px;font-weight:700;font-size:12px;cursor:pointer;font-family:'Syne',sans-serif;`;
      signinBtn.onclick = () => LL.showAuthModal();
      navRight.insertBefore(signinBtn, navRight.firstChild);
    }
  }
});
