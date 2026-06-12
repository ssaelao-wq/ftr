// src/index.js: Session middleware integration, admin API mounting, and static admin route protection.

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const session = require('express-session');

// Import utilities
const db = require('./db');
const { logActivity } = require('./logger');

const app = express();

// Trust the first proxy (required for ngrok/reverse-proxy HTTPS detection)
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Express Session configuration
// NOTE: 'trust proxy' must be set above for 'secure: auto' to work correctly behind ngrok.
// 'sameSite: lax' is required for mobile browsers — 'strict' blocks cookies on top-level
// cross-site navigations (e.g., opening an ngrok URL from a mobile browser or tapping a link),
// causing a redirect loop that hangs the browser. 'lax' still protects against CSRF.
app.use(session({
    secret: process.env.SESSION_SECRET || 'ftr_secure_admin_session_key_2026',
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        secure: 'auto', // Auto-detect: true on HTTPS (ngrok), false on HTTP (localhost)
        sameSite: 'lax',  // 'strict' breaks mobile browsers via ngrok due to cross-site redirect
        maxAge: 4 * 60 * 60 * 1000 // 4 hours session lifetime
    }
}));

// Protect static admin pages
app.use('/admin', (req, res, next) => {
    // Exclude login.html, CSS, and JS from authentication redirection
    if (req.path === '/login.html' || req.path.endsWith('.css') || req.path.endsWith('.js') || req.path.endsWith('.png') || req.path.endsWith('.jpg')) {
        return next();
    }
    const { requireAuth } = require('./middleware/authMiddleware');
    requireAuth(req, res, next);
});

// Serve static files (LIFF apps & Admin UI)
app.use(express.static(path.join(__dirname, '../public')));
app.use('/storage', express.static(path.join(__dirname, '../storage')));

// Routes
const customerRouter = require('./api/customer');
const adminRouter = require('./api/admin');

app.use('/api/customer', customerRouter);
app.use('/api/admin', adminRouter);

// Basic Health Check Route
app.get('/api/health', (req, res) => {
    res.status(200).json({ status: 'ok', message: 'FTR System API is running.' });
});

// Fallback routing: Explicitly serve index.html for any root requests
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Server Initialization
app.listen(PORT, () => {
    console.log(`🚀 Server is running on port ${PORT}`);
});