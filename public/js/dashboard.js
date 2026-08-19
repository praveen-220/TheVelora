/* ── dashboard.js — Passenger dashboard ── */
let user = null;
let allRides = [];
let allBookings = [];
let currentBookingFilter = 'all';

async function init() {
  user = requireAuth(['passenger']);
  if (!user) return;

  setNavUser(user);
  updateWelcome();
  loadNotifications();
  setInterval(loadNotifications, 30000);

  // Load initial rides
  searchRides(null, true);
  loadBookings();

  // Load profile
  loadProfile();
}

function updateWelcome() {
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const el = document.getElementById('welcomeMsg');
  if (el) el.textContent = `${greet}, ${user.name.split(' ')[0]}! 👋`;
}

async function searchRides(e, initial = false) {
  if (e) e.preventDefault();
  const origin = document.getElementById('searchOrigin')?.value.trim() || '';
  const dest   = document.getElementById('searchDest')?.value.trim() || '';
  const date   = document.getElementById('searchDate')?.value || '';
  const seats  = document.getElementById('searchSeats')?.value || '';

  const btnText = document.getElementById('searchBtnText');
  const spinner = document.getElementById('searchSpinner');
  if (btnText) btnText.style.display = 'none';
  if (spinner) spinner.style.display = 'block';

  try {
    allRides = await api.searchRides({ origin, destination: dest, date, seats });
    renderRides(allRides, initial);
  } catch (err) {
    showToast('error', 'Search failed', err.message);
  } finally {
    if (btnText) btnText.style.display = 'inline';
    if (spinner) spinner.style.display = 'none';
  }
}

