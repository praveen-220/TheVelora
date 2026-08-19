/* ── admin.js — Admin dashboard logic ── */
let user = null;
let ridesChart = null;
let revenueChart = null;
let userSearchTimeout = null;

async function init() {
  user = requireAuth(['admin']);
  if (!user) return;

  const navName = document.getElementById('navName');
  if (navName) navName.textContent = user.name;

  await loadOverview();
}

async function loadOverview() {
  try {
    const stats = await api.adminStats();

    document.getElementById('st-users').textContent   = stats.totalUsers;
    document.getElementById('st-rides').textContent   = stats.totalRides;
    document.getElementById('st-revenue').textContent = fmtCurrency(stats.totalRevenue);
    document.getElementById('st-sos').textContent     = stats.activeSOS;

    // SOS badge
    if (stats.activeSOS > 0) {
      document.getElementById('sosAlertBadge').style.display = 'inline-flex';
      document.getElementById('sosBadgeSidebar').style.display = 'inline-flex';
    }

    // Top drivers table
    const tbody = document.getElementById('topDriversTable');
    if (tbody) {
      tbody.innerHTML = stats.topDrivers.length
        ? stats.topDrivers.map((d,i) => `
            <tr>
              <td>${i+1}</td>
              <td><div style="display:flex;align-items:center;gap:8px;"><div class="avatar avatar-sm">${initials(d.name)}</div>${d.name}</div></td>
              <td><span style="color:#f59e0b;">⭐ ${parseFloat(d.rating_avg||0).toFixed(1)}</span> <span style="color:var(--text-muted);font-size:0.78rem;">(${d.rating_count})</span></td>
              <td>${d.total_rides}</td>
            </tr>
          `).join('')
        : '<tr><td colspan="4" style="text-align:center;padding:20px;color:var(--text-muted);">No drivers yet</td></tr>';
    }

    // Charts
    renderCharts(stats.ridesPerDay, stats.revenuePerDay);
  } catch(err) {
    showToast('error','Failed to load stats', err.message);
  }
}

function renderCharts(ridesData, revenueData) {
  const chartDefaults = {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { display: false }, tooltip: { backgroundColor: '#12121f', titleColor: '#f1f5f9', bodyColor: '#94a3b8', borderColor: 'rgba(255,255,255,0.08)', borderWidth: 1 } },
    scales: {
      x: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#94a3b8', font: { size: 11 } } },
      y: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#94a3b8', font: { size: 11 } } }
    }
  };

  // Rides chart
  const ridesCtx = document.getElementById('ridesChart');
  if (ridesCtx) {
    if (ridesChart) ridesChart.destroy();
    const labels = ridesData.length ? ridesData.map(d => d.date) : getLast7Days();
    const values = ridesData.length ? ridesData.map(d => d.count) : [0,0,0,0,0,0,0];
    ridesChart = new Chart(ridesCtx, {
      type: 'bar',
      data: {
        labels,
        datasets: [{ data: values, backgroundColor: 'rgba(255, 107, 0, 0.6)', borderColor: '#ff6b00', borderWidth: 2, borderRadius: 6 }]
      },
      options: chartDefaults
    });
  }

  // Revenue chart
  const revCtx = document.getElementById('revenueChart');
  if (revCtx) {
    if (revenueChart) revenueChart.destroy();
    const labels = revenueData.length ? revenueData.map(d => d.date) : getLast7Days();
    const values = revenueData.length ? revenueData.map(d => d.revenue || 0) : [0,0,0,0,0,0,0];
    revenueChart = new Chart(revCtx, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          data: values, borderColor: '#06b6d4', backgroundColor: 'rgba(6,182,212,0.1)',
          borderWidth: 2.5, fill: true, tension: 0.4,
          pointBackgroundColor: '#06b6d4', pointRadius: 4
        }]
      },
      options: { ...chartDefaults, scales: { ...chartDefaults.scales, y: { ...chartDefaults.scales.y, ticks: { ...chartDefaults.scales.y.ticks, callback: v => '₹' + v } } } }
    });
  }
}

function getLast7Days() {
  return Array.from({length:7}, (_,i) => {
    const d = new Date(); d.setDate(d.getDate() - (6 - i));
    return d.toISOString().slice(0,10);
  });
}

