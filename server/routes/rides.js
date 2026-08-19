const express = require('express');
const router = express.Router();
const db = require('../db');
const auth = require('../middleware/auth');
const requireRole = require('../middleware/role');

function createNotification(userId, type, title, message, data = null) {
  try {
    db.prepare(`INSERT INTO notifications (user_id, type, title, message, data) VALUES (?, ?, ?, ?, ?)`)
      .run(userId, type, title, message, data ? JSON.stringify(data) : null);
  } catch (e) {}
}

function getDistanceFromLatLonInKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// GET /api/rides - search available rides
router.get('/', (req, res) => {
  const { origin, destination, date, seats } = req.query;
  let query = `
    SELECT r.*, u.name as driver_name, u.rating_avg as driver_rating, u.rating_count as driver_rating_count,
           u.vehicle_info, u.license_plate, u.phone as driver_phone, u.avatar_url as driver_avatar
    FROM rides r
    JOIN users u ON r.driver_id = u.id
    WHERE r.status = 'SCHEDULED' AND r.seats_available > 0 AND u.is_suspended = 0
  `;
  const params = [];

  if (origin) {
    query += ` AND r.origin LIKE ?`;
    params.push(`%${origin}%`);
  }
  if (destination) {
    query += ` AND r.destination LIKE ?`;
    params.push(`%${destination}%`);
  }
  if (date) {
    query += ` AND DATE(r.departure_time) = ?`;
    params.push(date);
  }
  if (seats) {
    query += ` AND r.seats_available >= ?`;
    params.push(parseInt(seats));
  }

  query += ` ORDER BY r.departure_time ASC LIMIT 50`;
  const rides = db.prepare(query).all(...params);
  res.json(rides);
});

// GET /api/rides/my - get rides for current user (driver or passenger)
router.get('/my', auth, (req, res) => {
  let rides;
  if (req.user.role === 'driver' || req.user.role === 'admin') {
    rides = db.prepare(`
      SELECT r.*, 
             (SELECT COUNT(*) FROM bookings b WHERE b.ride_id = r.id AND b.status = 'CONFIRMED') as confirmed_passengers,
             (SELECT COUNT(*) FROM bookings b WHERE b.ride_id = r.id AND b.status = 'PENDING') as pending_passengers
      FROM rides r WHERE r.driver_id = ? ORDER BY r.departure_time DESC
    `).all(req.user.id);
  } else {
    rides = db.prepare(`
      SELECT r.*, b.id as booking_id, b.seats_booked, b.total_fare, b.split_fare, b.split_count, b.status as booking_status,
             u.name as driver_name, u.rating_avg as driver_rating, u.vehicle_info, u.license_plate, u.phone as driver_phone, u.avatar_url as driver_avatar
      FROM bookings b
      JOIN rides r ON b.ride_id = r.id
      JOIN users u ON r.driver_id = u.id
      WHERE b.passenger_id = ? ORDER BY r.departure_time DESC
    `).all(req.user.id);
  }
  res.json(rides);
});

// GET /api/rides/:id - get single ride with bookings
router.get('/:id', (req, res) => {
  const ride = db.prepare(`
    SELECT r.*, u.name as driver_name, u.rating_avg as driver_rating, u.rating_count as driver_rating_count,
           u.vehicle_info, u.license_plate, u.phone as driver_phone, u.avatar_url as driver_avatar, u.bio as driver_bio
    FROM rides r JOIN users u ON r.driver_id = u.id WHERE r.id = ?
  `).get(req.params.id);

  if (!ride) return res.status(404).json({ error: 'Ride not found' });

  const bookings = db.prepare(`
    SELECT b.*, u.name as passenger_name, u.rating_avg as passenger_rating, u.phone as passenger_phone, u.avatar_url as passenger_avatar
    FROM bookings b JOIN users u ON b.passenger_id = u.id WHERE b.ride_id = ? AND b.status != 'CANCELLED'
  `).all(req.params.id);

  res.json({ ...ride, bookings });
});

