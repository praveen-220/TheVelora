const express = require('express');
const router = express.Router();
const db = require('../db');
const auth = require('../middleware/auth');

// POST /api/sos - trigger SOS alert
router.post('/', auth, (req, res) => {
  const { ride_id, lat, lng, message } = req.body;

  const result = db.prepare(`
    INSERT INTO sos_alerts (user_id, ride_id, lat, lng, message) VALUES (?, ?, ?, ?, ?)
  `).run(req.user.id, ride_id || null, lat || null, lng || null, message || 'SOS Emergency Alert');

  // Notify admin(s)
  const admins = db.prepare("SELECT id FROM users WHERE role = 'admin'").all();
  const user = db.prepare('SELECT name, phone FROM users WHERE id = ?').get(req.user.id);

  admins.forEach(admin => {
    db.prepare(`INSERT INTO notifications (user_id, type, title, message, data) VALUES (?, ?, ?, ?, ?)`)
      .run(admin.id, 'SOS_ALERT', '🚨 SOS ALERT',
        `URGENT: ${user.name} (${user.phone || 'No phone'}) has triggered an SOS alert!`,
        JSON.stringify({ sos_id: result.lastInsertRowid, user_id: req.user.id, ride_id, lat, lng }));
  });

  // Notify the driver if ride_id provided
  if (ride_id) {
    const ride = db.prepare('SELECT driver_id, destination FROM rides WHERE id = ?').get(ride_id);
    if (ride && ride.driver_id !== req.user.id) {
      db.prepare(`INSERT INTO notifications (user_id, type, title, message, data) VALUES (?, ?, ?, ?, ?)`)
        .run(ride.driver_id, 'SOS_ALERT', '🚨 Passenger SOS',
          `${user.name} has triggered an emergency SOS during your ride!`,
          JSON.stringify({ sos_id: result.lastInsertRowid }));
    }
  }

  const alert = db.prepare('SELECT * FROM sos_alerts WHERE id = ?').get(result.lastInsertRowid);
  console.log(`🚨 SOS ALERT from user ${req.user.id} (${req.user.name}) at ${lat}, ${lng}`);

  res.status(201).json({ message: 'SOS alert sent. Help is on the way!', alert });
});

// GET /api/sos - get SOS alerts (admin only)
router.get('/', auth, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });

  const alerts = db.prepare(`
    SELECT s.*, u.name as user_name, u.phone as user_phone, u.email as user_email,
           r.origin, r.destination
    FROM sos_alerts s
    JOIN users u ON s.user_id = u.id
    LEFT JOIN rides r ON s.ride_id = r.id
    ORDER BY s.created_at DESC LIMIT 100
  `).all();

  res.json(alerts);
});

// PUT /api/sos/:id/resolve - resolve SOS alert (admin)
router.put('/:id/resolve', auth, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });

  db.prepare("UPDATE sos_alerts SET status = 'RESOLVED', resolved_at = CURRENT_TIMESTAMP WHERE id = ?")
    .run(req.params.id);

  res.json({ message: 'SOS alert resolved' });
});

module.exports = router;