// Users
async function loadUsers() {
  const tbody = document.getElementById('usersTable');
  tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:30px;"><div class="spinner" style="margin:0 auto;"></div></td></tr>';
  try {
    const search = document.getElementById('userSearch')?.value.trim();
    const role   = document.getElementById('userRoleFilter')?.value;
    const data = await api.adminUsers({ search, role, limit: 30 });
    if (!data.users.length) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:20px;color:var(--text-muted);">No users found</td></tr>';
      return;
    }
    tbody.innerHTML = data.users.map(u => `
      <tr>
        <td>
          <div style="display:flex;align-items:center;gap:10px;">
            <div class="avatar avatar-sm">${initials(u.name)}</div>
            <div>
              <div style="font-weight:600;font-size:0.875rem;">${u.name}</div>
              <div style="font-size:0.75rem;color:var(--text-muted);">${u.email}</div>
            </div>
          </div>
        </td>
        <td><span class="badge ${u.role==='driver'?'badge-secondary':u.role==='admin'?'badge-warning':'badge-primary'}">${u.role}</span></td>
        <td style="font-size:0.82rem;color:var(--text-muted);">${u.phone || '—'}</td>
        <td><span style="color:#f59e0b;">⭐ ${parseFloat(u.rating_avg||0).toFixed(1)}</span> <span style="color:var(--text-muted);font-size:0.75rem;">(${u.rating_count})</span></td>
        <td style="font-size:0.875rem;">${u.total_rides}</td>
        <td>${u.is_suspended ? '<span class="badge badge-danger">Blocked</span>' : '<span class="badge badge-success">Active</span>'}</td>
        <td>
          ${u.role !== 'admin' ? `
            <div style="display:flex; gap:6px; align-items:center;">
              <button class="btn btn-sm ${u.is_suspended ? 'btn-success' : 'btn-danger'}" onclick="toggleSuspend(${u.id},${u.is_suspended?0:1},'${u.name.replace(/'/g,"\\'")}')" title="${u.is_suspended ? 'Unblock user' : 'Block user permanently'}">
                ${u.is_suspended ? '✓ Unblock' : '🚫 Block'}
              </button>
              <button class="btn btn-sm btn-ghost" style="border-color: rgba(239,68,68,0.4); color: #f87171;" onclick="deleteUserPermanently(${u.id},'${u.name.replace(/'/g,"\\'")}')" title="Permanently delete user and records">
                🗑️ Delete
              </button>
            </div>
          ` : '<span style="color:var(--text-muted);font-size:0.78rem;">Admin</span>'}
        </td>
      </tr>
    `).join('');
  } catch(err) {
    tbody.innerHTML = `<tr><td colspan="7" style="color:var(--danger);text-align:center;padding:20px;">${err.message}</td></tr>`;
  }
}

async function toggleSuspend(userId, isSuspended, name) {
  const action = isSuspended ? 'permanently block' : 'unblock';
  if (!confirm(`Are you sure you want to ${action} user "${name}"?`)) return;
  try {
    const res = await api.suspendUser(userId, isSuspended);
    showToast('success', isSuspended ? 'User Blocked' : 'User Unblocked', res.message || name);
    loadUsers();
    loadStats();
  } catch(err) {
    showToast('error','Failed', err.message);
  }
}

async function deleteUserPermanently(userId, name) {
  if (!confirm(`⚠️ PERMANENT DELETION WARNING:\n\nAre you sure you want to permanently delete user "${name}"?\n\nThis will remove their profile, all their bookings, rides, SOS logs, and notifications permanently from the database. This action CANNOT be undone.`)) {
    return;
  }
  try {
    const res = await api.deleteUser(userId);
    showToast('success', 'User Deleted Permanently', res.message || name);
    loadUsers();
    loadStats();
  } catch(err) {
    showToast('error', 'Deletion Failed', err.message);
  }
}

function debounceUserSearch() {
  clearTimeout(userSearchTimeout);
  userSearchTimeout = setTimeout(loadUsers, 400);
}

