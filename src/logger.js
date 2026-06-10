const db = require('./db');
const dayjs = require('dayjs'); // Wait, let's just use native Date if we don't install dayjs.
// Or we can install dayjs or just write a simple formatter. Let's write a simple formatter.

/**
 * Format date to <dd>-<mm>-<yyyy> <HH>:<MM>
 * @param {Date} date 
 * @returns {string} Formatted date string
 */
function formatDate(date) {
    const pad = (num) => String(num).padStart(2, '0');
    const dd = pad(date.getDate());
    const mm = pad(date.getMonth() + 1);
    const yyyy = date.getFullYear();
    const HH = pad(date.getHours());
    const MM = pad(date.getMinutes());
    return `${dd}-${mm}-${yyyy} ${HH}:${MM}`;
}

/**
 * Log an activity to the activity_logs table
 * @param {string} action - The action type (e.g., REQ_MISS_DATA)
 * @param {string} values - The delimited string of values
 */
async function logActivity(action, values) {
    try {
        const datetimeStr = formatDate(new Date());
        const query = `INSERT INTO activity_logs (log_action, log_datetime, log_values) VALUES (?, ?, ?)`;
        await db.execute(query, [action, datetimeStr, values]);
        console.log(`[Log] ${action} - ${datetimeStr} - ${values}`);
    } catch (error) {
        console.error('❌ Failed to log activity:', error.message);
    }
}

module.exports = {
    logActivity,
    formatDate
};