// GET /api/rides/estimate - estimate price
router.get('/estimate', auth, requireRole('driver', 'admin'), (req, res) => {
  const { origin_lat, origin_lng, dest_lat, dest_lng, seats_total } = req.query;
  if (!origin_lat || !origin_lng || !dest_lat || !dest_lng || !seats_total) {
    return res.status(400).json({ error: 'Missing coordinates or seats' });
  }

  const driver = db.prepare('SELECT car_model, car_age FROM users WHERE id = ?').get(req.user.id);
  
  let distanceKm = getDistanceFromLatLonInKm(parseFloat(origin_lat), parseFloat(origin_lng), parseFloat(dest_lat), parseFloat(dest_lng));
  let price_per_km = 15; // default fallback

  if (driver.car_model && driver.car_age !== null) {
    const config = db.prepare('SELECT price_per_km FROM pricing_configs WHERE car_model = ? AND max_age >= ? ORDER BY max_age ASC LIMIT 1')
                     .get(driver.car_model, driver.car_age);
    if (config) {
      price_per_km = config.price_per_km;
    } else {
      const defaultCfg = db.prepare("SELECT price_per_km FROM pricing_configs WHERE car_model = 'Default' LIMIT 1").get();
      if (defaultCfg) price_per_km = defaultCfg.price_per_km;
    }
  }

  const activeRidesCount = db.prepare(`SELECT COUNT(*) as count FROM rides WHERE status IN ('SCHEDULED', 'IN_PROGRESS')`).get().count;
  let surgeMultiplier = 1.0;
  if (activeRidesCount > 20) surgeMultiplier = 1.5;
  else if (activeRidesCount > 10) surgeMultiplier = 1.3;
  else if (activeRidesCount > 2) surgeMultiplier = 1.1;

  price_per_km = price_per_km * surgeMultiplier;
  
  const calculated_price_per_seat = Math.max(10, Math.round((distanceKm * price_per_km) / parseInt(seats_total)));
  
  res.json({
    distance_km: distanceKm,
    price_per_km,
    surge_multiplier: surgeMultiplier,
    estimated_price_per_seat: calculated_price_per_seat,
    total_fare: calculated_price_per_seat * parseInt(seats_total)
  });
});

