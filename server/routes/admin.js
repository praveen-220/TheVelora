const express = require('express');
const router = express.Router();
const db = require('../db');
const auth = require('../middleware/auth');
const requireRole = require('../middleware/role');

// GET /api/admin/stats - overview stats
router.get('/stats', auth, requireRole('admin'), (req, res) => {
  const totalUsers = db.prepare("SELECT COUNT(*) as c FROM users WHERE role != 'admin'").get().c;
  const totalDrivers = db.prepare("SELECT COUNT(*) as c FROM users WHERE role = 'driver'").get().c;
  const totalPassengers = db.prepare("SELECT COUNT(*) as c FROM users WHERE role = 'passenger'").get().c;
  const totalRides = db.prepare('SELECT COUNT(*) as c FROM rides').get().c;
  const completedRides = db.prepare("SELECT COUNT(*) as c FROM rides WHERE status = 'COMPLETED'").get().c;
  const activeRides = db.prepare("SELECT COUNT(*) as c FROM rides WHERE status = 'IN_PROGRESS'").get().c;
  const totalBookings = db.prepare('SELECT COUNT(*) as c FROM bookings').get().c;
  const totalRevenue = db.prepare("SELECT SUM(total_fare) as s FROM bookings WHERE status = 'COMPLETED'").get().s || 0;
  const activeSOS = db.prepare("SELECT COUNT(*) as c FROM sos_alerts WHERE status = 'ACTIVE'").get().c;
  const suspendedUsers = db.prepare('SELECT COUNT(*) as c FROM users WHERE is_suspended = 1').get().c;

  // Rides per day (last 7 days)
  const ridesPerDay = db.prepare(`
    SELECT DATE(created_at) as date, COUNT(*) as count
    FROM rides WHERE created_at >= datetime('now', '-7 days')
    GROUP BY DATE(created_at) ORDER BY date ASC
  `).all();

  // Revenue per day (last 7 days)
  const revenuePerDay = db.prepare(`
    SELECT DATE(b.created_at) as date, SUM(b.total_fare) as revenue
    FROM bookings b WHERE b.status = 'COMPLETED' AND b.created_at >= datetime('now', '-7 days')
    GROUP BY DATE(b.created_at) ORDER BY date ASC
  `).all();

  // Top drivers by rating
  const topDrivers = db.prepare(`
    SELECT id, name, rating_avg, rating_count, total_rides FROM users
    WHERE role = 'driver' ORDER BY rating_avg DESC, total_rides DESC LIMIT 5
  `).all();

  res.json({
    totalUsers, totalDrivers, totalPassengers, totalRides, completedRides, activeRides,
    totalBookings, totalRevenue, activeSOS, suspendedUsers, ridesPerDay, revenuePerDay, topDrivers
  });
});

