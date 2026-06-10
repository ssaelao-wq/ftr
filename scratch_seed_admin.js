const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');
require('dotenv').config();

async function seedAdmin() {
  try {
    const connection = await mysql.createConnection({
      host: process.env.DB_HOST,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      port: process.env.DB_PORT
    });

    const username = 'admin';
    const password = 'password123'; // Default password
    const hashedPassword = await bcrypt.hash(password, 10);

    const [result] = await connection.execute(
      'INSERT INTO admin_users (username, password_hash) VALUES (?, ?) ON DUPLICATE KEY UPDATE password_hash = ?',
      [username, hashedPassword, hashedPassword]
    );

    console.log(`Admin user '${username}' seeded successfully with password '${password}'.`);
    await connection.end();
  } catch (err) {
    console.error('Error seeding admin user:', err);
  }
}

seedAdmin();
