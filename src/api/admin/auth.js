const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const db = require('../../db');

// POST /api/admin/auth/login
router.post('/login', async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ success: false, message: 'Username and password are required.' });
    }

    try {
        const [rows] = await db.execute('SELECT * FROM admin_users WHERE username = ?', [username]);

        if (rows.length === 0) {
            return res.status(401).json({ success: false, message: 'Invalid username or password.' });
        }

        const admin = rows[0];
        const match = await bcrypt.compare(password, admin.password_hash);

        if (!match) {
            return res.status(401).json({ success: false, message: 'Invalid username or password.' });
        }

        // Establish session
        req.session.adminUser = {
            id: admin.id,
            username: admin.username
        };

        res.json({ success: true, message: 'Login successful' });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
});

// POST /api/admin/auth/logout
router.post('/logout', (req, res) => {
    if (req.session) {
        req.session.destroy((err) => {
            if (err) {
                console.error('Logout error:', err);
                return res.status(500).json({ success: false, message: 'Could not log out' });
            }
            res.json({ success: true, message: 'Logout successful' });
        });
    } else {
        res.json({ success: true, message: 'Logout successful' });
    }
});

// GET /api/admin/auth/me
router.get('/me', (req, res) => {
    if (req.session && req.session.adminUser) {
        res.json({ success: true, admin: req.session.adminUser });
    } else {
        res.status(401).json({ success: false, message: 'Not authenticated' });
    }
});

module.exports = router;
