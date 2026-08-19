const db = require('../db');

// Stores active socket connections per user
const userSockets = new Map(); // userId -> Set of socketIds
const driverLocations = new Map(); // rideId -> { lat, lng, heading }

function setupTracking(io) {
  io.on('connection', (socket) => {
    console.log(`🔌 Socket connected: ${socket.id}`);

    // Authenticate socket connection
    socket.on('auth', ({ userId, role }) => {
      if (!userId) return;
      socket.userId = userId;
      socket.role = role;
      socket.join(`user:${userId}`);

      if (!userSockets.has(userId)) userSockets.set(userId, new Set());
      userSockets.get(userId).add(socket.id);

      // Send pending notifications
      const unread = db.prepare('SELECT COUNT(*) as c FROM notifications WHERE user_id = ? AND is_read = 0').get(userId);
      socket.emit('notification_count', { count: unread.c });
      console.log(`✅ Socket auth: user ${userId} (${role})`);
    });

    // Driver joins a ride room
    socket.on('join_ride', ({ rideId }) => {
      socket.join(`ride:${rideId}`);
      socket.rideId = rideId;

      // Send last known location if exists
      if (driverLocations.has(rideId)) {
        socket.emit('location_update', driverLocations.get(rideId));
      }
      console.log(`📍 User joined ride room: ${rideId}`);
    });

    // Driver leaves a ride room
    socket.on('leave_ride', ({ rideId }) => {
      socket.leave(`ride:${rideId}`);
      console.log(`👋 User left ride room: ${rideId}`);
    });

    // Driver updates location
    socket.on('update_location', ({ rideId, lat, lng, heading, speed }) => {
      if (!rideId || lat === undefined || lng === undefined) return;

      const locationData = { rideId, lat, lng, heading: heading || 0, speed: speed || 0, timestamp: new Date().toISOString() };
      driverLocations.set(rideId, locationData);

      // Update DB
      db.prepare('UPDATE rides SET current_lat = ?, current_lng = ? WHERE id = ?').run(lat, lng, rideId);

      // Broadcast to all in ride room
      io.to(`ride:${rideId}`).emit('location_update', locationData);
    });

    // Send notification to specific user
    socket.on('send_notification', ({ userId, notification }) => {
      io.to(`user:${userId}`).emit('new_notification', notification);
    });

    // SOS alert broadcast
    socket.on('sos_triggered', ({ userId, rideId, lat, lng }) => {
      io.emit('sos_alert', { userId, rideId, lat, lng, timestamp: new Date().toISOString() });
      console.log(`🚨 SOS from user ${userId} on ride ${rideId}`);
    });

    // Chat in ride (bonus feature)
    socket.on('ride_message', ({ rideId, message, senderId, senderName }) => {
      io.to(`ride:${rideId}`).emit('ride_message', {
        message, senderId, senderName, timestamp: new Date().toISOString()
      });
    });

    // Status update events
    socket.on('ride_status_update', ({ rideId, status }) => {
      io.to(`ride:${rideId}`).emit('ride_status_changed', { rideId, status, timestamp: new Date().toISOString() });
    });

    socket.on('disconnect', () => {
      if (socket.userId && userSockets.has(socket.userId)) {
        userSockets.get(socket.userId).delete(socket.id);
        if (userSockets.get(socket.userId).size === 0) {
          userSockets.delete(socket.userId);
        }
      }
      console.log(`❌ Socket disconnected: ${socket.id}`);
    });
  });
}

function notifyUser(io, userId, notification) {
  io.to(`user:${userId}`).emit('new_notification', notification);
}

function broadcastRideUpdate(io, rideId, event, data) {
  io.to(`ride:${rideId}`).emit(event, data);
}

module.exports = { setupTracking, notifyUser, broadcastRideUpdate, userSockets, driverLocations };
