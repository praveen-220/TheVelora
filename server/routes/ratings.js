const express = require('express');
const router = express.Router();
const db = require('../db');
const auth = require('../middleware/auth');

// POST /api/ratings - submit rating
router.post('/', auth, (req, res) => {
  const { ride_id, ratee_id, score, comment } = req.body;

  if (!ride_id || !ratee_id || !score) {
    return res.status(400).json({ error: 'ride_id, ratee_id, and score are required' });
  }
  if (score < 1 || score > 5) {
    return res.status(400).json({ error: 'Score must be between 1 and 5' });
  }
  if (req.user.id === ratee_id) {
    return res.status(400).json({ error: 'Cannot rate yourself' });
  }

  const ride = db.prepare('SELECT * FROM rides WHERE id = ?').get(ride_id);
  if (!ride) return res.status(404).json({ error: 'Ride not found' });
  if (ride.status !== 'COMPLETED') return res.status(400).json({ error: 'Can only rate completed rides' });

  // Verify rater was part of this ride
  const isDriver = ride.driver_id === req.user.id;
  const booking = db.prepare("SELECT id FROM bookings WHERE ride_id = ? AND passenger_id = ? AND status = 'COMPLETED'")
    .get(ride_id, req.user.id);

  if (!isDriver && !booking) {
    return res.status(403).json({ error: 'You were not part of this ride' });
  }

  try {
    db.prepare(`
      INSERT INTO ratings (ride_id, rater_id, ratee_id, score, comment)
      VALUES (?, ?, ?, ?, ?)
    `).run(ride_id, req.user.id, ratee_id, score, comment || null);

    // Recalculate average rating
    const stats = db.prepare('SELECT AVG(score) as avg, COUNT(*) as cnt FROM ratings WHERE ratee_id = ?').get(ratee_id);
    db.prepare('UPDATE users SET rating_avg = ?, rating_count = ? WHERE id = ?')
      .run(Math.round(stats.avg * 10) / 10, stats.cnt, ratee_id);

    // Notify the rated user
    const rater = db.prepare('SELECT name FROM users WHERE id = ?').get(req.user.id);
    db.prepare(`INSERT INTO notifications (user_id, type, title, message, data) VALUES (?, ?, ?, ?, ?)`)
      .run(ratee_id, 'NEW_RATING', 'New Rating Received ⭐',
        `${rater.name} gave you a ${score}-star rating!`,
        JSON.stringify({ ride_id, score }));

    res.status(201).json({ message: 'Rating submitted successfully', score });
  } catch (err) {
    if (err.message.includes('UNIQUE constraint')) {
      return res.status(409).json({ error: 'You have already rated this person for this ride' });
    }
    res.status(500).json({ error: 'Failed to submit rating' });
  }
});

// GET /api/ratings/user/:userId - get ratings for a user
router.get('/user/:userId', (req, res) => {
  const ratings = db.prepare(`
    SELECT r.*, u.name as rater_name, u.avatar_url as rater_avatar,
           ri.origin, ri.destination, ri.departure_time
    FROM ratings r
    JOIN users u ON r.rater_id = u.id
    JOIN rides ri ON r.ride_id = ri.id
    WHERE r.ratee_id = ?
    ORDER BY r.created_at DESC LIMIT 20
  `).all(req.params.userId);

  const summary = db.prepare(`
    SELECT AVG(score) as avg_score, COUNT(*) as total,
           SUM(CASE WHEN score = 5 THEN 1 ELSE 0 END) as five_star,
           SUM(CASE WHEN score = 4 THEN 1 ELSE 0 END) as four_star,
           SUM(CASE WHEN score = 3 THEN 1 ELSE 0 END) as three_star,
           SUM(CASE WHEN score = 2 THEN 1 ELSE 0 END) as two_star,
           SUM(CASE WHEN score = 1 THEN 1 ELSE 0 END) as one_star
    FROM ratings WHERE ratee_id = ?
  `).get(req.params.userId);

  res.json({ ratings, summary });
});

// GET /api/ratings/check/:rideId/:rateeId - check if already rated
router.get('/check/:rideId/:rateeId', auth, (req, res) => {
  const existing = db.prepare('SELECT id, score FROM ratings WHERE ride_id = ? AND rater_id = ? AND ratee_id = ?')
    .get(req.params.rideId, req.user.id, req.params.rateeId);
  res.json({ already_rated: !!existing, rating: existing || null });
});

module.exports = router;
