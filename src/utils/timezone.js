/**
 * Helper utilities for handling Asia/Bangkok (UTC+7) time.
 */

/**
 * Returns a new Date object representing the time in Bangkok, adjusted so that
 * its UTC components correspond to Bangkok's local time components.
 * This is useful for utilizing UTC methods (e.g. getUTCDate(), toISOString().slice(0, 10))
 * to get local Bangkok date and time components.
 * 
 * @param {Date|string|number} dateInput - Optional input date
 * @returns {Date} BKK adjusted date object
 */
function getBKKDate(dateInput) {
    const date = dateInput ? new Date(dateInput) : new Date();
    if (isNaN(date.getTime())) {
        return new Date();
    }
    // Bangkok is always UTC+7
    const bkkOffset = 7 * 60 * 60 * 1000;
    return new Date(date.getTime() + bkkOffset);
}

/**
 * Formats a date into a standard Bangkok datetime string: "dd-mm-yyyy HH:MM"
 * @param {Date|string|number} dateInput 
 * @returns {string} Formatted string
 */
function formatBKKDateTime(dateInput) {
    const date = dateInput ? new Date(dateInput) : new Date();
    if (isNaN(date.getTime())) return '';

    const options = {
        timeZone: 'Asia/Bangkok',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
    };
    const formatter = new Intl.DateTimeFormat('en-GB', options);
    const parts = formatter.formatToParts(date);
    const dd = parts.find(p => p.type === 'day').value;
    const mm = parts.find(p => p.type === 'month').value;
    const yyyy = parts.find(p => p.type === 'year').value;
    let HH = parts.find(p => p.type === 'hour').value;
    if (HH === '24') HH = '00';
    const MM = parts.find(p => p.type === 'minute').value;
    
    return `${dd}-${mm}-${yyyy} ${HH}:${MM}`;
}

/**
 * Formats a date into standard ISO-like date string in Bangkok timezone: "YYYY-MM-DD"
 * @param {Date|string|number} dateInput 
 * @returns {string} Formatted date string
 */
function formatBKKDateISO(dateInput) {
    const bkkDate = getBKKDate(dateInput);
    const yyyy = bkkDate.getUTCFullYear();
    const mm = String(bkkDate.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(bkkDate.getUTCDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}

module.exports = {
    getBKKDate,
    formatBKKDateTime,
    formatBKKDateISO
};
