/* ── ride.js — Live ride tracking page ── */
let map, driverMarker, passengerMarker, routePolyline;
let socket;
let rideId, bookingId, isDriver = false;
let user, ride, booking;
let ratingScore = 0;
let trackingInterval;

async function init() {
  user = requireAuth();
  if (!user) return;

  const params = new URLSearchParams(window.location.search);
  rideId    = parseInt(params.get('rideId'));
  bookingId = parseInt(params.get('bookingId'));
  isDriver  = params.get('driver') === '1';

  if (!rideId) { showToast('error','Invalid ride',''); return; }

  initMap();
  await loadRideData();
  initSocket();

  if (isDriver) {
    document.getElementById('driverControls').style.display = 'block';
    startLocationSimulation();
  }
}

function initMap() {
  map = L.map('tracking-map', {
    center: [28.6139, 77.2090],
    zoom: 12,
    zoomControl: false
  });

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors',
    maxZoom: 19
  }).addTo(map);

  L.control.zoom({ position: 'bottomright' }).addTo(map);
}

async function loadRideData() {
  try {
    ride = await api.getRide(rideId);

    // Update route
    document.getElementById('routeOrigin').textContent = ride.origin;
    document.getElementById('routeDest').textContent   = ride.destination;
    document.getElementById('routeDepTime').textContent = fmtDateTime(ride.departure_time);

    // Update status
    updateStatusUI(ride.status);

    // Place markers
    const oLat = ride.origin_lat, oLng = ride.origin_lng;
    const dLat = ride.dest_lat,   dLng = ride.dest_lng;

    if (oLat && oLng) {
      const originIcon = L.divIcon({ html: '📍', className: '', iconSize: [30,30], iconAnchor: [15,30] });
      L.marker([oLat, oLng], { icon: originIcon }).addTo(map).bindPopup(`<b>Pickup:</b> ${ride.origin}`);
    }
    if (dLat && dLng) {
      const destIcon = L.divIcon({ html: '🏁', className: '', iconSize: [30,30], iconAnchor: [15,30] });
      L.marker([dLat, dLng], { icon: destIcon }).addTo(map).bindPopup(`<b>Drop-off:</b> ${ride.destination}`);
    }

    // Draw route line
    if (oLat && dLat) {
      routePolyline = L.polyline([[oLat, oLng], [dLat, dLng]], {
        color: '#7c3aed', weight: 3, opacity: 0.6, dashArray: '8,4'
      }).addTo(map);
      map.fitBounds(routePolyline.getBounds(), { padding: [40, 40] });
    }

    // Driver marker (if in_progress and current_lat exists)
    if (ride.current_lat && ride.current_lng) {
      placeDriverMarker(ride.current_lat, ride.current_lng);
      updateETA(ride.current_lat, ride.current_lng, dLat, dLng);
    }

    // Show driver or passenger info
    if (isDriver) {
      // Show first confirmed passenger
      const confirmed = ride.bookings?.filter(b => b.status === 'CONFIRMED') || [];
      if (confirmed.length) showPersonCard(confirmed[0], 'passenger');
      document.getElementById('seatsBooked').textContent = `${ride.seats_total - ride.seats_available} booked`;
      document.getElementById('rideFare').textContent    = fmtCurrency(ride.price_per_seat) + '/seat';
      document.getElementById('rideVehicle').textContent = ride.vehicle_info || '—';
      document.getElementById('ridePlate').textContent   = ride.license_plate || '—';

      // Update start/complete buttons
      if (ride.status === 'SCHEDULED') {
        document.getElementById('startBtn').style.display = 'block';
        document.getElementById('completeBtn').style.display = 'none';
      } else if (ride.status === 'IN_PROGRESS') {
        document.getElementById('startBtn').style.display = 'none';
        document.getElementById('completeBtn').style.display = 'block';
      }
    } else {
      showPersonCard(ride, 'driver');
      // Find booking info
      const myBooking = ride.bookings?.find(b => b.passenger_id === user.id);
      if (myBooking) {
        document.getElementById('seatsBooked').textContent = myBooking.seats_booked;
        document.getElementById('rideFare').textContent    = fmtCurrency(myBooking.split_fare || myBooking.total_fare);
      }
      document.getElementById('rideVehicle').textContent = ride.vehicle_info || '—';
      document.getElementById('ridePlate').textContent   = ride.license_plate || '—';
    }
  } catch(err) {
    showToast('error', 'Failed to load ride data', err.message);
  }
}

