/**
 * FTR Nightly PDF Generation Batch Cron Job (Phase 5 - Option A)
 * Designed to be executed as a standalone shell script triggered by aaPanel / system cron.
 */

const db = require('./db');
const { generatePdf } = require('./services/pdfService');
const { logActivity } = require('./logger');

async function runCronBatch() {
    console.log('⏰ Starting FTR PDF pre-generation nightly batch job...');
    let successCount = 0;
    let failCount = 0;

    try {
        // Find all complete customer tax profiles that still need their PDF invoice generated
        const selectQuery = `
            SELECT i.tax_rec_id 
            FROM invoices i
            JOIN customer_profile p ON i.tax_id = p.tax_id AND i.customer_branch = p.customer_branch
            WHERE i.status = 'pending' 
              AND p.customer_name IS NOT NULL 
              AND p.customer_addr IS NOT NULL 
              AND i.tax_id IS NOT NULL
        `;
        const [rows] = await db.query(selectQuery);

        console.log(`🔍 Found ${rows.length} pending completed invoices matching criteria.`);

        for (const row of rows) {
            try {
                console.log(`📄 Generating PDF for tax record: ${row.tax_rec_id}...`);
                await generatePdf(row.tax_rec_id);
                successCount++;
            } catch (pdfErr) {
                console.error(`❌ Failed to generate PDF for ${row.tax_rec_id}:`, pdfErr.message);
                // Set status to failed in DB
                await db.execute('UPDATE invoices SET status = ? WHERE tax_rec_id = ?', ['failed', row.tax_rec_id]);
                failCount++;
            }
        }

        // Log results if any items were processed
        if (successCount > 0) {
            await logActivity('CRON_GEN_PDF', String(successCount));
        }

        console.log(`✅ Batch complete. Successfully generated: ${successCount}. Failed: ${failCount}.`);
    } catch (err) {
        console.error('❌ Critical error during cron batch process:', err.message);
    } finally {
        // Crucial step: End connection pool to allow Node process to terminate immediately
        try {
            await db.end();
            console.log('🔌 MySQL pool disconnected.');
        } catch (dbEndErr) {
            console.error('Error ending database pool:', dbEndErr.message);
        }
        process.exit(0);
    }
}

// Execute batch run
runCronBatch();
