const fs = require('fs');
const path = require('path');
const db = require('./db');
const config = require('./config');
const { formatBKKDateTime, formatBKKDateISO, getBKKDate } = require('./utils/timezone');

/**
 * Format date to <dd>-<mm>-<yyyy> <HH>:<MM> in Bangkok time
 * @param {Date} date 
 * @returns {string} Formatted date string
 */
function formatDate(date) {
    return formatBKKDateTime(date);
}

/**
 * Appends a log message asynchronously to the daily file: logs_YYYYMMDD.txt
 * @param {string} message 
 */
function writeDailyLog(message) {
    try {
        const logsDir = config.LOGS_DIR;
        if (!fs.existsSync(logsDir)) {
            fs.mkdirSync(logsDir, { recursive: true });
        }
        const todayStr = formatBKKDateISO(new Date()).replace(/-/g, '');
        const filename = `logs_${todayStr}.txt`;
        const filepath = path.join(logsDir, filename);

        fs.appendFile(filepath, message + '\n', 'utf8', (err) => {
            if (err) {
                console.error(`❌ Failed to write to daily log file ${filename}:`, err.message);
            }
        });
    } catch (err) {
        console.error('❌ Error setting up daily log write:', err.message);
    }
}

/**
 * Log an activity to the activity_logs table and daily log file
 * @param {string} action - The action type (e.g., REQ_MISS_DATA)
 * @param {string} values - The delimited string of values
 * @param {string|null} username - The username of the logged-in administrator (optional)
 */
async function logActivity(action, values, username = null) {
    try {
        const datetimeStr = formatDate(new Date());
        const query = `INSERT INTO activity_logs (log_action, log_datetime, username, log_values) VALUES (?, ?, ?, ?)`;
        await db.execute(query, [action, datetimeStr, username, values]);
        
        const logLine = `[Log] ${action} - ${datetimeStr} - ${values} (User: ${username || 'none'})`;
        console.log(logLine);
        writeDailyLog(logLine);
    } catch (error) {
        console.error('❌ Failed to log activity:', error.message);
    }
}

/**
 * Log a gate transaction to both console and the daily log file.
 * @param {string} type - 'gate-in' or 'gate-out'
 * @param {string} receiptNo 
 * @param {string} bookingNo 
 * @param {string} containerNo 
 */
function logGateTransaction(type, receiptNo, bookingNo, containerNo) {
    const now = new Date();
    const bkkDate = getBKKDate(now);
    const yyyy = bkkDate.getUTCFullYear();
    const mm = String(bkkDate.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(bkkDate.getUTCDate()).padStart(2, '0');
    const HH = String(bkkDate.getUTCHours()).padStart(2, '0');
    const MM = String(bkkDate.getUTCMinutes()).padStart(2, '0');
    const SS = String(bkkDate.getUTCSeconds()).padStart(2, '0');
    const timestampStr = `${yyyy}-${mm}-${dd} ${HH}:${MM}:${SS}`;

    const logLine = `${timestampStr}|${type}|${receiptNo || ''}|${bookingNo || ''}|${containerNo || ''}`;
    console.log(logLine);
    writeDailyLog(logLine);
}

module.exports = {
    logActivity,
    logGateTransaction,
    writeDailyLog,
    formatDate
};