// POST /api/rides - create ride (driver only)
router.post('/', auth, requireRole('driver', 'admin'), (req, res) => {
  const { origin, destination, origin_lat, origin_lng, dest_lat, dest_lng,
          departure_time, seats_total, notes } = req.body;

  if (!origin || !destination || !departure_time || !seats_total) {
    return res.status(400).json({ error: 'Origin, destination, departure time, and seats are required' });
  }
  if (seats_total < 1 || seats_total > 10) {
    return res.status(400).json({ error: 'Seats must be between 1 and 10' });
  }
  if (new Date(departure_time) <= new Date()) {
    return res.status(400).json({ error: 'Departure time must be in the future' });
  }

  const driver = db.prepare('SELECT rating_avg, rating_count, car_model, car_age FROM users WHERE id = ?').get(req.user.id);
  if (driver.rating_count >= 5 && driver.rating_avg < 3.5) {
    return res.status(403).json({ error: 'Your rating is too low to offer rides (minimum 3.5 required).' });
  }

  const oLat = origin_lat || 28.6139;
  const oLng = origin_lng || 77.2090;
  const dLat = dest_lat || 28.5355;
  const dLng = dest_lng || 77.3910;

  let distanceKm = getDistanceFromLatLonInKm(oLat, oLng, dLat, dLng);
  let price_per_km = 15; // default fallback

  if (driver.car_model && driver.car_age !== null) {
    const config = db.prepare('SELECT price_per_km FROM pricing_configs WHERE car_model = ? AND max_age >= ? ORDER BY max_age ASC LIMIT 1')
                     .get(driver.car_model, driver.car_age);
    if (config) {
      price_per_km = config.price_per_km;
    } else {
      const defaultCfg = db.prepare("SELECT price_per_km FROM pricing_configs WHERE car_model = 'Default' LIMIT 1").get();
      if (defaultCfg) price_per_km = defaultCfg.price_per_km;
    }
  }

  // Surge Pricing Algorithm
  const activeRidesCount = db.prepare(`SELECT COUNT(*) as count FROM rides WHERE status IN ('SCHEDULED', 'IN_PROGRESS')`).get().count;
  let surgeMultiplier = 1.0;
  if (activeRidesCount > 20) surgeMultiplier = 1.5;
  else if (activeRidesCount > 10) surgeMultiplier = 1.3;
  else if (activeRidesCount > 2) surgeMultiplier = 1.1;

  price_per_km = price_per_km * surgeMultiplier;

  const calculated_price_per_seat = Math.max(10, Math.round((distanceKm * price_per_km) / seats_total));

  const result = db.prepare(`
    INSERT INTO rides (driver_id, origin, destination, origin_lat, origin_lng, dest_lat, dest_lng,
      departure_time, seats_total, seats_available, price_per_seat, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(req.user.id, origin, destination, oLat, oLng, dLat, dLng, departure_time, seats_total, seats_total, calculated_price_per_seat, notes || null);

  const ride = db.prepare('SELECT * FROM rides WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(ride);
});

// POST /api/rides/:id/book - book a ride (passenger only)
router.post('/:id/book', auth, requireRole('passenger'), (req, res) => {
  const { seats_booked = 1, split_count = 1 } = req.body;
  const rideId = parseInt(req.params.id);

  const ride = db.prepare('SELECT * FROM rides WHERE id = ?').get(rideId);
  if (!ride) return res.status(404).json({ error: 'Ride not found' });
  if (ride.status !== 'SCHEDULED') return res.status(400).json({ error: 'Ride is no longer available' });
  if (ride.driver_id === req.user.id) return res.status(400).json({ error: 'Drivers cannot book their own rides' });
  if (ride.seats_available < seats_booked) {
    return res.status(400).json({ error: `Only ${ride.seats_available} seats available` });
  }

  const existing = db.prepare('SELECT id FROM bookings WHERE ride_id = ? AND passenger_id = ? AND status != ?').get(rideId, req.user.id, 'CANCELLED');
  if (existing) return res.status(409).json({ error: 'You have already booked this ride' });

  const total_fare = ride.price_per_seat * seats_booked;
  const split_fare = total_fare / Math.max(1, split_count);

  const bookResult = db.prepare(`
    INSERT INTO bookings (ride_id, passenger_id, seats_booked, total_fare, split_fare, split_count, status)
    VALUES (?, ?, ?, ?, ?, ?, 'PENDING')
  `).run(rideId, req.user.id, seats_booked, total_fare, split_fare, split_count);

  db.prepare('UPDATE rides SET seats_available = seats_available - ? WHERE id = ?').run(seats_booked, rideId);

  const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(bookResult.lastInsertRowid);

  // Notify driver
  const passenger = db.prepare('SELECT name FROM users WHERE id = ?').get(req.user.id);
  createNotification(ride.driver_id, 'BOOKING_REQUEST', 'New Booking Request',
    `${passenger.name} wants to book ${seats_booked} seat(s) on your ride to ${ride.destination}`,
    { ride_id: rideId, booking_id: booking.id });

  res.status(201).json(booking);
});

// PUT /api/rides/:id/booking/:bookingId - accept/reject booking (driver)
router.put('/:id/booking/:bookingId', auth, requireRole('driver', 'admin'), (req, res) => {
  const { status } = req.body; // CONFIRMED or REJECTED
  if (!['CONFIRMED', 'REJECTED'].includes(status)) {
    return res.status(400).json({ error: 'Status must be CONFIRMED or REJECTED' });
  }

  const booking = db.prepare(`
    SELECT b.*, r.driver_id, r.destination, u.name as passenger_name
    FROM bookings b JOIN rides r ON b.ride_id = r.id JOIN users u ON b.passenger_id = u.id
    WHERE b.id = ? AND b.ride_id = ?
  `).get(req.params.bookingId, req.params.id);

  if (!booking) return res.status(404).json({ error: 'Booking not found' });
  if (booking.driver_id !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Not authorized' });
  }

  db.prepare('UPDATE bookings SET status = ? WHERE id = ?').run(status, booking.id);

  if (status === 'REJECTED') {
    db.prepare('UPDATE rides SET seats_available = seats_available + ? WHERE id = ?').run(booking.seats_booked, req.params.id);
  }

  const notifTitle = status === 'CONFIRMED' ? 'Booking Confirmed! 🎉' : 'Booking Rejected';
  const notifMsg = status === 'CONFIRMED'
    ? `Your booking for the ride to ${booking.destination} has been confirmed!`
    : `Your booking request for the ride to ${booking.destination} was rejected.`;
  createNotification(booking.passenger_id, `BOOKING_${status}`, notifTitle, notifMsg, { ride_id: booking.ride_id, booking_id: booking.id });

  res.json({ message: `Booking ${status.toLowerCase()}`, booking_id: booking.id, status });
});

// PUT /api/rides/:id/status - update ride status (driver)
router.put('/:id/status', auth, requireRole('driver', 'admin'), (req, res) => {
  const { status } = req.body;
  const validStatuses = ['SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'];
  if (!validStatuses.includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }

  const ride = db.prepare('SELECT * FROM rides WHERE id = ?').get(req.params.id);
  if (!ride) return res.status(404).json({ error: 'Ride not found' });
  if (ride.driver_id !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Not authorized' });
  }

  db.prepare('UPDATE rides SET status = ? WHERE id = ?').run(status, ride.id);

  // Notify all confirmed passengers
  const passengers = db.prepare(`
    SELECT b.passenger_id FROM bookings b WHERE b.ride_id = ? AND b.status = 'CONFIRMED'
  `).all(ride.id);

  const messages = {
    IN_PROGRESS: { title: 'Ride Started! 🚗', msg: `Your ride from ${ride.origin} to ${ride.destination} has started!` },
    COMPLETED: { title: 'Ride Completed ✅', msg: `Your ride to ${ride.destination} is complete. Please rate your driver!` },
    CANCELLED: { title: 'Ride Cancelled ❌', msg: `Your ride to ${ride.destination} has been cancelled by the driver.` }
  };

  if (messages[status]) {
    passengers.forEach(p => {
      createNotification(p.passenger_id, `RIDE_${status}`, messages[status].title, messages[status].msg, { ride_id: ride.id });
    });
  }

  // If completed, update total_rides for driver
  if (status === 'COMPLETED') {
    db.prepare('UPDATE users SET total_rides = total_rides + 1 WHERE id = ?').run(ride.driver_id);
    db.prepare("UPDATE bookings SET status = 'COMPLETED' WHERE ride_id = ? AND status = 'CONFIRMED'").run(ride.id);
  }

  if (status === 'CANCELLED') {
    // Refund seats and cancel bookings
    db.prepare("UPDATE bookings SET status = 'CANCELLED' WHERE ride_id = ? AND status IN ('PENDING','CONFIRMED')").run(ride.id);
  }

  res.json({ message: `Ride status updated to ${status}`, ride_id: ride.id });
});

// DELETE /api/rides/:id - cancel ride (driver)
router.delete('/:id', auth, requireRole('driver', 'admin'), (req, res) => {
  const ride = db.prepare('SELECT * FROM rides WHERE id = ?').get(req.params.id);
  if (!ride) return res.status(404).json({ error: 'Ride not found' });
  if (ride.driver_id !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Not authorized' });
  }
  if (ride.status === 'IN_PROGRESS') {
    return res.status(400).json({ error: 'Cannot delete a ride in progress' });
  }

  db.prepare("UPDATE bookings SET status = 'CANCELLED' WHERE ride_id = ?").run(ride.id);
  db.prepare('DELETE FROM rides WHERE id = ?').run(ride.id);
  res.json({ message: 'Ride deleted successfully' });
});

// GET /api/rides/:id/passengers - get passengers for a ride (driver)
router.get('/:id/passengers', auth, requireRole('driver', 'admin'), (req, res) => {
  const ride = db.prepare('SELECT driver_id FROM rides WHERE id = ?').get(req.params.id);
  if (!ride) return res.status(404).json({ error: 'Ride not found' });
  if (ride.driver_id !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Not authorized' });
  }

  const passengers = db.prepare(`
    SELECT b.id as booking_id, b.seats_booked, b.total_fare, b.split_fare, b.split_count, b.status, b.created_at,
           u.id as passenger_id, u.name, u.phone, u.rating_avg, u.avatar_url
    FROM bookings b JOIN users u ON b.passenger_id = u.id WHERE b.ride_id = ?
  `).all(req.params.id);

  res.json(passengers);
});

module.exports = router;
