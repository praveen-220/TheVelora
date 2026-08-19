/* ── history.js — Ride history page ── */
let user = null;
let allHistory = [];

async function init() {
  user = requireAuth();
  if (!user) return;

  const backBtn = document.getElementById('backBtn');
  if (backBtn) {
    backBtn.href = user.role === 'driver' ? '/driver.html' : '/dashboard.html';
  }

  await loadHistory();
}

async function loadHistory() {
  try {
    allHistory = await api.getMyRides();
    updateSummary();
    filterHistory('all');
  } catch(err) {
    showToast('error','Failed to load history', err.message);
    document.getElementById('historyList').innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">⚠️</div>
        <div class="empty-state-title">Failed to load history</div>
        <p class="empty-state-desc">${err.message}</p>
      </div>`;
  }
}

function updateSummary() {
  const completed = allHistory.filter(r => (r.booking_status || r.status) === 'COMPLETED');
  const totalSpent = completed.reduce((sum, r) => sum + (r.split_fare || r.total_fare || 0), 0);

  document.getElementById('sumTotal').textContent   = allHistory.length;
  document.getElementById('sumSpent').textContent   = fmtCurrency(totalSpent);
  document.getElementById('sumRating').textContent  = '4.9★';
}

function filterHistory(status, btn = null) {
  if (btn) {
    document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
    btn.classList.add('active');
  }
  const filtered = status === 'all'
    ? allHistory
    : allHistory.filter(r => (r.booking_status || r.status) === status);
  renderHistory(filtered);
}

function renderHistory(items) {
  const container = document.getElementById('historyList');
  if (!items.length) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">📋</div>
        <div class="empty-state-title">No rides found</div>
        <p class="empty-state-desc">Try a different filter or book your first ride!</p>
      </div>`;
    return;
  }

  const isDriver = user.role === 'driver';
  container.innerHTML = items.map(r => {
    const status = r.booking_status || r.status;
    const fare   = r.split_fare || r.total_fare || (r.price_per_seat * (r.seats_total - r.seats_available));
    const person = isDriver ? null : r.driver_name;

    return `
      <div class="history-card animate-fade-in">
        <div class="history-card-header">
          <div>
            <div style="font-weight:800;font-size:1.05rem;">${r.origin} → ${r.destination}</div>
            <div class="history-date">${fmtDateTime(r.departure_time)}</div>
          </div>
          <div style="text-align:right;">
            <div class="history-fare">${fmtCurrency(fare)}</div>
            ${r.split_count > 1 ? `<div style="font-size:0.72rem;color:var(--success);">Split ÷${r.split_count}</div>` : ''}
          </div>
        </div>

        <div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap;">
          ${statusBadge(status)}
          ${r.seats_booked ? `<span style="font-size:0.8rem;color:var(--text-muted);">🎫 ${r.seats_booked} seat${r.seats_booked>1?'s':''}</span>` : ''}
          ${!isDriver && r.driver_name ? `
            <div style="display:flex;align-items:center;gap:6px;font-size:0.8rem;color:var(--text-muted);">
              <div class="avatar avatar-sm" style="width:22px;height:22px;font-size:0.6rem;">${initials(r.driver_name)}</div>
              ${r.driver_name}
              ${r.driver_rating ? `<span style="color:#f59e0b;">⭐ ${parseFloat(r.driver_rating||0).toFixed(1)}</span>` : ''}
            </div>
          ` : ''}
          ${r.vehicle_info ? `<span style="font-size:0.78rem;color:var(--text-muted);">🚗 ${r.vehicle_info}</span>` : ''}
        </div>

        <div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap;">
          ${status === 'CONFIRMED' || status === 'IN_PROGRESS' ? `
            <a href="/ride.html?bookingId=${r.booking_id}&rideId=${r.ride_id || r.id}" class="btn btn-secondary btn-sm">📍 Track</a>
          ` : ''}
          ${status === 'COMPLETED' && !isDriver ? `
            <button class="btn btn-ghost btn-sm" onclick="openRating(${r.ride_id || r.id}, '${r.driver_name}')">⭐ Rate Driver</button>
            <button class="btn btn-ghost btn-sm" onclick="reBook('${r.origin}','${r.destination}')">🔄 Re-book</button>
          ` : ''}
          ${isDriver && status === 'COMPLETED' ? `
            <button class="btn btn-ghost btn-sm" onclick="window.location.href='/driver.html'">+ New Ride</button>
          ` : ''}
          ${status === 'PENDING' ? `<span style="font-size:0.8rem;color:var(--text-muted);align-self:center;">⏳ Awaiting driver confirmation</span>` : ''}
        </div>
      </div>
    `;
  }).join('');
}

function openRating(rideId, driverName) {
  const content = document.getElementById('ratingModalContent');
  content.innerHTML = `
    <p style="text-align:center;margin-bottom:16px;">Rate your driver <strong>${driverName}</strong></p>
    <div class="rating-widget">
      <div class="rating-stars" id="histRatingStars">
        ${[1,2,3,4,5].map(v => `<span class="rating-star" style="font-size:2.2rem;cursor:pointer;" onclick="setHistStar(${v},${rideId})">${v <= 0 ? '☆' : '⭐'}</span>`).join('')}
      </div>
      <div class="rating-label" id="histRatingLabel">Tap a star to rate</div>
    </div>
    <div class="form-group" style="margin-bottom:16px;">
      <label class="form-label">Comment (optional)</label>
      <textarea id="histRatingComment" class="form-textarea" placeholder="Share your experience..."></textarea>
    </div>
    <input type="hidden" id="histRatingVal" value="0"/>
    <input type="hidden" id="histRideId" value="${rideId}"/>
    <button class="btn btn-primary btn-full" onclick="submitHistRating()">Submit Rating</button>
    <button class="btn btn-ghost btn-full" onclick="closeModal('ratingModal')" style="margin-top:8px;">Cancel</button>
  `;
  openModal('ratingModal');
}

let currentRideIdForRating = null;
function setHistStar(val, rideId) {
  currentRideIdForRating = rideId;
  document.getElementById('histRatingVal').value = val;
  const labels = ['','Terrible 😞','Poor 😕','Okay 😐','Good 😊','Excellent 🤩'];
  document.getElementById('histRatingLabel').textContent = labels[val];
  document.querySelectorAll('#histRatingStars .rating-star').forEach((s,i) => {
    s.style.filter = i < val ? 'none' : 'grayscale(1)';
    s.style.transform = i < val ? 'scale(1.1)' : '';
  });
}

async function submitHistRating() {
  const score   = parseInt(document.getElementById('histRatingVal')?.value || 0);
  const comment = document.getElementById('histRatingComment')?.value.trim();
  const rideId  = currentRideIdForRating;
  if (!score) { showToast('warning','Please select a rating',''); return; }

  // Find driver_id for this ride
  const rideData = allHistory.find(r => (r.ride_id || r.id) == rideId);
  const driverId = rideData?.driver_id;
  if (!driverId) { showToast('error','Cannot find driver info',''); return; }

  try {
    await api.submitRating({ ride_id: rideId, ratee_id: driverId, score, comment });
    closeModal('ratingModal');
    showToast('success','Rating submitted! ⭐','Thank you for your feedback.');
  } catch(err) {
    showToast('error','Failed', err.message);
  }
}

function reBook(origin, destination) {
  window.location.href = `/dashboard.html?origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}`;
}

init();
