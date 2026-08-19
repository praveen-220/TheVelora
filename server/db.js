const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');

const dataDir = path.join(__dirname, '../data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, 'velora.db'));

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'passenger',
    phone TEXT,
    avatar_url TEXT,
    vehicle_info TEXT,
    car_model TEXT,
    car_age INTEGER,
    license_plate TEXT,
    bio TEXT,
    rating_avg REAL DEFAULT 0,
    rating_count INTEGER DEFAULT 0,
    total_rides INTEGER DEFAULT 0,
    is_suspended INTEGER DEFAULT 0,
    is_email_verified INTEGER DEFAULT 0,
    is_phone_verified INTEGER DEFAULT 0,
    email_token TEXT,
    phone_otp TEXT,
    otp_expires_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS rides (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    driver_id INTEGER NOT NULL,
    origin TEXT NOT NULL,
    destination TEXT NOT NULL,
    origin_lat REAL DEFAULT 28.6139,
    origin_lng REAL DEFAULT 77.2090,
    dest_lat REAL DEFAULT 28.5355,
    dest_lng REAL DEFAULT 77.3910,
    departure_time DATETIME NOT NULL,
    seats_total INTEGER NOT NULL,
    seats_available INTEGER NOT NULL,
    price_per_seat REAL NOT NULL,
    status TEXT DEFAULT 'SCHEDULED',
    current_lat REAL,
    current_lng REAL,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (driver_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS bookings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ride_id INTEGER NOT NULL,
    passenger_id INTEGER NOT NULL,
    seats_booked INTEGER NOT NULL DEFAULT 1,
    total_fare REAL NOT NULL,
    split_fare REAL,
    split_count INTEGER DEFAULT 1,
    status TEXT DEFAULT 'PENDING',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (ride_id) REFERENCES rides(id),
    FOREIGN KEY (passenger_id) REFERENCES users(id),
    UNIQUE(ride_id, passenger_id)
  );

  CREATE TABLE IF NOT EXISTS ratings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ride_id INTEGER NOT NULL,
    rater_id INTEGER NOT NULL,
    ratee_id INTEGER NOT NULL,
    score INTEGER NOT NULL CHECK(score BETWEEN 1 AND 5),
    comment TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (ride_id) REFERENCES rides(id),
    FOREIGN KEY (rater_id) REFERENCES users(id),
    FOREIGN KEY (ratee_id) REFERENCES users(id),
    UNIQUE(ride_id, rater_id, ratee_id)
  );

  CREATE TABLE IF NOT EXISTS sos_alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    ride_id INTEGER,
    lat REAL,
    lng REAL,
    message TEXT DEFAULT 'SOS Emergency Alert',
    status TEXT DEFAULT 'ACTIVE',
    resolved_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    data TEXT,
    is_read INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS pricing_configs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    car_model TEXT NOT NULL,
    max_age INTEGER NOT NULL,
    price_per_km REAL NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Seed default pricing config if empty
const configCount = db.prepare('SELECT COUNT(*) as c FROM pricing_configs').get().c;
if (configCount === 0) {
  db.prepare(`INSERT INTO pricing_configs (car_model, max_age, price_per_km) VALUES (?, ?, ?)`).run('Default', 99, 15);
}

// Seed multiple users and drivers
const users = [
  { name: 'Velora Admin', email: 'velora2@org.in', pass: 'Velora02@600', role: 'admin', phone: '+91-9000000000', vehicle: null, model: null, age: null, license: null, avg: 0, count: 0 }
];

// Add columns if table already exists (SQLite migration)
try { db.exec("ALTER TABLE users ADD COLUMN is_email_verified INTEGER DEFAULT 0;"); } catch(e) {}
try { db.exec("ALTER TABLE users ADD COLUMN is_phone_verified INTEGER DEFAULT 0;"); } catch(e) {}
try { db.exec("ALTER TABLE users ADD COLUMN email_token TEXT;"); } catch(e) {}
try { db.exec("ALTER TABLE users ADD COLUMN phone_otp TEXT;"); } catch(e) {}
try { db.exec("ALTER TABLE users ADD COLUMN otp_expires_at DATETIME;"); } catch(e) {}

const insertUser = db.prepare(`INSERT INTO users (name, email, password_hash, role, phone, vehicle_info, car_model, car_age, license_plate, rating_avg, rating_count, is_email_verified, is_phone_verified) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
let adminSeeded = false;

for (const u of users) {
  const exists = db.prepare('SELECT id FROM users WHERE email = ?').get(u.email);
  if (!exists) {
    const hash = bcrypt.hashSync(u.pass, 10);
    const isVerified = u.role === 'admin' ? 1 : 0;
    insertUser.run(u.name, u.email, hash, u.role, u.phone, u.vehicle, u.model, u.age, u.license, u.avg, u.count, isVerified, isVerified);
    if (!adminSeeded) adminSeeded = true;
  }
}
if (adminSeeded) console.log('✅ Multiple real-world users and drivers seeded');

// Demo rides have been removed to avoid fake data

module.exports = db;
