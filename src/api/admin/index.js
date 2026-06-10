const express = require('express');
const router = express.Router();

const authRouter = require('./auth');
const uploadRouter = require('./upload');
const customersRouter = require('./customers');
const customerProfilesRouter = require('./customer-profiles');
const logsRouter = require('./logs');
const { requireAuth } = require('../../middleware/authMiddleware');

// Public admin authentication endpoints
router.use('/auth', authRouter);

// Protected admin endpoints (require session)
router.use('/upload', requireAuth, uploadRouter);
router.use('/customers', requireAuth, customersRouter);
router.use('/customer-profiles', requireAuth, customerProfilesRouter);
router.use('/logs', requireAuth, logsRouter);

module.exports = router;
