/**
 * FTR Nightly PDF Generation Batch Cron Job (Phase 5 - Option A)
 * Designed to be executed as a standalone shell script triggered by aaPanel / system cron.
 */

const db = require('./db');
const fs = require('fs');
const { generatePdf, getBrowserInstance } = require('./services/pdfService');
const { logActivity } = require('./logger');

async function runCronBatch() {
    console.log('⏰ Starting FTR PDF pre-generation nightly batch job...');
    let successCount = 0;
    let failCount = 0;
    let browser = null;

    try {
        const batchLimit = parseInt(process.env.CRON_BATCH_LIMIT, 10) || 2000;

        // Find all complete customer tax profiles that still need their PDF invoice generated
        const selectQuery = `
            SELECT i.tax_rec_id 
            FROM invoices i
            JOIN customer_profile p ON i.customer_num = p.customer_num
            WHERE i.status IN ('pending', 'failed')
              AND p.customer_name IS NOT NULL 
              AND p.customer_addr IS NOT NULL 
              AND p.tax_id IS NOT NULL
            ORDER BY i.service_date ASC, i.created_at ASC
            LIMIT ?
        `;
        const [rows] = await db.query(selectQuery, [batchLimit]);

        console.log(`🔍 Found ${rows.length} pending completed invoices matching criteria.`);

        if (rows.length > 0) {
            browser = await getBrowserInstance();
        }

        let processedInBatch = 0;
        for (const row of rows) {
            // Recycle browser instance every 500 invoices to release V8/DOM memory completely
            if (processedInBatch > 0 && processedInBatch % 500 === 0) {
                console.log(`🔄 Recycling browser instance after ${processedInBatch} invoices to free memory...`);
                if (browser) {
                    const userDataDir = browser._userDataDir;
                    await browser.close().catch(() => {});
                    if (userDataDir && fs.existsSync(userDataDir)) {
                        try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch (e) {}
                    }
                }
                browser = await getBrowserInstance();
            }

            try {
                console.log(`📄 Generating PDF for tax record: ${row.tax_rec_id}...`);
                await generatePdf(row.tax_rec_id, browser);
                successCount++;
            } catch (pdfErr) {
                console.error(`❌ Failed to generate PDF for ${row.tax_rec_id}:`, pdfErr.message);
                // Set status to failed in DB
                await db.execute('UPDATE invoices SET status = ? WHERE tax_rec_id = ?', ['failed', row.tax_rec_id]);
                failCount++;
            }
            processedInBatch++;
        }

        // Always log results so admins know the cron runs successfully
        await logActivity('CRON_GEN_PDF', String(successCount), 'cron');

        console.log(`✅ Batch complete. Successfully generated: ${successCount}. Failed: ${failCount}.`);
    } catch (err) {
        console.error('❌ Critical error during cron batch process:', err.message);
    } finally {
        if (browser) {
            const userDataDir = browser._userDataDir;
            await browser.close().catch(() => {});
            if (userDataDir && fs.existsSync(userDataDir)) {
                try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch (e) {}
            }
        }

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
