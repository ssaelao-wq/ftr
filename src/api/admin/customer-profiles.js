const express = require('express');
const router = express.Router();
const db = require('../../db');
const { logActivity } = require('../../logger');
const { formatBKKDateISO } = require('../../utils/timezone');

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
    let page = parseInt(req.query.page, 10) || 1;
    if (page < 1) page = 1;
    const limit = 50;
    const offset = (page - 1) * limit;

    try {
        const { sql, params } = buildProfileQuery(req.query);

        // Count total matching profiles
        const countSql = `SELECT COUNT(*) AS count FROM (${sql}) AS temp_count`;
        const [countRows] = await db.query(countSql, params);
        const totalProfiles = countRows[0].count;
        const totalPages = Math.ceil(totalProfiles / limit);

        const orderSql = `${sql} ORDER BY updated_at DESC, id DESC LIMIT ? OFFSET ?`;
        const [rows] = await db.query(orderSql, [...params, limit, offset]);

        res.json({
            success: true,
            profiles: rows,
            pagination: {
                currentPage: page,
                totalPages: totalPages || 1,
                totalProfiles: totalProfiles,
                limit: limit
            }
        });
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
            'SELECT id, tax_id, customer_num, customer_name, customer_addr, customer_branch, customer_email, customer_phone, is_accounting_exported FROM customer_profile WHERE tax_id = ? ORDER BY customer_branch = \'สำนักงานใหญ่\' DESC, customer_branch ASC, id DESC',
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
        const [existing] = await db.execute('SELECT tax_id, customer_num, customer_branch FROM customer_profile WHERE id = ?', [id]);
        if (existing.length === 0) {
            return res.status(404).json({ success: false, message: 'Customer profile not found.' });
        }

        const oldProfile = existing[0];
        const newBranch = customer_branch ? customer_branch.trim() : oldProfile.customer_branch;

        // Perform updates inside a transaction to ensure consistency
        const connection = await db.getConnection();
        let transactionStarted = false;
        try {
            await connection.beginTransaction();
            transactionStarted = true;

            // 1. Update the customer profile, setting is_accounting_exported = FALSE
            await connection.execute(`
                UPDATE customer_profile 
                SET customer_name = ?, customer_addr = ?, customer_email = ?, customer_phone = ?, customer_branch = ?, is_accounting_exported = FALSE
                WHERE id = ?
            `, [customer_name.trim(), customer_addr.trim(), customer_email ? customer_email.trim() : null, customer_phone ? customer_phone.trim() : null, newBranch, id]);

            // 2. Propagate updates to matching invoices via customer_num
            await connection.execute(`
                UPDATE invoices 
                SET customer_branch = ?, status = 'pending', is_accounting_exported = FALSE 
                WHERE customer_num = ?
            `, [newBranch, oldProfile.customer_num]);

            await connection.commit();
        } catch (txErr) {
            if (transactionStarted) {
                await connection.rollback().catch(() => {});
            }
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
        let transactionStarted = false;
        try {
            await connection.beginTransaction();
            transactionStarted = true;
            await connection.query(
                'UPDATE customer_profile SET is_accounting_exported = TRUE WHERE id IN (?)',
                [profileIds]
            );
            await connection.commit();
        } catch (txErr) {
            if (transactionStarted) {
                await connection.rollback().catch(() => {});
            }
            throw txErr;
        } finally {
            connection.release();
        }

        // Log download activity
        await logActivity('REQ_DOWNLOAD_CUSTOMER', `${username}:${rows.length}`, username);

        const filename = `customer_profile_export_${formatBKKDateISO().replace(/-/g,'')}_${Date.now()}.csv`;
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
        res.status(200).send(csvContent);

    } catch (error) {
        console.error('Customer profile export error:', error);
        res.status(500).json({ success: false, message: 'Internal server error during customer profile export.' });
    }
});

module.exports = router;