function showPersonCard(data, type) {
  const isPersonDriver = type === 'driver';
  const name    = isPersonDriver ? data.driver_name  : data.passenger_name;
  const rating  = isPersonDriver ? data.driver_rating : data.passenger_rating;
  const vehicle = isPersonDriver ? data.vehicle_info  : '';
  const phone   = isPersonDriver ? data.driver_phone  : data.passenger_phone;

  document.getElementById('personAvatar').textContent = initials(name || '?');
  document.getElementById('personName').textContent   = name || 'Unknown';
  document.getElementById('personSub').textContent    = vehicle || (isPersonDriver ? 'Driver' : 'Passenger');
  document.getElementById('personRating').textContent = parseFloat(rating || 0).toFixed(1) + ' ★';
  document.getElementById('callBtn').onclick = () => {
    if (phone) window.location.href = `tel:${phone}`;
    else showToast('info','Phone not available','');
  };
}

function updateStatusUI(status) {
  const dot  = document.getElementById('statusDot');
  const text = document.getElementById('statusText');
  const sub  = document.getElementById('statusSub');

  const statusMap = {
    SCHEDULED:   { cls: 'scheduled',   label: 'Ride Scheduled',     sub: 'Waiting for departure time' },
    IN_PROGRESS: { cls: 'in-progress', label: '🚗 Ride In Progress', sub: 'Your driver is on the way' },
    COMPLETED:   { cls: 'completed',   label: '✅ Ride Completed',   sub: 'You have arrived!' },
    CANCELLED:   { cls: 'cancelled',   label: '❌ Ride Cancelled',   sub: 'This ride was cancelled' },
  };
  const s = statusMap[status] || statusMap.SCHEDULED;
  if (dot) { dot.className = 'status-indicator ' + s.cls; }
  if (text) text.textContent = s.label;
  if (sub)  sub.textContent  = s.sub;

  if (status === 'COMPLETED' && !isDriver) {
    setTimeout(() => openRatingPrompt(), 1500);
  }
}

function placeDriverMarker(lat, lng) {
  const icon = L.divIcon({
    html: `<div class="driver-marker">🚗</div>`,
    className: '', iconSize: [40,40], iconAnchor: [20,20]
  });
  if (driverMarker) {
    driverMarker.setLatLng([lat, lng]);
  } else {
    driverMarker = L.marker([lat, lng], { icon }).addTo(map);
    driverMarker.bindPopup('Driver Location');
  }
}

function updateETA(currLat, currLng, destLat, destLng) {
  if (!destLat || !destLng) return;
  const R = 6371;
  const dLat = (destLat - currLat) * Math.PI / 180;
  const dLon = (destLng - currLng) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(currLat * Math.PI/180) * Math.cos(destLat * Math.PI/180) * Math.sin(dLon/2)**2;
  const distKm = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  const etaMin = Math.round(distKm / 30 * 60); // ~30km/h city speed

  const etaEl   = document.getElementById('etaValue');
  const distEl  = document.getElementById('distValue');
  const subEl   = document.getElementById('etaSub');
  if (etaEl)  etaEl.textContent  = etaMin < 60 ? `${etaMin} min` : `${Math.round(etaMin/60)}h ${etaMin%60}m`;
  if (distEl) distEl.textContent = distKm < 1 ? `${Math.round(distKm*1000)}m` : `${distKm.toFixed(1)} km`;
  if (subEl)  subEl.textContent  = 'Estimated arrival';
}

function centerMap() {
  if (driverMarker) map.panTo(driverMarker.getLatLng());
  else if (ride) map.setView([ride.origin_lat || 28.6139, ride.origin_lng || 77.2090], 12);
}

// Socket.IO
function initSocket() {
  socket = io();
  socket.on('connect', () => {
    socket.emit('auth', { userId: user.id, role: user.role });
    socket.emit('join_ride', { rideId });
  });
  socket.on('location_update', data => {
    if (data.rideId !== rideId) return;
    placeDriverMarker(data.lat, data.lng);
    updateETA(data.lat, data.lng, ride?.dest_lat, ride?.dest_lng);
    if (isDriver) return; // Driver sees own position
    map.panTo([data.lat, data.lng], { animate: true, duration: 1 });
  });
  socket.on('ride_status_changed', data => {
    if (data.rideId !== rideId) return;
    updateStatusUI(data.status);
  });
  socket.on('ride_message', data => {
    appendChatMessage(data.message, data.senderId === user.id ? 'mine' : 'other', data.senderName);
  });
  socket.on('new_notification', n => {
    showToast('info', n.title, n.message);
  });
}