function renderRides(rides, initial = false) {
  const container = document.getElementById('ridesList');
  const countBadge = document.getElementById('resultsCount');
  const title = document.getElementById('resultsTitle');

  if (countBadge) {
    countBadge.textContent = `${rides.length} ride${rides.length !== 1 ? 's' : ''} found`;
    countBadge.style.display = rides.length > 0 ? 'inline-flex' : 'none';
  }
  if (title && !initial) title.textContent = 'Search Results';

  if (!rides.length) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">${initial ? '🚗' : '😔'}</div>
        <div class="empty-state-title">${initial ? 'No rides available right now' : 'No rides found'}</div>
        <p class="empty-state-desc">${initial ? 'Check back soon or try different search terms' : 'Try a different route or date'}</p>
      </div>`;
    return;
  }

  container.innerHTML = rides.map(r => `
    <div class="ride-card animate-fade-in">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap;">
        <div style="flex:1;min-width:200px;">
          <div style="display:flex;flex-direction:column;gap:6px;">
            <div class="route-display">
              <div style="display:flex;flex-direction:column;align-items:center;gap:4px;padding:4px 0;">
                <div class="route-dot origin"></div>
                <div class="route-line"></div>
                <div class="route-dot dest"></div>
              </div>
              <div style="flex:1;">
                <div class="route-place">${r.origin}</div>
                <div class="route-time">${fmtDateTime(r.departure_time)}</div>
                <div style="height:12px;"></div>
                <div class="route-place">${r.destination}</div>
              </div>
            </div>
          </div>
        </div>
        <div style="text-align:right;flex-shrink:0;">
          <div class="ride-price">${fmtCurrency(r.price_per_seat)}<span>/seat</span></div>
          <div style="font-size:0.8rem;color:var(--text-muted);margin-top:4px;">${r.seats_available} seat${r.seats_available !== 1 ? 's' : ''} left</div>
        </div>
      </div>

      <div class="ride-card-meta">
        <div class="ride-meta-item"><span class="ride-meta-icon">🚗</span>${r.vehicle_info || 'Vehicle info N/A'}</div>
        <div class="ride-meta-item"><span class="ride-meta-icon">🪪</span>${r.license_plate || '—'}</div>
        ${r.notes ? `<div class="ride-meta-item"><span class="ride-meta-icon">💬</span>${r.notes}</div>` : ''}
      </div>

      <div class="ride-card-footer">
        <div class="driver-info">
          <div class="avatar avatar-sm">${initials(r.driver_name)}</div>
          <div>
            <div style="font-size:0.875rem;font-weight:600;">${r.driver_name}</div>
            <div class="driver-rating">
              <span class="star-icon">⭐</span>
              ${parseFloat(r.driver_rating || 0).toFixed(1)}
              <span style="color:var(--text-muted);">(${r.driver_rating_count || 0})</span>
            </div>
          </div>
        </div>
        <button class="btn btn-primary btn-sm" onclick="openBookModal(${JSON.stringify(r).replace(/"/g,'&quot;')})">
          Book Ride →
        </button>
      </div>
    </div>
  `).join('');
}

function openBookModal(ride) {
  const content = document.getElementById('bookModalContent');
  content.innerHTML = `
    <div style="margin-bottom:16px;">
      <div style="font-size:0.9rem;color:var(--text-muted);margin-bottom:4px;">Route</div>
      <div style="font-weight:700;font-size:1rem;">${ride.origin} → ${ride.destination}</div>
      <div style="font-size:0.85rem;color:var(--text-secondary);margin-top:4px;">
        ${fmtDateTime(ride.departure_time)} • ${ride.seats_available} seats available
      </div>
    </div>

    <div class="booking-form">
      <div class="form-group">
        <label class="form-label">Number of Seats</label>
        <select id="bookSeats" class="form-select" onchange="updateFarePreview(${ride.price_per_seat})">
          ${Array.from({length: ride.seats_available}, (_,i) => i+1).map(n => `<option value="${n}">${n} seat${n>1?'s':''}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Split fare among (people)</label>
        <select id="splitCount" class="form-select" onchange="updateFarePreview(${ride.price_per_seat})">
          <option value="1">Just me (no split)</option>
          <option value="2">2 people</option>
          <option value="3">3 people</option>
          <option value="4">4 people</option>
        </select>
      </div>

      <div class="fare-breakdown" id="fareBreakdown">
        <div class="fare-row"><span class="fare-label">Price per seat</span><span>${fmtCurrency(ride.price_per_seat)}</span></div>
        <div class="fare-row"><span class="fare-label">Seats × 1</span><span id="seatsTotal">${fmtCurrency(ride.price_per_seat)}</span></div>
        <div class="fare-row total"><span class="fare-label">Your share</span><span class="fare-value" id="yourShare">${fmtCurrency(ride.price_per_seat)}</span></div>
      </div>

      <div class="fare-split-badge" id="splitBadge" style="display:none;">
        💚 Splitting with friends saves money!
      </div>

      <button class="btn btn-primary btn-full" onclick="confirmBooking(${ride.id})">
        Confirm Booking
      </button>
      <div style="text-align:center;font-size:0.78rem;color:var(--text-muted);margin-top:8px;">
        Booking is pending until driver confirms
      </div>
    </div>
  `;
  openModal('bookModal');
}

function updateFarePreview(pricePerSeat) {
  const seats     = parseInt(document.getElementById('bookSeats')?.value || 1);
  const splitCnt  = parseInt(document.getElementById('splitCount')?.value || 1);
  const total     = pricePerSeat * seats;
  const share     = total / splitCnt;

  const el = document.getElementById('seatsTotal');
  const shareEl = document.getElementById('yourShare');
  const splitBadge = document.getElementById('splitBadge');
  if (el)    el.textContent = fmtCurrency(total);
  if (shareEl) shareEl.textContent = fmtCurrency(share);
  if (splitBadge) splitBadge.style.display = splitCnt > 1 ? 'flex' : 'none';
}

async function confirmBooking(rideId) {
  const seats = parseInt(document.getElementById('bookSeats')?.value || 1);
  const split = parseInt(document.getElementById('splitCount')?.value || 1);
  try {
    await api.bookRide(rideId, { seats_booked: seats, split_count: split });
    closeModal('bookModal');
    showToast('success', 'Booking Requested!', 'Waiting for driver confirmation.');
    loadBookings();
    // Refresh search results
    searchRides(null, true);
  } catch (err) {
    showToast('error', 'Booking failed', err.message);
  }
}

async function loadBookings() {
  try {
    allBookings = await api.getMyRides();
    filterBookings(currentBookingFilter);
  } catch (err) {
    showToast('error', 'Failed to load bookings', err.message);
  }
}

function filterBookings(status, btn = null) {
  currentBookingFilter = status;
  if (btn) {
    document.querySelectorAll('#section-bookings .tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  }
  const filtered = status === 'all' ? allBookings : allBookings.filter(b => b.booking_status === status);
  renderBookings(filtered);
}

function renderBookings(bookings) {
  const container = document.getElementById('bookingsList');
  if (!bookings.length) {
    container.innerHTML = `<div class="empty-state"><div class="empty-state-icon">🎫</div><div class="empty-state-title">No bookings yet</div><p class="empty-state-desc">Find and book a ride to get started!</p></div>`;
    return;
  }
  container.innerHTML = bookings.map(b => `
    <div class="booking-card animate-fade-in">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap;">
        <div>
          <div style="font-weight:700;font-size:1rem;">${b.origin} → ${b.destination}</div>
          <div style="font-size:0.85rem;color:var(--text-secondary);margin-top:4px;">${fmtDateTime(b.departure_time)}</div>
          <div style="margin-top:8px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
            ${statusBadge(b.booking_status)}
            <span style="font-size:0.8rem;color:var(--text-muted);">Booked ${fmtDate(b.created_at)}</span>
          </div>
        </div>
        <div style="text-align:right;flex-shrink:0;">
          <div style="font-size:1.2rem;font-weight:800;">${fmtCurrency(b.split_fare || b.total_fare)}</div>
          ${b.split_count > 1 ? `<div style="font-size:0.75rem;color:var(--success);">Split ÷${b.split_count}</div>` : ''}
          <div style="font-size:0.8rem;color:var(--text-muted);">${b.seats_booked} seat${b.seats_booked > 1 ? 's' : ''}</div>
        </div>
      </div>

      <div style="display:flex;align-items:center;gap:10px;margin-top:12px;padding-top:12px;border-top:1px solid var(--glass-border);">
        <div class="avatar avatar-sm">${initials(b.driver_name)}</div>
        <div style="flex:1;">
          <div style="font-size:0.875rem;font-weight:600;">${b.driver_name}</div>
          <div style="font-size:0.78rem;color:var(--text-muted);">${b.vehicle_info || ''} ${b.license_plate ? '• ' + b.license_plate : ''}</div>
        </div>
        <div style="display:flex;gap:6px;">
          ${b.booking_status === 'CONFIRMED' || b.booking_status === 'IN_PROGRESS'
            ? `<a href="/ride.html?bookingId=${b.booking_id}&rideId=${b.ride_id}" class="btn btn-secondary btn-sm">📍 Track Ride</a>`
            : ''}
          ${b.booking_status === 'COMPLETED'
            ? `<button class="btn btn-ghost btn-sm" onclick="openRatingModal(${b.ride_id},${b.driver_id || 0},'${b.driver_name}')">⭐ Rate Driver</button>`
            : ''}
        </div>
      </div>
    </div>
  `).join('');
}

function openRatingModal(rideId, driverId, driverName) {
  let rating = 0;
  const content = document.getElementById('ratingModalContent');
  content.innerHTML = `
    <p style="text-align:center;margin-bottom:8px;">How was your ride with <strong>${driverName}</strong>?</p>
    <div class="rating-widget">
      <div class="rating-stars" id="ratingStars">
        ${[1,2,3,4,5].map(v => `<span class="rating-star" data-val="${v}" onclick="setStarRating(${v})">⭐</span>`).join('')}
      </div>
      <div class="rating-label" id="ratingLabelText">Tap a star to rate</div>
    </div>
    <div class="form-group" style="margin-bottom:16px;">
      <label class="form-label">Comment (optional)</label>
      <textarea id="ratingComment" class="form-textarea" placeholder="Share your experience..."></textarea>
    </div>
    <input type="hidden" id="ratingVal" value="0"/>
    <button class="btn btn-primary btn-full" onclick="submitRatingFromModal(${rideId},${driverId})">Submit Rating</button>
    <button class="btn btn-ghost btn-full" onclick="closeModal('ratingModal')" style="margin-top:8px;">Cancel</button>
  `;
  openModal('ratingModal');
}

function setStarRating(val) {
  document.getElementById('ratingVal').value = val;
  const labels = ['','Terrible 😞','Poor 😕','Okay 😐','Good 😊','Excellent 🤩'];
  document.getElementById('ratingLabelText').textContent = labels[val];
  document.querySelectorAll('#ratingStars .rating-star').forEach((s,i) => {
    s.style.filter = i < val ? 'none' : 'grayscale(1)';
    s.style.transform = i < val ? 'scale(1.1)' : 'scale(1)';
  });
}

async function submitRatingFromModal(rideId, rateeId) {
  const score   = parseInt(document.getElementById('ratingVal')?.value || 0);
  const comment = document.getElementById('ratingComment')?.value.trim();
  if (!score) { showToast('warning','Please select a rating','Tap a star to rate'); return; }
  try {
    await api.submitRating({ ride_id: rideId, ratee_id: rateeId, score, comment });
    closeModal('ratingModal');
    showToast('success','Rating submitted!','Thank you for your feedback 🌟');
  } catch (err) {
    showToast('error','Failed to submit rating', err.message);
  }
}

async function loadProfile() {
  try {
    const me = await api.me();
    const avatar  = document.getElementById('profileAvatar');
    const name    = document.getElementById('profileName');
    const rating  = document.getElementById('profileRating');
    const rCount  = document.getElementById('profileRatingCount');
    const role    = document.getElementById('profileRole');
    if (avatar) avatar.textContent = initials(me.name);
    if (name) name.textContent = me.name;
    if (rating) rating.textContent = parseFloat(me.rating_avg || 0).toFixed(1);
    if (rCount) rCount.textContent = `(${me.rating_count || 0} reviews)`;
    if (role) role.textContent = me.role.charAt(0).toUpperCase() + me.role.slice(1);
    // Fill form
    const ni = document.getElementById('profileNameInput');
    const pi = document.getElementById('profilePhoneInput');
    const bi = document.getElementById('profileBioInput');
    if (ni) ni.value = me.name || '';
    if (pi) pi.value = me.phone || '';
    if (bi) bi.value = me.bio || '';
  } catch(e) {}
}

async function updateProfile(e) {
  e.preventDefault();
  try {
    const name  = document.getElementById('profileNameInput')?.value.trim();
    const phone = document.getElementById('profilePhoneInput')?.value.trim();
    const bio   = document.getElementById('profileBioInput')?.value.trim();
    const updated = await api.updateProfile({ name, phone, bio });
    const stored = getUser();
    setAuth(getToken(), { ...stored, name: updated.name });
    setNavUser(updated);
    showToast('success','Profile updated!','Your changes have been saved.');
    loadProfile();
  } catch(err) {
    showToast('error','Update failed', err.message);
  }
}

async function changePassword(e) {
  e.preventDefault();
  const current = document.getElementById('currentPwd')?.value;
  const newPwd  = document.getElementById('newPwd')?.value;
  try {
    await api.changePassword({ current_password: current, new_password: newPwd });
    showToast('success','Password changed!','Your password has been updated.');
    document.getElementById('pwdForm').reset();
  } catch(err) {
    showToast('error','Failed to change password', err.message);
  }
}

init();
