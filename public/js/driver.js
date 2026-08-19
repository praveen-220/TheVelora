let user = null;
let driverRides = [];
let currentRideFilter = 'all';

// Map variables
let offerMap, offerOriginMarker, offerDestMarker, offerRouteLine;
let clickState = 'origin'; // 'origin' or 'dest'

async function init() {
  user = requireAuth(['driver']);
  if (!user) return;

  setNavUser(user);
  updateWelcome();
  loadNotifications();
  setInterval(loadNotifications, 30000);

  loadDriverStats();
  loadDriverRides();
  setMinDateTime();
}

function updateWelcome() {
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const el = document.getElementById('welcomeMsg');
  if (el) el.textContent = `${greet}, ${user.name.split(' ')[0]}! 🚗`;
}

function setMinDateTime() {
  const el = document.getElementById('offerTime');
  if (!el) return;
  const now = new Date();
  now.setMinutes(now.getMinutes() + 30);
  el.min = now.toISOString().slice(0, 16);
}

async function loadDriverStats() {
  try {
    const me = await api.me();
    const rides = await api.getMyRides();
    const completed = rides.filter(r => r.status === 'COMPLETED').length;
    const earnings = rides.filter(r => r.status === 'COMPLETED')
      .reduce((sum, r) => sum + ((r.price_per_seat || 0) * (r.seats_total - r.seats_available)), 0);

    document.getElementById('statTotalRides').textContent = completed;
    document.getElementById('statRating').textContent = parseFloat(me.rating_avg || 0).toFixed(1) + '★';
    document.getElementById('statEarnings').textContent = fmtCurrency(earnings);
  } catch(e) {}
}

async function loadDriverRides() {
  try {
    driverRides = await api.getMyRides();
    filterDriverRides(currentRideFilter);
    renderRecentRides(driverRides.slice(0, 3));
  } catch(err) {
    showToast('error', 'Failed to load rides', err.message);
  }
}

