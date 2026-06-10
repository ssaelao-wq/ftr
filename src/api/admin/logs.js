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
            SELECT log_id, log_action, log_datetime, log_values 
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

module.exports = router;
