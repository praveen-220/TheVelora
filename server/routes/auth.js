const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db');
const auth = require('../middleware/auth');
const { v4: uuidv4 } = require('uuid');
const { sendVerificationEmail } = require('../services/email');
const { sendVerificationSMS, formatPhoneNumber, hasSmsConfig } = require('../services/sms');


function createNotification(userId, type, title, message, data = null) {
  try {
    db.prepare(`INSERT INTO notifications (user_id, type, title, message, data) VALUES (?, ?, ?, ?, ?)`)
      .run(userId, type, title, message, data ? JSON.stringify(data) : null);
  } catch (e) { /* silent */ }
}

// POST /api/auth/register
router.post('/register', (req, res) => {
  const { name, email, password, role, phone, vehicle_info, car_model, car_age, license_plate } = req.body;

  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Name, email, and password are required' });
  }
  if (!['passenger', 'driver'].includes(role)) {
    return res.status(400).json({ error: 'Role must be passenger or driver' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }

  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase().trim());
  if (existing) {
    return res.status(409).json({ error: 'Email already registered' });
  }

  const cleanPhone = phone ? formatPhoneNumber(phone) : null;
  const hash = bcrypt.hashSync(password, 10);
  const emailToken = uuidv4();
  const phoneOtp = Math.floor(100000 + Math.random() * 900000).toString();
  // OTP valid for 15 minutes
  const otpExpiresAt = new Date(Date.now() + 15 * 60000).toISOString();

  try {
    const stmt = db.prepare(`
      INSERT INTO users (name, email, password_hash, role, phone, vehicle_info, car_model, car_age, license_plate, email_token, phone_otp, otp_expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(name.trim(), email.toLowerCase().trim(), hash, role, cleanPhone, vehicle_info || null, car_model || null, car_age || null, license_plate || null, emailToken, phoneOtp, otpExpiresAt);
    const userId = result.lastInsertRowid;

    createNotification(userId, 'WELCOME', 'Welcome to Velora!', `Hi ${name}, verify your account to start your journey!`);

    // Send verifications
    sendVerificationEmail(email.toLowerCase().trim(), emailToken);
    if (cleanPhone) {
      sendVerificationSMS(cleanPhone, phoneOtp);
    }

    const responsePayload = {
      message: 'Registration successful. Please verify your phone number.',
      userId,
      email: email.toLowerCase().trim(),
      phone: cleanPhone
    };

    if (!hasSmsConfig()) {
      responsePayload.devOtp = phoneOtp;
    }

    res.status(201).json(responsePayload);
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// POST /api/auth/verify-phone
router.post('/verify-phone', (req, res) => {
  const { email, phone, otp } = req.body;
  if ((!email && !phone) || !otp) {
    return res.status(400).json({ error: 'Email or phone and 6-digit OTP are required' });
  }

  const cleanOtp = String(otp).trim();
  let user;
  if (email) {
    user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase().trim());
  } else if (phone) {
    const cleanP = formatPhoneNumber(phone);
    user = db.prepare('SELECT * FROM users WHERE phone = ? OR phone LIKE ?').get(cleanP, `%${phone.replace(/\D/g,'').slice(-10)}`);
  }

  if (!user) return res.status(404).json({ error: 'Account not found' });
  if (user.is_phone_verified) return res.status(400).json({ error: 'Phone number is already verified' });
  
  if (user.phone_otp !== cleanOtp) {
    return res.status(400).json({ error: 'Invalid verification code. Please check and try again.' });
  }
  if (new Date() > new Date(user.otp_expires_at)) {
    return res.status(400).json({ error: 'Verification code has expired. Please click Resend Code.' });
  }

  db.prepare('UPDATE users SET is_phone_verified = 1, phone_otp = NULL, otp_expires_at = NULL WHERE id = ?').run(user.id);

  const token = jwt.sign(
    { id: user.id, email: user.email, role: user.role, name: user.name },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN }
  );

  const updatedUser = db.prepare('SELECT id, name, email, role, phone, is_email_verified, is_phone_verified, avatar_url FROM users WHERE id = ?').get(user.id);
  res.json({ message: 'Phone verified successfully', token, user: updatedUser });
});

// GET /api/auth/verify-email
router.get('/verify-email', (req, res) => {
  const { email, token } = req.query;
  if (!email || !token) return res.status(400).json({ error: 'Missing parameters' });

  const user = db.prepare('SELECT * FROM users WHERE email = ? AND email_token = ?').get(email.toLowerCase().trim(), token);
  if (!user) return res.status(400).json({ error: 'Invalid or expired email token' });

  db.prepare('UPDATE users SET is_email_verified = 1, email_token = NULL WHERE id = ?').run(user.id);
  res.json({ message: 'Email verified successfully! You can now log in.' });
});

// POST /api/auth/resend-otp
router.post('/resend-otp', (req, res) => {
  const { email, phone } = req.body;
  if (!email && !phone) return res.status(400).json({ error: 'Email or phone required' });

  let user;
  if (email) {
    user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase().trim());
  } else if (phone) {
    const cleanP = formatPhoneNumber(phone);
    user = db.prepare('SELECT * FROM users WHERE phone = ? OR phone LIKE ?').get(cleanP, `%${phone.replace(/\D/g,'').slice(-10)}`);
  }

  if (!user) return res.status(404).json({ error: 'User not found' });
  if (user.is_phone_verified) return res.status(400).json({ error: 'Phone number already verified' });

  const phoneOtp = Math.floor(100000 + Math.random() * 900000).toString();
  const otpExpiresAt = new Date(Date.now() + 15 * 60000).toISOString();
  db.prepare('UPDATE users SET phone_otp = ?, otp_expires_at = ? WHERE id = ?').run(phoneOtp, otpExpiresAt, user.id);
  
  if (user.phone) sendVerificationSMS(user.phone, phoneOtp);
  
  const payload = { message: 'New OTP sent to your phone' };
  if (!hasSmsConfig()) payload.devOtp = phoneOtp;
  res.json(payload);
});


// POST /api/auth/login
router.post('/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase().trim());
  if (!user) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }
  if (user.is_suspended) {
    return res.status(403).json({ error: 'Your account has been suspended. Contact support.' });
  }
  
  // Check if verified
  if (!user.is_phone_verified && user.role !== 'admin') {
    const phoneOtp = Math.floor(100000 + Math.random() * 900000).toString();
    const otpExpiresAt = new Date(Date.now() + 15 * 60000).toISOString();
    db.prepare('UPDATE users SET phone_otp = ?, otp_expires_at = ? WHERE id = ?').run(phoneOtp, otpExpiresAt, user.id);
    if (user.phone) sendVerificationSMS(user.phone, phoneOtp);
    const errPayload = { error: 'Phone number not verified. A new OTP has been sent.', requiresVerification: true, email: user.email };
    if (!hasSmsConfig()) errPayload.devOtp = phoneOtp;
    return res.status(403).json(errPayload);
  }

  const valid = bcrypt.compareSync(password, user.password_hash);
  if (!valid) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  const token = jwt.sign(
    { id: user.id, email: user.email, role: user.role, name: user.name },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN }
  );

  const { password_hash, ...safeUser } = user;
  res.json({ token, user: safeUser });
});

// GET /api/auth/me
router.get('/me', auth, (req, res) => {
  const user = db.prepare('SELECT id, name, email, role, phone, avatar_url, vehicle_info, car_model, car_age, license_plate, bio, rating_avg, rating_count, total_rides, is_suspended, created_at FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json(user);
});

// PUT /api/auth/profile
router.put('/profile', auth, (req, res) => {
  const { name, phone, bio, vehicle_info, car_model, car_age, license_plate } = req.body;
  db.prepare(`UPDATE users SET name = COALESCE(?, name), phone = COALESCE(?, phone), bio = COALESCE(?, bio),
    vehicle_info = COALESCE(?, vehicle_info), car_model = COALESCE(?, car_model), car_age = COALESCE(?, car_age), license_plate = COALESCE(?, license_plate) WHERE id = ?`)
    .run(name || null, phone || null, bio || null, vehicle_info || null, car_model || null, car_age || null, license_plate || null, req.user.id);

  const user = db.prepare('SELECT id, name, email, role, phone, bio, vehicle_info, car_model, car_age, license_plate, rating_avg, rating_count FROM users WHERE id = ?').get(req.user.id);
  res.json(user);
});

// PUT /api/auth/password
router.put('/password', auth, (req, res) => {
  const { current_password, new_password } = req.body;
  if (!current_password || !new_password) {
    return res.status(400).json({ error: 'Both current and new password required' });
  }
  if (new_password.length < 6) {
    return res.status(400).json({ error: 'New password must be at least 6 characters' });
  }

  const user = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
  if (!bcrypt.compareSync(current_password, user.password_hash)) {
    return res.status(400).json({ error: 'Current password is incorrect' });
  }

  const newHash = bcrypt.hashSync(new_password, 10);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(newHash, req.user.id);
  res.json({ message: 'Password updated successfully' });
});

module.exports = router;