function filterDriverRides(status, btn = null) {
  currentRideFilter = status;
  if (btn) {
    document.querySelectorAll('#section-myrides .tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  }
  const filtered = status === 'all' ? driverRides : driverRides.filter(r => r.status === status);
  renderDriverRides(filtered, document.getElementById('driverRidesList'));
}

function renderRecentRides(rides) {
  renderDriverRides(rides, document.getElementById('recentRides'));
}

function renderDriverRides(rides, container) {
  if (!container) return;
  if (!rides.length) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">🚗</div>
        <div class="empty-state-title">No rides yet</div>
        <p class="empty-state-desc">Offer your first ride to start earning!</p>
        <button class="btn btn-primary" style="margin-top:16px;" onclick="showSection('offer')">+ Offer a Ride</button>
      </div>`;
    return;
  }
  container.innerHTML = rides.map(r => `
    <div class="ride-card animate-fade-in">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap;">
        <div>
          <div style="font-weight:700;font-size:1rem;">${r.origin} → ${r.destination}</div>
          <div style="font-size:0.85rem;color:var(--text-secondary);margin-top:4px;">${fmtDateTime(r.departure_time)}</div>
          <div style="margin-top:8px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
            ${statusBadge(r.status)}
            <span style="font-size:0.8rem;color:var(--text-muted);">
              ${r.confirmed_passengers || 0} confirmed • ${r.pending_passengers || 0} pending
            </span>
          </div>
        </div>
        <div style="text-align:right;flex-shrink:0;">
          <div style="font-size:1.2rem;font-weight:800;">${fmtCurrency(r.price_per_seat)}<span style="font-size:0.78rem;font-weight:400;color:var(--text-muted);">/seat</span></div>
          <div style="font-size:0.8rem;color:var(--text-muted);">${r.seats_available}/${r.seats_total} seats left</div>
        </div>
      </div>

      <div style="display:flex;gap:8px;flex-wrap:wrap;padding-top:12px;border-top:1px solid var(--glass-border);margin-top:4px;">
        ${r.status === 'SCHEDULED' ? `
          <button class="btn btn-success btn-sm" onclick="updateStatus(${r.id},'IN_PROGRESS')">▶ Start Ride</button>
          <button class="btn btn-ghost btn-sm" onclick="openPassengersModal(${r.id})">👥 Passengers</button>
          <button class="btn btn-danger btn-sm" onclick="deleteRide(${r.id})">🗑 Cancel</button>
        ` : ''}
        ${r.status === 'IN_PROGRESS' ? `
          <a href="/ride.html?rideId=${r.id}&driver=1" class="btn btn-secondary btn-sm">📍 Track Live</a>
          <button class="btn btn-primary btn-sm" onclick="updateStatus(${r.id},'COMPLETED')">✅ Complete Ride</button>
          <button class="btn btn-ghost btn-sm" onclick="openPassengersModal(${r.id})">👥 Passengers</button>
        ` : ''}
        ${r.status === 'COMPLETED' ? `
          <button class="btn btn-ghost btn-sm" onclick="openPassengersModal(${r.id})">👥 View Passengers</button>
        ` : ''}
        ${r.notes ? `<div class="ride-meta-item" style="margin-left:auto;font-size:0.78rem;color:var(--text-muted);">💬 ${r.notes}</div>` : ''}
      </div>
    </div>
  `).join('');
}

async function offerRide(e) {
  e.preventDefault();
  const origin    = document.getElementById('offerOrigin').value.trim();
  const dest      = document.getElementById('offerDest').value.trim();
  const time      = document.getElementById('offerTime').value;
  const seats     = document.getElementById('offerSeats').value;
  const notes     = document.getElementById('offerNotes').value.trim();
  const oCoordsRaw = document.getElementById('offerOriginCoords').value.trim();
  const dCoordsRaw = document.getElementById('offerDestCoords').value.trim();

  const errEl  = document.getElementById('offerError');
  const btnText = document.getElementById('offerBtnText');
  const spinner = document.getElementById('offerSpinner');

  errEl.textContent = '';
  btnText.style.display = 'none';
  spinner.style.display = 'block';

  let origin_lat, origin_lng, dest_lat, dest_lng;
  if (oCoordsRaw) { const [a,b] = oCoordsRaw.split(',').map(Number); origin_lat = a; origin_lng = b; }
  if (dCoordsRaw) { const [a,b] = dCoordsRaw.split(',').map(Number); dest_lat = a; dest_lng = b; }

  try {
    await api.createRide({
      origin, destination: dest, departure_time: time,
      seats_total: parseInt(seats),
      notes, origin_lat, origin_lng, dest_lat, dest_lng
    });
    showToast('success', 'Ride Offered! 🚗', 'Passengers can now find and book your ride.');
    document.getElementById('offerForm').reset();
    await loadDriverRides();
    showSection('myrides');
  } catch(err) {
    errEl.textContent = err.message || 'Failed to create ride. Please try again.';
  } finally {
    btnText.style.display = 'inline';
    spinner.style.display = 'none';
  }
}

async function updateStatus(rideId, status) {
  const labels = { IN_PROGRESS: 'started', COMPLETED: 'completed', CANCELLED: 'cancelled' };
  try {
    await api.updateRideStatus(rideId, status);
    showToast('success', `Ride ${labels[status] || 'updated'}!`, '');
    await loadDriverRides();
    if (status === 'IN_PROGRESS') {
      window.location.href = `/ride.html?rideId=${rideId}&driver=1`;
    }
  } catch(err) {
    showToast('error', 'Status update failed', err.message);
  }
}

async function deleteRide(rideId) {
  if (!confirm('Cancel this ride? All pending bookings will be cancelled.')) return;
  try {
    await api.deleteRide(rideId);
    showToast('success', 'Ride cancelled', 'All passengers have been notified.');
    await loadDriverRides();
  } catch(err) {
    showToast('error', 'Failed to cancel ride', err.message);
  }
}

async function openPassengersModal(rideId) {
  const content = document.getElementById('passengersContent');
  content.innerHTML = '<div style="text-align:center;padding:30px;"><div class="spinner" style="margin:0 auto;"></div></div>';
  openModal('passengersModal');

  try {
    const passengers = await api.getPassengers(rideId);
    if (!passengers.length) {
      content.innerHTML = '<div class="empty-state" style="padding:40px;"><div class="empty-state-icon">👥</div><div class="empty-state-title">No passengers yet</div></div>';
      return;
    }
    content.innerHTML = `<div class="passenger-list">${passengers.map(p => `
      <div class="passenger-item">
        <div class="avatar avatar-sm">${initials(p.name)}</div>
        <div style="flex:1;">
          <div style="font-weight:600;font-size:0.9rem;">${p.name}</div>
          <div style="font-size:0.78rem;color:var(--text-muted);">${p.phone || 'No phone'} • ${p.seats_booked} seat${p.seats_booked>1?'s':''} • ${fmtCurrency(p.total_fare)}</div>
          <div style="margin-top:4px;">
            ${statusBadge(p.status)}
            <span style="font-size:0.75rem;color:#f59e0b;margin-left:8px;">⭐ ${parseFloat(p.rating_avg||0).toFixed(1)}</span>
          </div>
        </div>
        <div class="passenger-actions">
          ${p.status === 'PENDING' ? `
            <button class="btn btn-success btn-sm" onclick="respondToBooking(${rideId},${p.booking_id},'CONFIRMED')">✓ Accept</button>
            <button class="btn btn-danger btn-sm" onclick="respondToBooking(${rideId},${p.booking_id},'REJECTED')">✗ Reject</button>
          ` : `
            <button class="btn btn-ghost btn-sm" onclick="openDriverRatingModal(${rideId},${p.passenger_id},'${p.name}')">⭐ Rate</button>
          `}
        </div>
      </div>
    `).join('')}</div>`;
  } catch(err) {
    content.innerHTML = `<div style="color:var(--danger);padding:20px;text-align:center;">${err.message}</div>`;
  }
}

async function respondToBooking(rideId, bookingId, status) {
  try {
    await api.respondBooking(rideId, bookingId, status);
    showToast('success', `Booking ${status.toLowerCase()}!`, '');
    await loadDriverRides();
    await openPassengersModal(rideId);
  } catch(err) {
    showToast('error', 'Failed to respond', err.message);
  }
}

function openDriverRatingModal(rideId, passengerId, name) {
  const content = document.getElementById('ratingModalContent');
  content.innerHTML = `
    <p style="text-align:center;margin-bottom:16px;">Rate passenger <strong>${name}</strong></p>
    <div class="rating-widget">
      <div class="rating-stars" id="driverRatingStars">
        ${[1,2,3,4,5].map(v => `<span class="rating-star" data-val="${v}" onclick="setDriverStar(${v})">⭐</span>`).join('')}
      </div>
      <div class="rating-label" id="driverRatingLabel">Tap a star</div>
    </div>
    <div class="form-group" style="margin-bottom:16px;">
      <label class="form-label">Comment (optional)</label>
      <textarea id="driverRatingComment" class="form-textarea" placeholder="Was this passenger punctual and polite?"></textarea>
    </div>
    <input type="hidden" id="driverRatingVal" value="0"/>
    <button class="btn btn-primary btn-full" onclick="submitDriverRating(${rideId},${passengerId})">Submit Rating</button>
    <button class="btn btn-ghost btn-full" onclick="closeModal('ratingModal')" style="margin-top:8px;">Cancel</button>
  `;
  closeModal('passengersModal');
  openModal('ratingModal');
}

function setDriverStar(val) {
  document.getElementById('driverRatingVal').value = val;
  const labels = ['','Terrible','Poor','Okay','Good','Excellent'];
  document.getElementById('driverRatingLabel').textContent = labels[val];
  document.querySelectorAll('#driverRatingStars .rating-star').forEach((s,i) => {
    s.style.filter = i < val ? 'none' : 'grayscale(1)';
  });
}

async function submitDriverRating(rideId, passengerId) {
  const score   = parseInt(document.getElementById('driverRatingVal')?.value || 0);
  const comment = document.getElementById('driverRatingComment')?.value.trim();
  if (!score) { showToast('warning','Please select a rating',''); return; }
  try {
    await api.submitRating({ ride_id: rideId, ratee_id: passengerId, score, comment });
    closeModal('ratingModal');
    showToast('success','Rating submitted!','');
  } catch(err) {
    showToast('error','Failed', err.message);
  }
}

async function loadProfile() {
  try {
    const me = await api.me();
    document.getElementById('profileAvatar').textContent = initials(me.name);
    document.getElementById('profileName').textContent = me.name;
    document.getElementById('profileRating').textContent = parseFloat(me.rating_avg || 0).toFixed(1);
    document.getElementById('profileRatingCount').textContent = `(${me.rating_count || 0} reviews)`;
    document.getElementById('profileNameInput').value   = me.name || '';
    document.getElementById('profilePhoneInput').value  = me.phone || '';
    document.getElementById('profileModelInput').value  = me.car_model || '';
    document.getElementById('profileAgeInput').value    = me.car_age || '';
    document.getElementById('profileVehicleInput').value = me.vehicle_info || '';
    document.getElementById('profilePlateInput').value  = me.license_plate || '';
    document.getElementById('profileBioInput').value    = me.bio || '';
  } catch(e) {}
}

async function updateProfile(e) {
  e.preventDefault();
  try {
    const updated = await api.updateProfile({
      name:          document.getElementById('profileNameInput').value.trim(),
      phone:         document.getElementById('profilePhoneInput').value.trim(),
      car_model:     document.getElementById('profileModelInput').value.trim(),
      car_age:       document.getElementById('profileAgeInput').value ? parseInt(document.getElementById('profileAgeInput').value) : null,
      vehicle_info:  document.getElementById('profileVehicleInput').value.trim(),
      license_plate: document.getElementById('profilePlateInput').value.trim(),
      bio:           document.getElementById('profileBioInput').value.trim(),
    });
    const stored = getUser();
    setAuth(getToken(), { ...stored, name: updated.name });
    setNavUser(updated);
    showToast('success','Profile updated!','');
    loadProfile();
  } catch(err) {
    showToast('error','Update failed', err.message);
  }
}

// Override showSection for profile load
const _origShowSection = showSection;
window.showSection = function(name) {
  _origShowSection(name);
  if (name === 'profile') loadProfile();
  if (name === 'myrides') filterDriverRides(currentRideFilter);
  if (name === 'offer') {
    setTimeout(() => {
      if (!offerMap) initOfferMap();
      else offerMap.invalidateSize();
    }, 100);
  }
};

/* ── MAP & ESTIMATE ── */
function initOfferMap() {
  offerMap = L.map('offerMap').setView([28.6139, 77.2090], 12);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(offerMap);

  offerMap.on('click', function(e) {
    if (clickState === 'origin') {
      if (offerOriginMarker) offerMap.removeLayer(offerOriginMarker);
      const icon = L.divIcon({ html: '📍', className: '', iconSize: [30,30], iconAnchor: [15,30] });
      offerOriginMarker = L.marker(e.latlng, { icon }).addTo(offerMap);
      document.getElementById('offerOriginCoords').value = `${e.latlng.lat.toFixed(5)}, ${e.latlng.lng.toFixed(5)}`;
      document.getElementById('offerOrigin').value = 'Selected Origin';
      clickState = 'dest';
    } else {
      if (offerDestMarker) offerMap.removeLayer(offerDestMarker);
      const icon = L.divIcon({ html: '🏁', className: '', iconSize: [30,30], iconAnchor: [15,30] });
      offerDestMarker = L.marker(e.latlng, { icon }).addTo(offerMap);
      document.getElementById('offerDestCoords').value = `${e.latlng.lat.toFixed(5)}, ${e.latlng.lng.toFixed(5)}`;
      document.getElementById('offerDest').value = 'Selected Destination';
      clickState = 'origin';
    }

    if (offerOriginMarker && offerDestMarker) {
      if (offerRouteLine) offerMap.removeLayer(offerRouteLine);
      offerRouteLine = L.polyline([offerOriginMarker.getLatLng(), offerDestMarker.getLatLng()], { color: '#7c3aed', weight: 3, dashArray: '8,4' }).addTo(offerMap);
      offerMap.fitBounds(offerRouteLine.getBounds(), { padding: [40, 40] });
      fetchEstimate();
    }
  });

  document.getElementById('offerSeats').addEventListener('change', fetchEstimate);
}

async function fetchEstimate() {
  const oLat = offerOriginMarker?.getLatLng().lat;
  const oLng = offerOriginMarker?.getLatLng().lng;
  const dLat = offerDestMarker?.getLatLng().lat;
  const dLng = offerDestMarker?.getLatLng().lng;
  const seats = document.getElementById('offerSeats').value;

  if (!oLat || !dLat || !seats) return;

  try {
    const est = await api.estimateRide({ origin_lat: oLat, origin_lng: oLng, dest_lat: dLat, dest_lng: dLng, seats_total: seats });
    document.getElementById('pricePreviewWidget').style.display = 'block';
    document.getElementById('previewDistance').textContent = est.distance_km < 1 ? \`\${Math.round(est.distance_km*1000)} m\` : \`\${est.distance_km.toFixed(1)} km\`;
    document.getElementById('previewRate').textContent = \`₹\${est.price_per_km} / km\`;
    document.getElementById('previewSurge').textContent = \`\${est.surge_multiplier}x\`;
    document.getElementById('previewFare').textContent = \`₹\${est.estimated_price_per_seat}\`;
  } catch(e) {
    console.error('Failed to fetch estimate:', e);
  }
}

init();