// GET /api/admin/users - list all users
router.get('/users', auth, requireRole('admin'), (req, res) => {
  const { role, search, page = 1, limit = 20 } = req.query;
  let query = 'SELECT id, name, email, role, phone, rating_avg, rating_count, total_rides, is_suspended, created_at FROM users WHERE 1=1';
  const params = [];

  if (role) { query += ' AND role = ?'; params.push(role); }
  if (search) { query += ' AND (name LIKE ? OR email LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }
  query += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
  params.push(parseInt(limit), (parseInt(page) - 1) * parseInt(limit));

  const users = db.prepare(query).all(...params);
  const total = db.prepare('SELECT COUNT(*) as c FROM users WHERE 1=1').get().c;
  res.json({ users, total, page: parseInt(page), limit: parseInt(limit) });
});

// PUT /api/admin/users/:id/suspend - suspend/unsuspend or block user
router.put('/users/:id/suspend', auth, requireRole('admin'), (req, res) => {
  const { is_suspended } = req.body;
  const user = db.prepare('SELECT id, name, role FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (user.role === 'admin') return res.status(400).json({ error: 'Cannot block admin account' });

  const blockedVal = is_suspended ? 1 : 0;
  db.prepare('UPDATE users SET is_suspended = ? WHERE id = ?').run(blockedVal, req.params.id);

  if (blockedVal) {
    // Cancel active rides and reject pending bookings for blocked users
    db.prepare("UPDATE rides SET status = 'CANCELLED' WHERE driver_id = ? AND status IN ('SCHEDULED', 'IN_PROGRESS')").run(req.params.id);
    db.prepare("UPDATE bookings SET status = 'REJECTED' WHERE passenger_id = ? AND status = 'PENDING'").run(req.params.id);
  }

  const action = blockedVal ? 'permanently blocked' : 'reactivated';
  try {
    db.prepare(`INSERT INTO notifications (user_id, type, title, message) VALUES (?, ?, ?, ?)`)
      .run(req.params.id, 'ACCOUNT_STATUS',
        blockedVal ? 'Account Blocked' : 'Account Reactivated',
        blockedVal ? 'Your account has been permanently blocked by an administrator.' : 'Your account has been reactivated.');
  } catch (e) {}

  res.json({ message: `User ${user.name} has been ${action}.` });
});

// DELETE /api/admin/users/:id - permanently remove/delete user
router.delete('/users/:id', auth, requireRole('admin'), (req, res) => {
  const user = db.prepare('SELECT id, name, role FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (user.role === 'admin') return res.status(400).json({ error: 'Cannot delete an admin account' });

  const userId = req.params.id;
  const deleteTx = db.transaction(() => {
    // Delete SOS alerts
    db.prepare('DELETE FROM sos_alerts WHERE user_id = ?').run(userId);
    // Delete notifications
    db.prepare('DELETE FROM notifications WHERE user_id = ?').run(userId);
    // Delete ratings involving user
    db.prepare('DELETE FROM ratings WHERE rater_id = ? OR ratee_id = ?').run(userId, userId);
    // Delete bookings where user is passenger
    db.prepare('DELETE FROM bookings WHERE passenger_id = ?').run(userId);
    // For rides where user is driver, delete bookings first then rides
    db.prepare('DELETE FROM bookings WHERE ride_id IN (SELECT id FROM rides WHERE driver_id = ?)').run(userId);
    db.prepare('DELETE FROM rides WHERE driver_id = ?').run(userId);
    // Delete user record
    db.prepare('DELETE FROM users WHERE id = ?').run(userId);
  });

  deleteTx();
  res.json({ message: `User "${user.name}" has been permanently removed from the system.` });
});

// GET /api/admin/rides - list all rides
router.get('/rides', auth, requireRole('admin'), (req, res) => {
  const { status, page = 1, limit = 20 } = req.query;
  let query = `
    SELECT r.*, u.name as driver_name, u.email as driver_email,
           (SELECT COUNT(*) FROM bookings b WHERE b.ride_id = r.id AND b.status = 'CONFIRMED') as confirmed_bookings
    FROM rides r JOIN users u ON r.driver_id = u.id WHERE 1=1
  `;
  const params = [];

  if (status) { query += ' AND r.status = ?'; params.push(status); }
  query += ` ORDER BY r.created_at DESC LIMIT ? OFFSET ?`;
  params.push(parseInt(limit), (parseInt(page) - 1) * parseInt(limit));

  const rides = db.prepare(query).all(...params);
  const total = db.prepare('SELECT COUNT(*) as c FROM rides').get().c;
  res.json({ rides, total, page: parseInt(page), limit: parseInt(limit) });
});

// DELETE /api/admin/rides/:id - force delete ride
router.delete('/rides/:id', auth, requireRole('admin'), (req, res) => {
  const ride = db.prepare('SELECT id FROM rides WHERE id = ?').get(req.params.id);
  if (!ride) return res.status(404).json({ error: 'Ride not found' });
  db.prepare("UPDATE bookings SET status = 'CANCELLED' WHERE ride_id = ?").run(req.params.id);
  db.prepare('DELETE FROM rides WHERE id = ?').run(req.params.id);
  res.json({ message: 'Ride deleted' });
});

// GET /api/admin/sos - list SOS alerts
router.get('/sos', auth, requireRole('admin'), (req, res) => {
  const alerts = db.prepare(`
    SELECT s.*, u.name as user_name, u.phone as user_phone, u.email as user_email,
           r.origin, r.destination
    FROM sos_alerts s JOIN users u ON s.user_id = u.id
    LEFT JOIN rides r ON s.ride_id = r.id
    ORDER BY s.created_at DESC LIMIT 50
  `).all();
  res.json(alerts);
});

// GET /api/admin/bookings - recent bookings
router.get('/bookings', auth, requireRole('admin'), (req, res) => {
  const bookings = db.prepare(`
    SELECT b.*, u.name as passenger_name, r.origin, r.destination, r.departure_time,
           d.name as driver_name
    FROM bookings b
    JOIN users u ON b.passenger_id = u.id
    JOIN rides r ON b.ride_id = r.id
    JOIN users d ON r.driver_id = d.id
    ORDER BY b.created_at DESC LIMIT 50
  `).all();
  res.json(bookings);
});

// GET /api/admin/pricing - list pricing configs
router.get('/pricing', auth, requireRole('admin'), (req, res) => {
  const configs = db.prepare('SELECT * FROM pricing_configs ORDER BY id DESC').all();
  res.json(configs);
});

// POST /api/admin/pricing - add/update pricing config
router.post('/pricing', auth, requireRole('admin'), (req, res) => {
  const { id, car_model, max_age, price_per_km } = req.body;
  if (!car_model || max_age === undefined || !price_per_km) {
    return res.status(400).json({ error: 'car_model, max_age, and price_per_km are required' });
  }

  if (id) {
    db.prepare('UPDATE pricing_configs SET car_model = ?, max_age = ?, price_per_km = ? WHERE id = ?')
      .run(car_model, max_age, price_per_km, id);
  } else {
    db.prepare('INSERT INTO pricing_configs (car_model, max_age, price_per_km) VALUES (?, ?, ?)')
      .run(car_model, max_age, price_per_km);
  }
  res.json({ message: 'Pricing config saved successfully' });
});

// DELETE /api/admin/pricing/:id - delete pricing config
router.delete('/pricing/:id', auth, requireRole('admin'), (req, res) => {
  db.prepare('DELETE FROM pricing_configs WHERE id = ?').run(req.params.id);
  res.json({ message: 'Pricing config deleted' });
});

module.exports = router;
