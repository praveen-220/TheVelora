const express = require('express');
const router = express.Router();
const db = require('../db');
const auth = require('../middleware/auth');

// GET /api/notifications - get user notifications
router.get('/', auth, (req, res) => {
  const { limit = 20, offset = 0 } = req.query;
  const notifications = db.prepare(`
    SELECT * FROM notifications WHERE user_id = ?
    ORDER BY created_at DESC LIMIT ? OFFSET ?
  `).all(req.user.id, parseInt(limit), parseInt(offset));

  const unread_count = db.prepare('SELECT COUNT(*) as c FROM notifications WHERE user_id = ? AND is_read = 0')
    .get(req.user.id).c;

  res.json({ notifications, unread_count });
});

// PUT /api/notifications/read-all - mark all as read
router.put('/read-all', auth, (req, res) => {
  db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ?').run(req.user.id);
  res.json({ message: 'All notifications marked as read' });
});

// PUT /api/notifications/:id/read - mark single as read
router.put('/:id/read', auth, (req, res) => {
  db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?')
    .run(req.params.id, req.user.id);
  res.json({ message: 'Notification marked as read' });
});

// DELETE /api/notifications/:id - delete notification
router.delete('/:id', auth, (req, res) => {
  db.prepare('DELETE FROM notifications WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  res.json({ message: 'Notification deleted' });
});

module.exports = router;
