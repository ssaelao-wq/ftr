/**
 * Helper utility to generate a unique 6-digit temporary customer number (TMP-xxxxxx).
 */

/**
 * Generates a unique 6-digit temporary customer number (TMP-xxxxxx)
 * by finding the maximum existing numeric suffix in the database
 * and incrementing it.
 * 
 * @param {object} connectionOrDb - MySQL connection or db pool
 * @returns {Promise<string>} The unique temporary customer number, e.g. "TMP-000040"
 */
async function generateUniqueTmpCustomerNum(connectionOrDb) {
    let attempts = 0;
    while (attempts < 10) {
        // Query to find the highest TMP-xxxxxx customer number
        // This utilizes the unique index on customer_num for a fast reverse index scan
        const [rows] = await connectionOrDb.execute(
            `SELECT customer_num 
             FROM customer_profile 
             WHERE customer_num LIKE 'TMP-%' 
               AND LENGTH(customer_num) = 10 
               AND customer_num REGEXP '^TMP-[0-9]{6}$'
             ORDER BY customer_num DESC 
             LIMIT 1`
        );
        
        let nextNum = 1;
        if (rows.length > 0) {
            const lastNumStr = rows[0].customer_num.substring(4); // e.g. "000039"
            const lastNum = parseInt(lastNumStr, 10);
            if (!isNaN(lastNum)) {
                nextNum = lastNum + 1;
            }
        }
        
        if (nextNum > 999999) {
            throw new Error('Maximum limit of 6-digit temporary customer numbers (999,999) has been reached.');
        }
        
        const formattedNum = `TMP-${String(nextNum).padStart(6, '0')}`;
        
        // Double-check for existence to avoid concurrency duplicate key errors
        const [check] = await connectionOrDb.execute(
            'SELECT 1 FROM customer_profile WHERE customer_num = ?',
            [formattedNum]
        );
        
        if (check.length === 0) {
            return formattedNum;
        }
        
        attempts++;
    }
    throw new Error('Failed to generate a unique temporary customer number after 10 attempts.');
}

module.exports = {
    generateUniqueTmpCustomerNum
};