// Rides
async function loadRides() {
  const tbody = document.getElementById('ridesTable');
  tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:30px;"><div class="spinner" style="margin:0 auto;"></div></td></tr>';
  try {
    const status = document.getElementById('rideStatusFilter')?.value;
    const data = await api.adminRides({ status, limit: 30 });
    if (!data.rides.length) {
      tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:20px;color:var(--text-muted);">No rides found</td></tr>';
      return;
    }
    tbody.innerHTML = data.rides.map(r => `
      <tr>
        <td style="color:var(--text-muted);font-size:0.78rem;">#${r.id}</td>
        <td style="font-size:0.875rem;">${r.driver_name}<br/><span style="color:var(--text-muted);font-size:0.75rem;">${r.driver_email}</span></td>
        <td style="font-size:0.875rem;">${r.origin} → ${r.destination}</td>
        <td style="font-size:0.8rem;color:var(--text-muted);">${fmtDateTime(r.departure_time)}</td>
        <td style="font-size:0.875rem;">${r.seats_available}/${r.seats_total}</td>
        <td style="font-weight:600;">${fmtCurrency(r.price_per_seat)}</td>
        <td>${statusBadge(r.status)}</td>
        <td>
          <button class="btn btn-danger btn-sm" onclick="adminDeleteRide(${r.id})">🗑</button>
        </td>
      </tr>
    `).join('');
  } catch(err) {
    tbody.innerHTML = `<tr><td colspan="8" style="color:var(--danger);text-align:center;padding:20px;">${err.message}</td></tr>`;
  }
}

async function adminDeleteRide(id) {
  if (!confirm('Delete this ride? All bookings will be cancelled.')) return;
  try {
    await api.deleteAdminRide(id);
    showToast('success','Ride deleted','');
    loadRides();
  } catch(err) {
    showToast('error','Failed', err.message);
  }
}

// Bookings
async function loadBookings() {
  const tbody = document.getElementById('bookingsTable');
  tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:30px;"><div class="spinner" style="margin:0 auto;"></div></td></tr>';
  try {
    const data = await api.adminBookings();
    if (!data.length) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:20px;color:var(--text-muted);">No bookings yet</td></tr>';
      return;
    }
    tbody.innerHTML = data.map(b => `
      <tr>
        <td style="color:var(--text-muted);font-size:0.78rem;">#${b.id}</td>
        <td style="font-size:0.875rem;">${b.passenger_name}</td>
        <td style="font-size:0.875rem;">${b.origin} → ${b.destination}</td>
        <td style="font-size:0.875rem;">${b.driver_name}</td>
        <td style="font-weight:600;">${fmtCurrency(b.total_fare)}</td>
        <td>${statusBadge(b.status)}</td>
        <td style="font-size:0.78rem;color:var(--text-muted);">${fmtDate(b.created_at)}</td>
      </tr>
    `).join('');
  } catch(err) {
    tbody.innerHTML = `<tr><td colspan="7" style="color:var(--danger);text-align:center;padding:20px;">${err.message}</td></tr>`;
  }
}

// Pricing Rules
let editPricingId = null;

async function loadPricing() {
  const tbody = document.getElementById('pricingTable');
  tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:30px;"><div class="spinner" style="margin:0 auto;"></div></td></tr>';
  try {
    const data = await api.adminPricing();
    if (!data.length) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:20px;color:var(--text-muted);">No pricing rules found</td></tr>';
      return;
    }
    tbody.innerHTML = data.map(p => `
      <tr>
        <td style="color:var(--text-muted);font-size:0.78rem;">#${p.id}</td>
        <td style="font-size:0.875rem;font-weight:500;">${p.car_model}</td>
        <td style="font-size:0.875rem;">${p.max_age}</td>
        <td style="font-weight:600;">₹${p.price_per_km}/km</td>
        <td style="font-size:0.78rem;color:var(--text-muted);">${fmtDate(p.created_at)}</td>
        <td>
          <button class="btn btn-ghost btn-sm" onclick="editPricing(${p.id}, '${p.car_model}', ${p.max_age}, ${p.price_per_km})">✏️</button>
          <button class="btn btn-danger btn-sm" onclick="deletePricingRule(${p.id})">🗑</button>
        </td>
      </tr>
    `).join('');
  } catch(err) {
    tbody.innerHTML = `<tr><td colspan="6" style="color:var(--danger);text-align:center;padding:20px;">${err.message}</td></tr>`;
  }
}

function openPricingModal() {
  editPricingId = null;
  document.getElementById('pricingModalTitle').textContent = 'Add Pricing Rule';
  document.getElementById('prcModel').value = '';
  document.getElementById('prcAge').value = '';
  document.getElementById('prcRate').value = '';
  openModal('pricingModal');
}

