/**
 * Authentication Middleware to restrict access to Admin endpoints
 */
function requireAuth(req, res, next) {
    if (req.session && req.session.adminUser) {
        return next();
    }

    // Determine response format based on path
    if (req.path.startsWith('/api') || req.originalUrl.startsWith('/api')) {
        return res.status(401).json({ success: false, message: 'Unauthorized. Please login to access.' });
    } else {
        return res.redirect('/admin/login.html');
    }
}

module.exports = {
    requireAuth
};
