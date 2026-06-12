const express = require('express');
const router = express.Router();
const db = require('../../db');
const { logActivity } = require('../../logger');

// Helper to build profile query from filters
function buildProfileQuery(queryParams) {
    const { tax_id, customer_num, customer_name, is_accounting_exported } = queryParams;
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
    if (is_accounting_exported !== undefined && is_accounting_exported !== 'all') {
        const flag = is_accounting_exported === 'true' || is_accounting_exported === '1';
        sql += ' AND is_accounting_exported = ?';
        params.push(flag);
    }

    return { sql, params };
}

// GET /api/admin/customer-profiles/search
// Search customer profiles with filters
router.get('/search', async (req, res) => {
    try {
        const { sql, params } = buildProfileQuery(req.query);
        const orderSql = `${sql} ORDER BY updated_at DESC, id DESC`;
        const [rows] = await db.query(orderSql, params);
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
            'SELECT id, tax_id, customer_num, customer_name, customer_addr, customer_branch, customer_email, customer_phone, is_accounting_exported FROM customer_profile WHERE tax_id = ? ORDER BY customer_branch = \'สำนักงานใหญ่\' DESC, customer_branch ASC',
            [tax_id.trim()]
        );
        res.json({ success: true, profiles: rows });
    } catch (error) {
        console.error('Customer profile lookup error:', error);
        res.status(500).json({ success: false, message: 'Internal server error during profile lookup.' });
    }
});

// PUT /api/admin/customer-profiles/:id
// Update a specific customer profile and propagate changes to invoices
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
        const oldBranch = oldProfile.customer_branch;
        const newBranch = customer_branch ? customer_branch.trim() : null;

        // Check if updating the branch conflicts with another record of the same tax_id
        if (newBranch && newBranch !== oldBranch) {
            const [conflict] = await db.execute(
                'SELECT id FROM customer_profile WHERE tax_id = ? AND customer_branch = ? AND id != ?',
                [oldProfile.tax_id, newBranch, id]
            );
            if (conflict.length > 0) {
                return res.status(400).json({ 
                    success: false, 
                    message: `A profile for Tax ID "${oldProfile.tax_id}" with branch "${newBranch}" already exists.` 
                });
            }
        }

        // Perform updates inside a transaction to ensure consistency
        const connection = await db.getConnection();
        await connection.beginTransaction();
        try {
            // 1. Update the customer profile, setting is_accounting_exported = FALSE
            await connection.execute(`
                UPDATE customer_profile 
                SET customer_name = ?, customer_addr = ?, customer_email = ?, customer_phone = ?, customer_branch = ?, is_accounting_exported = FALSE
                WHERE id = ?
            `, [customer_name.trim(), customer_addr.trim(), customer_email ? customer_email.trim() : null, customer_phone ? customer_phone.trim() : null, newBranch, id]);

            // 2. Propagate updates to matching invoices (branch code change, resetting status = pending and is_accounting_exported = FALSE)
            if (newBranch !== oldBranch) {
                await connection.execute(`
                    UPDATE invoices 
                    SET customer_branch = ?, status = 'pending', is_accounting_exported = FALSE 
                    WHERE tax_id = ? AND customer_branch = ?
                `, [newBranch, oldProfile.tax_id, oldBranch]);
            } else {
                await connection.execute(`
                    UPDATE invoices 
                    SET status = 'pending', is_accounting_exported = FALSE 
                    WHERE tax_id = ? AND customer_branch = ?
                `, [oldProfile.tax_id, oldBranch]);
            }

            await connection.commit();
        } catch (txErr) {
            await connection.rollback();
            throw txErr;
        } finally {
            connection.release();
        }

        await logActivity('EDIT_PROFILE', `${username}:${oldProfile.tax_id}:${newBranch || ''}`, username);

        res.json({ success: true, message: 'Customer profile updated successfully and invoice links updated.' });
    } catch (error) {
        console.error('Customer profile update error:', error);
        res.status(500).json({ success: false, message: 'Internal server error during profile update.' });
    }
});

// POST /api/admin/customer-profiles/export
// Exports customer profiles matching search criteria as pipe-delimited CSV, resetting is_accounting_exported to TRUE
router.post('/export', async (req, res) => {
    const username = req.session.adminUser ? req.session.adminUser.username : 'system';

    try {
        const { sql, params } = buildProfileQuery(req.body);

        // Fetch matching rows
        const [rows] = await db.query(sql, params);

        if (rows.length === 0) {
            return res.status(400).json({ success: false, message: 'No customer profiles match the filter criteria for export.' });
        }

        // Format CSV content with | delimiter
        let csvContent = '\uFEFF'; // UTF-8 BOM
        csvContent += 'tax_id|customer_num|customer_name|customer_addr|customer_email|customer_phone|customer_branch\r\n';

        for (const row of rows) {
            const taxId = row.tax_id || '';
            const customerNum = row.customer_num || '';
            const customerName = (row.customer_name || '').replace(/[\r\n]+/g, ' ').replace(/\|/g, '\\|');
            const customerAddr = (row.customer_addr || '').replace(/[\r\n]+/g, ' ').replace(/\|/g, '\\|');
            const customerEmail = row.customer_email || '';
            const customerPhone = row.customer_phone || '';
            const customerBranch = (row.customer_branch || '').replace(/[\r\n]+/g, ' ').replace(/\|/g, '\\|');

            csvContent += `${taxId}|${customerNum}|${customerName}|${customerAddr}|${customerEmail}|${customerPhone}|${customerBranch}\r\n`;
        }

        // Update the database flags is_accounting_exported = TRUE in a transaction
        const profileIds = rows.map(r => r.id);
        const connection = await db.getConnection();
        await connection.beginTransaction();
        try {
            await connection.query(
                'UPDATE customer_profile SET is_accounting_exported = TRUE WHERE id IN (?)',
                [profileIds]
            );
            await connection.commit();
        } catch (txErr) {
            await connection.rollback();
            throw txErr;
        } finally {
            connection.release();
        }

        // Log download activity
        await logActivity('REQ_DOWNLOAD_CUSTOMER', `${username}:${rows.length}`, username);

        const filename = `customer_profile_export_${new Date().toISOString().slice(0,10).replace(/-/g,'')}_${Date.now()}.csv`;
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
        res.status(200).send(csvContent);

    } catch (error) {
        console.error('Customer profile export error:', error);
        res.status(500).json({ success: false, message: 'Internal server error during customer profile export.' });
    }
});

module.exports = router;