function editPricing(id, model, age, rate) {
  editPricingId = id;
  document.getElementById('pricingModalTitle').textContent = 'Edit Pricing Rule';
  document.getElementById('prcModel').value = model;
  document.getElementById('prcAge').value = age;
  document.getElementById('prcRate').value = rate;
  openModal('pricingModal');
}

async function savePricingRule() {
  const model = document.getElementById('prcModel').value.trim();
  const age = document.getElementById('prcAge').value;
  const rate = document.getElementById('prcRate').value;

  if (!model || age === '' || rate === '') {
    showToast('error', 'Please fill all fields', '');
    return;
  }

  try {
    await api.savePricingRule({ id: editPricingId, car_model: model, max_age: parseInt(age), price_per_km: parseFloat(rate) });
    showToast('success', 'Pricing rule saved', '');
    closeModal('pricingModal');
    loadPricing();
  } catch(err) {
    showToast('error', 'Failed', err.message);
  }
}

async function deletePricingRule(id) {
  if (!confirm('Delete this pricing rule?')) return;
  try {
    await api.deletePricingRule(id);
    showToast('success', 'Rule deleted', '');
    loadPricing();
  } catch(err) {
    showToast('error', 'Failed', err.message);
  }
}

// SOS Alerts
async function loadSOS() {
  const container = document.getElementById('sosAlertsList');
  container.innerHTML = '<div style="text-align:center;padding:40px;"><div class="spinner" style="margin:0 auto;"></div></div>';
  try {
    const data = await api.adminSOS();
    if (!data.length) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">✅</div>
          <div class="empty-state-title">No SOS alerts</div>
          <p class="empty-state-desc">All clear! No emergency alerts.</p>
        </div>`;
      return;
    }
    container.innerHTML = data.map(a => `
      <div style="background:${a.status==='ACTIVE'?'rgba(239,68,68,0.06)':'var(--bg-card)'};border:1px solid ${a.status==='ACTIVE'?'rgba(239,68,68,0.3)':'var(--glass-border)'};border-radius:var(--radius-lg);padding:20px;margin-bottom:12px;">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap;">
          <div>
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
              ${statusBadge(a.status)}
              <span style="font-size:0.8rem;color:var(--text-muted);">${fmtDateTime(a.created_at)}</span>
            </div>
            <div style="font-weight:700;font-size:1rem;margin-bottom:4px;">🚨 ${a.user_name}</div>
            <div style="font-size:0.875rem;color:var(--text-secondary);">
              📞 ${a.user_phone || 'No phone'} • ✉️ ${a.user_email}
            </div>
            ${a.origin ? `<div style="font-size:0.82rem;color:var(--text-muted);margin-top:4px;">Ride: ${a.origin} → ${a.destination}</div>` : ''}
            ${a.message ? `<div style="font-size:0.85rem;margin-top:8px;padding:8px 12px;background:rgba(239,68,68,0.1);border-radius:8px;">${a.message}</div>` : ''}
            ${a.lat && a.lng ? `<div style="font-size:0.78rem;color:var(--text-muted);margin-top:6px;">📍 ${parseFloat(a.lat).toFixed(5)}, ${parseFloat(a.lng).toFixed(5)}</div>` : ''}
          </div>
          ${a.status === 'ACTIVE' ? `
            <button class="btn btn-success btn-sm" onclick="resolveAlert(${a.id})">✓ Mark Resolved</button>
          ` : `<span class="badge badge-success">Resolved ${fmtDate(a.resolved_at)}</span>`}
        </div>
      </div>
    `).join('');
  } catch(err) {
    container.innerHTML = `<div style="color:var(--danger);padding:20px;text-align:center;">${err.message}</div>`;
  }
}

async function resolveAlert(id) {
  try {
    await api.resolveSOS(id);
    showToast('success','SOS alert resolved','');
    loadSOS();
    loadOverview();
  } catch(err) {
    showToast('error','Failed', err.message);
  }
}

// Sidebar routing with data loading
const _orig = window.showSection;
window.showSection = function(name) {
  _orig(name);
  if (name === 'overview')  loadOverview();
  if (name === 'users')     loadUsers();
  if (name === 'rides')     loadRides();
  if (name === 'bookings')  loadBookings();
  if (name === 'pricing')   loadPricing();
  if (name === 'sos')       loadSOS();
};

init();
