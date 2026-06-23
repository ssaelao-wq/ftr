const db = require('./db');
const { formatBKKDateTime } = require('./utils/timezone');

/**
 * Format date to <dd>-<mm>-<yyyy> <HH>:<MM> in Bangkok time
 * @param {Date} date 
 * @returns {string} Formatted date string
 */
function formatDate(date) {
    return formatBKKDateTime(date);
}

/**
 * Log an activity to the activity_logs table
 * @param {string} action - The action type (e.g., REQ_MISS_DATA)
 * @param {string} values - The delimited string of values
 * @param {string|null} username - The username of the logged-in administrator (optional)
 */
async function logActivity(action, values, username = null) {
    try {
        const datetimeStr = formatDate(new Date());
        const query = `INSERT INTO activity_logs (log_action, log_datetime, username, log_values) VALUES (?, ?, ?, ?)`;
        await db.execute(query, [action, datetimeStr, username, values]);
        console.log(`[Log] ${action} - ${datetimeStr} - ${values} (User: ${username || 'none'})`);
    } catch (error) {
        console.error('❌ Failed to log activity:', error.message);
    }
}

module.exports = {
    logActivity,
    formatDate
};
