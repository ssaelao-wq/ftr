const express = require('express');
const router = express.Router();
const db = require('../../db');
const { logActivity } = require('../../logger');

// GET /api/admin/customer-profiles/search
// Search customer profiles by tax_id, customer_num, or customer_name
router.get('/search', async (req, res) => {
    const { tax_id, customer_num, customer_name } = req.query;
    let sql = 'SELECT * FROM customer_profile WHERE 1=1';
    const params = [];

    if (tax_id) {
        sql += ' AND tax_id LIKE ?';
        params.push(`%${tax_id.trim()}%`);
    }
    if (customer_num) {
        sql += ' AND customer_num LIKE ?';
        params.push(`%${customer_num.trim()}%`);
    }
    if (customer_name) {
        sql += ' AND customer_name LIKE ?';
        params.push(`%${customer_name.trim()}%`);
    }

    sql += ' ORDER BY updated_at DESC, id DESC';

    try {
        const [rows] = await db.query(sql, params);
        res.json({ success: true, profiles: rows });
    } catch (error) {
        console.error('Customer profile search error:', error);
        res.status(500).json({ success: false, message: 'Internal server error during profile search.' });
    }
});

// GET /api/admin/customer-profiles/lookup
// Lookup all profiles/branches matching a specific tax_id for autocomplete popups
router.get('/lookup', async (req, res) => {
    const { tax_id } = req.query;
    
    if (!tax_id || !tax_id.trim()) {
        return res.status(400).json({ success: false, message: 'Tax ID is required for lookup.' });
    }

    try {
        const [rows] = await db.execute(
            'SELECT id, tax_id, customer_num, customer_name, customer_addr, customer_branch, customer_email, customer_phone FROM customer_profile WHERE tax_id = ? ORDER BY customer_branch = \'สำนักงานใหญ่\' DESC, customer_branch ASC',
            [tax_id.trim()]
        );
        res.json({ success: true, profiles: rows });
    } catch (error) {
        console.error('Customer profile lookup error:', error);
        res.status(500).json({ success: false, message: 'Internal server error during profile lookup.' });
    }
});

// PUT /api/admin/customer-profiles/:id
// Update a specific customer profile
router.put('/:id', async (req, res) => {
    const { id } = req.params;
    const { customer_name, customer_addr, customer_email, customer_phone, customer_branch } = req.body;
    const username = req.session.adminUser ? req.session.adminUser.username : 'system';

    if (!customer_name || !customer_addr) {
        return res.status(400).json({ success: false, message: 'Customer Name and Address are required.' });
    }

    try {
        // Validate record exists
        const [existing] = await db.execute('SELECT tax_id, customer_branch FROM customer_profile WHERE id = ?', [id]);
        if (existing.length === 0) {
            return res.status(404).json({ success: false, message: 'Customer profile not found.' });
        }

        const oldProfile = existing[0];

        // Check if updating the branch conflicts with another record of the same tax_id
        if (customer_branch && customer_branch !== oldProfile.customer_branch) {
            const [conflict] = await db.execute(
                'SELECT id FROM customer_profile WHERE tax_id = ? AND customer_branch = ? AND id != ?',
                [oldProfile.tax_id, customer_branch, id]
            );
            if (conflict.length > 0) {
                return res.status(400).json({ 
                    success: false, 
                    message: `A profile for Tax ID "${oldProfile.tax_id}" with branch "${customer_branch}" already exists.` 
                });
            }
        }

        // Update the profile
        await db.execute(`
            UPDATE customer_profile 
            SET customer_name = ?, customer_addr = ?, customer_email = ?, customer_phone = ?, customer_branch = ?
            WHERE id = ?
        `, [customer_name, customer_addr, customer_email || null, customer_phone || null, customer_branch || null, id]);

        await logActivity('EDIT_PROFILE', `${username}:${oldProfile.tax_id}:${customer_branch || ''}`);

        res.json({ success: true, message: 'Customer profile updated successfully.' });
    } catch (error) {
        console.error('Customer profile update error:', error);
        res.status(500).json({ success: false, message: 'Internal server error during profile update.' });
    }
});

module.exports = router;
