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
const DONOR_CACHE_KEY = 'll_cached_donors_v1';
const SHORTAGE_CACHE_KEY = 'll_shortage_cache_v1';
const DEV_SEED_KEY = 'll_dev_seeded_v1';
let _token = localStorage.getItem('ll_token') || null;
let _user  = JSON.parse(localStorage.getItem('ll_user') || 'null');
let _socket = null;

const isOfflineMode = () => {
  if (typeof window !== 'undefined' && window.isOffline === true) return true;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
  return false;
};

const daysSince = (date) => {
  if (!date) return null;
  const last = new Date(date);
  if (Number.isNaN(last.getTime())) return null;
  const diff = Date.now() - last.getTime();
  return Math.floor(diff / (1000 * 60 * 60 * 24));
};

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

  // Update donor availability status (available | busy | offline)
  async updateStatus(status) {
    if (!_token) return;
    try {
      const { user } = await apiCall('PUT', '/auth/status', { status });
      _user = user;
      localStorage.setItem('ll_user', JSON.stringify(_user));
      LL.updateUI();
      showNotif('Status Updated', `You are now ${status}.`);
    } catch (err) {
      console.warn('Status update failed:', err.message);
      showNotif('Status Update Failed', err.message);
    }
  },

  // Update user info displayed in nav
  updateUI() {
    const nameEl = document.querySelector('.sidenav-user-name');
    const subEl  = document.querySelector('.sidenav-user-sub');
    const chipEl = document.querySelector('.nav-user-chip');
    const navRight = document.querySelector('.nav-right');
    if (_user) {
      if (nameEl) nameEl.textContent = _user.name;
      const statusLabel = (_user.status || (_user.isAvailable ? 'available' : 'offline')).toUpperCase();
      if (subEl)  subEl.textContent  = `${_user.bloodType} · ★${_user.trustScore} · ${_user.donations} donations · ${statusLabel}`;
      if (chipEl) chipEl.childNodes[2].textContent = ` ${_user.name} · ${_user.bloodType} · ★${_user.trustScore}`;

      if (navRight) {
        let statusSelect = document.getElementById('llStatusSelect');
        if (!statusSelect) {
          statusSelect = document.createElement('select');
          statusSelect.id = 'llStatusSelect';
          statusSelect.style.cssText = 'padding:6px 10px;border:1px solid #DBEAFE;border-radius:8px;font-size:12px;font-weight:700;color:#1D4ED8;background:#EFF6FF;font-family:\'DM Sans\',sans-serif;cursor:pointer;';
          statusSelect.innerHTML = `
            <option value="available">Available</option>
            <option value="busy">Busy</option>
            <option value="offline">Offline</option>
          `;
          statusSelect.onchange = () => LL.updateStatus(statusSelect.value);
          navRight.insertBefore(statusSelect, navRight.firstChild);
        }
        statusSelect.value = _user.status || (_user.isAvailable ? 'available' : 'offline');
      }
    } else {
      const statusSelect = document.getElementById('llStatusSelect');
      if (statusSelect) statusSelect.remove();
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

  // ── Donor Matching ─────────────────────────────────────
  async matchDonors({ bloodType, lat, lng, isEmergency = false, radius = null }) {
    const payload = { bloodType, lat, lng, isEmergency };
    if (radius) payload.radius = radius;

    if (isOfflineMode()) {
      const cached = JSON.parse(localStorage.getItem(DONOR_CACHE_KEY) || 'null');
      if (cached?.donors) return { ...cached, offline: true };
      return { donors: [], count: 0, expanded: false, message: 'Offline: no cached donors', offline: true };
    }

    try {
      const res = await fetch(`${ORIGIN}/match-donors`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Match error');
      localStorage.setItem(DONOR_CACHE_KEY, JSON.stringify({ ...data, cachedAt: new Date().toISOString() }));
      return data;
    } catch (err) {
      const cached = JSON.parse(localStorage.getItem(DONOR_CACHE_KEY) || 'null');
      if (cached?.donors) return { ...cached, offline: true, message: 'Offline: showing cached donors' };
      throw err;
    }
  },

  async loadEligibleDonors(alertId, bloodType, lat, lng, isEmergency = false) {
    try {
      const url = `/alerts/nearby-donors?lat=${lat}&lng=${lng}&bloodType=${bloodType}&isEmergency=${isEmergency}`;
      const { donors } = await apiCall('GET', url);
      localStorage.setItem(DONOR_CACHE_KEY, JSON.stringify({ donors, cachedAt: new Date().toISOString() }));
      return donors;
    } catch (err) {
      console.warn('Could not load eligible donors:', err.message);
      const cached = JSON.parse(localStorage.getItem(DONOR_CACHE_KEY) || 'null');
      return cached?.donors || [];
    }
  },

  renderEligibleDonors(donors, { highlightTop = true } = {}) {
    if (!donors?.length) return '<p class="donor-empty">No eligible donors found nearby.</p>';

    return donors.map((donor, idx) => {
      const eligibility = donor?.eligibility?.eligibility || 'UNKNOWN';
      const colorClass = eligibility === 'ELIGIBLE'
        ? 'donor-green'
        : eligibility === 'EMERGENCY_ELIGIBLE'
          ? 'donor-yellow'
          : 'donor-red';
      const lastDays = donor.daysSinceLastDonation ?? daysSince(donor.lastDonation || donor.lastDonationDate);
      const scorePct = Math.min(1, Math.max(0, donor.score || 0));
      const status = donor.status || (donor.isAvailable ? 'available' : 'offline');
      const daysLabel = lastDays === null ? 'N/A' : `${lastDays} days`;
      const daysRemaining = donor?.eligibility?.daysRemaining;
      const availabilityNote = daysRemaining !== null && daysRemaining !== undefined
        ? `Available in ${daysRemaining} days`
        : (eligibility === 'NOT_ELIGIBLE' ? 'Not eligible' : 'Available now');

      return `
        <div class="donor-card ${colorClass} ${highlightTop && idx === 0 ? 'top-donor' : ''}">
          <div class="donor-card-head">
            <div class="donor-blood">Blood: ${donor.bloodType || '-'}</div>
            <div class="donor-score">Score: ${(scorePct * 100).toFixed(0)}%</div>
          </div>
          <div class="donor-meta">
            <span>Status: ${eligibility}</span>
            <span>Last donation: ${daysLabel}</span>
            <span>Distance: ${(donor.distance || 0).toFixed(1)} km</span>
            <span>Donor status: ${status}</span>
          </div>
          <div class="donor-sub">${availabilityNote}</div>
        </div>
      `;
    }).join('');
  },

  async loadShortageIndicator(bloodType, lat, lng) {
    if (!bloodType) return;
    const banner = document.getElementById('shortageBanner');
    if (!banner) return;

    if (isOfflineMode()) {
      const cached = JSON.parse(localStorage.getItem(SHORTAGE_CACHE_KEY) || 'null');
      if (cached?.message) {
        banner.textContent = cached.message;
        banner.style.display = 'block';
      }
      return;
    }

    try {
      const params = new URLSearchParams({ bloodType });
      if (lat && lng) { params.set('lat', lat); params.set('lng', lng); }
      const res = await fetch(`${API_BASE}/insights/shortage?${params.toString()}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Shortage check failed');
      localStorage.setItem(SHORTAGE_CACHE_KEY, JSON.stringify({ ...data, cachedAt: new Date().toISOString() }));
      banner.textContent = data.message;
      banner.classList.toggle('shortage', data.shortage === true);
      banner.classList.toggle('stable', data.shortage === false);
      banner.style.display = 'block';
    } catch (err) {
      console.warn('Shortage check failed:', err.message);
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

    // Emergency broadcast
    _socket.on('emergency_alert', (payload) => {
      const msg = payload?.message || `Emergency request for ${payload?.bloodType || 'blood'} in your area.`;
      showNotif('🚨 Emergency Broadcast', msg);
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

    _socket.on('donor_status_changed', ({ userId, status }) => {
      if (_user?.id === userId) {
        _user.status = status;
        localStorage.setItem('ll_user', JSON.stringify(_user));
        LL.updateUI();
      }
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
    if (_user?.bloodType) LL.loadShortageIndicator(_user.bloodType);

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
