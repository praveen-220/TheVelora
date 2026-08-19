/* ── Velora API Client ── */
const API_BASE = '/api';

function getToken() { return localStorage.getItem('velora_token'); }
function getUser()  { const u = localStorage.getItem('velora_user'); return u ? JSON.parse(u) : null; }
function setAuth(token, user) {
  localStorage.setItem('velora_token', token);
  localStorage.setItem('velora_user', JSON.stringify(user));
}
function clearAuth() {
  localStorage.removeItem('velora_token');
  localStorage.removeItem('velora_user');
}

async function request(method, path, body = null, auth = true) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth) {
    const token = getToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;
  }
  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);

  const res = await fetch(API_BASE + path, opts);
  const data = await res.json();
  if (!res.ok) throw { status: res.status, message: data.error || 'Request failed' };
  return data;
}

const api = {
  // Auth
  login:    (email, password) => request('POST', '/auth/login', { email, password }, false),
  register: (body)            => request('POST', '/auth/register', body, false),
  verifyPhone: (body)         => request('POST', '/auth/verify-phone', body, false),
  resendOtp: (body)           => request('POST', '/auth/resend-otp', body, false),
  me:       ()                => request('GET',  '/auth/me'),
  updateProfile: (body)       => request('PUT',  '/auth/profile', body),
  changePassword: (body)      => request('PUT',  '/auth/password', body),

  // Rides
  searchRides: (params) => {
    const q = new URLSearchParams(Object.fromEntries(Object.entries(params).filter(([,v]) => v)));
    return request('GET', `/rides?${q}`);
  },
  getMyRides:   ()         => request('GET', '/rides/my'),
  getRide:      (id)       => request('GET', `/rides/${id}`),
  estimateRide: (params)   => request('GET', '/rides/estimate?' + new URLSearchParams(params)),
  createRide:   (body)     => request('POST', '/rides', body),
  bookRide:     (id, body) => request('POST', `/rides/${id}/book`, body),
  respondBooking: (rideId, bookingId, status) =>
    request('PUT', `/rides/${rideId}/booking/${bookingId}`, { status }),
  updateRideStatus: (id, status) => request('PUT', `/rides/${id}/status`, { status }),
  getPassengers:    (id)         => request('GET',  `/rides/${id}/passengers`),
  deleteRide:       (id)         => request('DELETE', `/rides/${id}`),

  // Ratings
  submitRating: (body) => request('POST', '/ratings', body),
  getUserRatings: (userId) => request('GET', `/ratings/user/${userId}`),
  checkRating: (rideId, rateeId) => request('GET', `/ratings/check/${rideId}/${rateeId}`),

  // SOS
  triggerSOS: (body) => request('POST', '/sos', body),

  // Notifications
  getNotifications: (params = {}) => {
    const q = new URLSearchParams(params);
    return request('GET', `/notifications?${q}`);
  },
  markAllRead:  ()   => request('PUT', '/notifications/read-all'),
  markRead:     (id) => request('PUT', `/notifications/${id}/read`),
  deleteNotif:  (id) => request('DELETE', `/notifications/${id}`),

  // Admin
  adminStats:    ()       => request('GET', '/admin/stats'),
  adminUsers:    (params) => {
    const q = new URLSearchParams(Object.fromEntries(Object.entries(params).filter(([,v]) => v)));
    return request('GET', `/admin/users?${q}`);
  },
  adminRides:    (params) => {
    const q = new URLSearchParams(Object.fromEntries(Object.entries(params).filter(([,v]) => v)));
    return request('GET', `/admin/rides?${q}`);
  },
  adminBookings: ()       => request('GET', '/admin/bookings'),
  adminSOS:      ()       => request('GET', '/admin/sos'),
  adminPricing:  ()       => request('GET', '/admin/pricing'),
  savePricingRule: (body) => request('POST', '/admin/pricing', body),
  deletePricingRule: (id) => request('DELETE', `/admin/pricing/${id}`),
  resolveSOS:    (id)     => request('PUT', `/sos/${id}/resolve`),
  suspendUser:   (id, is_suspended) => request('PUT', `/admin/users/${id}/suspend`, { is_suspended }),
  deleteUser:    (id)     => request('DELETE', `/admin/users/${id}`),
  deleteAdminRide: (id)   => request('DELETE', `/admin/rides/${id}`),
};