// GPS Simulation for driver
function startLocationSimulation() {
  let lat = ride?.origin_lat || 28.6139;
  let lng = ride?.origin_lng || 77.2090;
  const destLat = ride?.dest_lat || 28.5355;
  const destLng = ride?.dest_lng || 77.3910;
  const steps = 60;
  const dLat = (destLat - lat) / steps;
  const dLng = (destLng - lng) / steps;
  let step = 0;

  trackingInterval = setInterval(() => {
    if (step >= steps) { clearInterval(trackingInterval); return; }
    lat += dLat + (Math.random() - 0.5) * 0.0003;
    lng += dLng + (Math.random() - 0.5) * 0.0003;
    step++;
    socket?.emit('update_location', { rideId, lat, lng, speed: 30 + Math.random() * 20 });
    placeDriverMarker(lat, lng);
    updateETA(lat, lng, destLat, destLng);
  }, 3000);
}

async function updateRideStatus(status) {
  try {
    await api.updateRideStatus(rideId, status);
    updateStatusUI(status);
    socket?.emit('ride_status_update', { rideId, status });
    if (status === 'COMPLETED') {
      clearInterval(trackingInterval);
      showToast('success','Ride completed! 🎉','');
    }
    showToast('success', `Ride ${status.toLowerCase().replace('_',' ')}`, '');
    await loadRideData();
  } catch(err) {
    showToast('error','Status update failed', err.message);
  }
}

async function triggerSOS() {
  const btn = document.getElementById('sosBtn');
  if (btn.classList.contains('triggered')) return;
  btn.classList.add('triggered');
  btn.innerHTML = '<span class="sos-pulse"></span> 🚨 SOS SENT — Help is coming!';

  try {
    const lat = driverMarker?.getLatLng()?.lat || null;
    const lng = driverMarker?.getLatLng()?.lng || null;
    await api.triggerSOS({ ride_id: rideId, lat, lng, message: 'Emergency SOS triggered from ride tracking page' });
    socket?.emit('sos_triggered', { userId: user.id, rideId, lat, lng });
    showToast('error','🚨 SOS Alert Sent!','Emergency contacts and Velora support have been notified.', 8000);
  } catch(err) {
    showToast('error','SOS failed', 'Please call emergency services directly.');
  }
}

function handleCall() {
  showToast('info','📞 Calling...','');
}

// Chat
function toggleChat() {
  document.getElementById('chatPanel').classList.toggle('open');
}
function sendChatMsg() {
  const input = document.getElementById('chatInput');
  const msg = input.value.trim();
  if (!msg) return;
  socket?.emit('ride_message', { rideId, message: msg, senderId: user.id, senderName: user.name });
  appendChatMessage(msg, 'mine', user.name);
  input.value = '';
}
function appendChatMessage(msg, type, name) {
  const container = document.getElementById('chatMessages');
  const div = document.createElement('div');
  div.className = `chat-msg ${type}`;
  div.innerHTML = type === 'other' ? `<div style="font-size:0.65rem;color:var(--text-muted);margin-bottom:3px;">${name}</div>${msg}` : msg;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

// Rating
function openRatingPrompt() {
  openModal('ratingModal');
}
function setRating(val) {
  ratingScore = val;
  const labels = ['','Terrible 😞','Poor 😕','Okay 😐','Good 😊','Excellent 🤩'];
  document.getElementById('ratingLabel').textContent = labels[val];
  document.querySelectorAll('#ratingStars .rating-star').forEach((s,i) => {
    s.style.filter = i < val ? 'none' : 'grayscale(1)';
    s.style.transform = i < val ? 'scale(1.15)' : 'scale(1)';
  });
}
async function submitRating() {
  if (!ratingScore) { showToast('warning','Please select a rating',''); return; }
  const comment = document.getElementById('ratingComment')?.value.trim();
  const rateeId = isDriver ? null : ride?.driver_id;
  if (!rateeId) { skipRating(); return; }
  try {
    await api.submitRating({ ride_id: rideId, ratee_id: rateeId, score: ratingScore, comment });
    closeModal('ratingModal');
    showToast('success','Rating submitted! ⭐','Thank you for your feedback.');
    setTimeout(() => window.location.href = '/history.html', 1500);
  } catch(err) {
    showToast('error','Failed to submit rating', err.message);
  }
}
function skipRating() {
  closeModal('ratingModal');
  window.location.href = '/history.html';
}

init();
