const express = require('express');
const router = express.Router();
const db = require('../../db');

// GET /api/admin/logs
router.get('/', async (req, res) => {
    const action = req.query.action;
    const date_from = req.query.date_from; // YYYY-MM-DD
    const date_to = req.query.date_to;     // YYYY-MM-DD
    let page = parseInt(req.query.page, 10) || 1;
    if (page < 1) page = 1;
    if (page > 10) page = 10; // Cap at max 10 pages

    const limit = 50;
    const offset = (page - 1) * limit;

    try {
        let whereClause = 'WHERE 1=1';
        const params = [];

        if (action && action !== 'all') {
            whereClause += ' AND log_action = ?';
            params.push(action);
        }

        if (date_from) {
            // Convert log_datetime string "dd-mm-yyyy HH:MM" to MySQL DateTime format
            whereClause += " AND STR_TO_DATE(log_datetime, '%d-%m-%Y %H:%i') >= ?";
            params.push(`${date_from} 00:00:00`);
        }

        if (date_to) {
            whereClause += " AND STR_TO_DATE(log_datetime, '%d-%m-%Y %H:%i') <= ?";
            params.push(`${date_to} 23:59:59`);
        }

        // Count total matching logs, capped at 500
        const countQuery = `
            SELECT COUNT(*) AS count FROM (
                SELECT log_id 
                FROM activity_logs 
                ${whereClause} 
                ORDER BY log_id DESC 
                LIMIT 500
            ) AS capped_logs
        `;
        const [countRows] = await db.query(countQuery, params);
        const totalLogs = countRows[0].count;
        const totalPages = Math.ceil(totalLogs / limit);

        // Fetch paginated logs
        const selectQuery = `
            SELECT log_id, log_action, log_datetime, log_values, username 
            FROM activity_logs 
            ${whereClause} 
            ORDER BY log_id DESC 
            LIMIT ? OFFSET ?
        `;
        
        // Add limit and offset params. 
        // Note: db.query in mysql2 expects limit/offset to be integers if passed as placeholder parameters in prepared statements, 
        // or we can append them directly to the query string safely since we cast them to numbers.
        const [rows] = await db.query(selectQuery, [...params, limit, offset]);

        res.json({
            success: true,
            logs: rows,
            pagination: {
                currentPage: page,
                totalPages: totalPages || 1,
                totalLogs: totalLogs,
                limit: limit
            }
        });
    } catch (error) {
        console.error('Activity logs query error:', error);
        res.status(500).json({ success: false, message: 'Internal server error during activity log retrieval.' });
    }
});

// GET /api/admin/logs/actions
router.get('/actions', async (req, res) => {
    try {
        const [rows] = await db.query(
            'SELECT DISTINCT log_action FROM activity_logs ORDER BY log_action ASC'
        );
        const actions = rows.map(r => r.log_action).filter(Boolean);
        res.json({ success: true, actions });
    } catch (error) {
        console.error('Distinct actions query error:', error);
        res.status(500).json({ success: false, message: 'Internal server error during actions retrieval.' });
    }
});

// GET /api/admin/logs/export
// Exports last N activity logs in a pipe-delimited CSV format
router.get('/export', async (req, res) => {
    try {
        const limit = parseInt(process.env.EXPORT_LOGS_LIMIT, 10) || 200;

        const [rows] = await db.query(
            'SELECT log_id, log_action, log_datetime, log_values, username FROM activity_logs ORDER BY log_id DESC LIMIT ?',
            [limit]
        );

        // UTF-8 BOM to avoid corruption of Thai characters in Excel
        let csvContent = '\uFEFF';
        csvContent += 'log_id|log_action|log_datetime|log_values|username\r\n';

        for (const row of rows) {
            const logId = row.log_id;
            const logAction = row.log_action || '';
            const logDatetime = row.log_datetime || '';
            const logValues = row.log_values || '';
            const username = row.username || '';

            // Strip out newlines or pipes from content to maintain structural integrity
            const cleanValues = logValues.replace(/[\r\n]+/g, ' ').replace(/\|/g, '\\|');
            const cleanUsername = username.replace(/[\r\n]+/g, ' ').replace(/\|/g, '\\|');

            csvContent += `${logId}|${logAction}|${logDatetime}|${cleanValues}|${cleanUsername}\r\n`;
        }

        const filename = `activity_logs_export_${Date.now()}.csv`;
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
        res.status(200).send(csvContent);

    } catch (error) {
        console.error('Activity logs export error:', error);
        res.status(500).json({ success: false, message: 'Internal server error during activity log export.' });
    }
});

module.exports = router;