/* ── Toast Notifications ── */
function showToast(type, title, message, duration = 4000) {
  const container = document.getElementById('toastContainer');
  if (!container) return;
  const icons = { success: '✅', error: '❌', info: 'ℹ️', warning: '⚠️' };
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <div class="toast-icon">${icons[type] || 'ℹ️'}</div>
    <div class="toast-content">
      <div class="toast-title">${title}</div>
      ${message ? `<div class="toast-msg">${message}</div>` : ''}
    </div>
    <button onclick="this.parentElement.remove()" style="background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:1rem;padding:0 0 0 8px;">✕</button>
  `;
  container.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('hiding');
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

/* ── Modals ── */
function openModal(id)  { document.getElementById(id)?.classList.add('active'); }
function closeModal(id) { document.getElementById(id)?.classList.remove('active'); }

/* ── Auth Guard ── */
function requireAuth(allowedRoles = []) {
  const token = getToken();
  const user  = getUser();
  if (!token || !user) {
    window.location.href = '/login.html';
    return null;
  }
  if (allowedRoles.length && !allowedRoles.includes(user.role)) {
    const redirect = user.role === 'driver' ? '/driver.html' : user.role === 'admin' ? '/admin.html' : '/dashboard.html';
    window.location.href = redirect;
    return null;
  }
  return user;
}

/* ── Logout ── */
function logout() {
  clearAuth();
  window.location.href = '/login.html';
}

/* ── Helpers ── */
function fmtDate(dt) {
  if (!dt) return '—';
  return new Date(dt).toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric' });
}
function fmtTime(dt) {
  if (!dt) return '—';
  return new Date(dt).toLocaleTimeString('en-IN', { hour:'2-digit', minute:'2-digit', hour12:true });
}
function fmtDateTime(dt) {
  if (!dt) return '—';
  return `${fmtDate(dt)} at ${fmtTime(dt)}`;
}
function fmtCurrency(n) {
  return '₹' + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}
function initials(name) {
  if (!name) return '?';
  return name.split(' ').map(w => w[0]).join('').toUpperCase().substring(0, 2);
}
function timeAgo(dt) {
  const diff = Date.now() - new Date(dt).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}
function statusBadge(status) {
  const map = {
    SCHEDULED: 'badge-warning', IN_PROGRESS: 'badge-secondary',
    COMPLETED: 'badge-success', CANCELLED: 'badge-danger',
    PENDING: 'badge-warning', CONFIRMED: 'badge-success',
    REJECTED: 'badge-danger', ACTIVE: 'badge-danger', RESOLVED: 'badge-success'
  };
  return `<span class="badge ${map[status] || 'badge-muted'}">${status}</span>`;
}
function stars(rating, count = 0) {
  const r = parseFloat(rating) || 0;
  const filled = Math.round(r);
  let html = '<div class="stars">';
  for (let i = 1; i <= 5; i++) {
    html += `<span class="star ${i <= filled ? 'filled' : ''}">★</span>`;
  }
  html += `</div>`;
  if (count) html += `<span style="font-size:0.75rem;color:var(--text-muted);margin-left:4px;">(${count})</span>`;
  return html;
}
function debounce(fn, delay = 400) {
  let t; return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), delay); };
}

/* ── Notification Panel (shared) ── */
async function loadNotifications() {
  try {
    const data = await api.getNotifications({ limit: 15 });
    const badge = document.getElementById('notifBadge');
    const list  = document.getElementById('notifList');
    if (badge) {
      badge.textContent = data.unread_count;
      badge.style.display = data.unread_count > 0 ? 'flex' : 'none';
    }
    if (list) {
      if (!data.notifications.length) {
        list.innerHTML = '<div class="notif-empty">No notifications yet</div>';
        return;
      }
      list.innerHTML = data.notifications.map(n => `
        <div class="notif-item ${n.is_read ? '' : 'unread'}" onclick="markNotifRead(${n.id},this)">
          ${!n.is_read ? '<div class="notif-dot"></div>' : '<div style="width:8px;"></div>'}
          <div style="flex:1;">
            <div class="notif-text-title">${n.title}</div>
            <div class="notif-text-msg">${n.message}</div>
            <div class="notif-time">${timeAgo(n.created_at)}</div>
          </div>
        </div>
      `).join('');
    }
  } catch(e) { /* silent */ }
}

async function markNotifRead(id, el) {
  el.classList.remove('unread');
  el.querySelector('.notif-dot')?.remove();
  try { await api.markRead(id); await loadNotifications(); } catch(e) {}
}
async function markAllRead() {
  try { await api.markAllRead(); await loadNotifications(); showToast('success','Done','All notifications marked as read'); } catch(e) {}
}
function toggleNotifPanel() {
  const panel = document.getElementById('notifPanel');
  panel?.classList.toggle('open');
}
document.addEventListener('click', e => {
  const panel = document.getElementById('notifPanel');
  if (panel?.classList.contains('open') && !e.target.closest('.notif-btn')) {
    panel.classList.remove('open');
  }
});

/* ── Sidebar Nav ── */
function showSection(name) {
  document.querySelectorAll('[id^="section-"]').forEach(s => s.style.display = 'none');
  document.querySelectorAll('.sidebar-item').forEach(s => s.classList.remove('active'));
  const sec = document.getElementById(`section-${name}`);
  const nav = document.getElementById(`nav-${name}`);
  if (sec) sec.style.display = 'block';
  if (nav) nav.classList.add('active');
}

/* ── Nav User Info ── */
function setNavUser(user) {
  const avatar = document.getElementById('navAvatar');
  const name   = document.getElementById('navName');
  if (avatar) avatar.textContent = initials(user.name);
  if (name)   name.textContent   = user.name.split(' ')[0];
}
