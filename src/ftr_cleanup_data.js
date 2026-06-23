/**
 * FTR Data Cleanup Program (ftr_cleanup_data)
 * Designed to be executed as a standalone cron job script (e.g. nightly).
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const db = require('./db');
const { logActivity } = require('./logger');
const config = require('./config');
const { getBKKDate } = require('./utils/timezone');

// Helper to count PDF files in a directory recursively before deleting
function countPdfsInDir(dir) {
    if (!fs.existsSync(dir)) return 0;
    try {
        const stat = fs.statSync(dir);
        if (!stat.isDirectory()) return 0;
        
        let count = 0;
        const entries = fs.readdirSync(dir);
        for (const entry of entries) {
            const fullPath = path.join(dir, entry);
            const entryStat = fs.statSync(fullPath);
            if (entryStat.isDirectory()) {
                count += countPdfsInDir(fullPath);
            } else if (entryStat.isFile() && entry.endsWith('.pdf')) {
                count++;
            }
        }
        return count;
    } catch (err) {
        console.error(`Error counting PDFs in ${dir}:`, err.message);
        return 0;
    }
}

async function runCleanup(shouldEndPool = true) {
    console.log('⏰ Starting FTR Cleanup Data Job...');

    // Load settings from config, falling back to defaults if not specified
    const cleanupConfig = config.CLEANUP_SETTINGS || {
        PDF_MAX_DAYS: 180,
        INVOICE_MAX_DAYS: 180,
        LOG_MAX_DAYS: 60,
        TEMP_FILES_MAX_DAYS: 1
    };

    const pdfMaxDays = cleanupConfig.PDF_MAX_DAYS;
    const invoiceMaxDays = cleanupConfig.INVOICE_MAX_DAYS;
    const logMaxDays = cleanupConfig.LOG_MAX_DAYS;
    const tempFilesMaxDays = cleanupConfig.TEMP_FILES_MAX_DAYS;

    console.log(`Configured thresholds:
- PDF Max Days: ${pdfMaxDays}
- Invoice Max Days: ${invoiceMaxDays}
- Log Max Days: ${logMaxDays}
- Temp Files Max Days: ${tempFilesMaxDays}`);

    let deletedPdfsCount = 0;
    let deletedInvoicesCount = 0;
    let deletedLogsCount = 0;
    let deletedTempDirsCount = 0;

    const now = getBKKDate();
    const todayMidnight = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

    try {
        // 1. Delete PDF directories (folders) older than 180 days based on their YYYYMM/DD names
        const pdfsBaseDir = path.join(__dirname, '../storage/pdfs');
        if (fs.existsSync(pdfsBaseDir)) {
            const yyyymmRegex = /^\d{6}$/;
            const ddRegex = /^\d{2}$/;

            const yyyymmEntries = fs.readdirSync(pdfsBaseDir);
            for (const yyyymm of yyyymmEntries) {
                const fullYmPath = path.join(pdfsBaseDir, yyyymm);
                if (yyyymmRegex.test(yyyymm) && fs.statSync(fullYmPath).isDirectory()) {
                    const ddEntries = fs.readdirSync(fullYmPath);
                    for (const dd of ddEntries) {
                        const fullDdPath = path.join(fullYmPath, dd);
                        if (ddRegex.test(dd) && fs.statSync(fullDdPath).isDirectory()) {
                            // Parse folder name into Date object
                            const year = parseInt(yyyymm.substring(0, 4));
                            const month = parseInt(yyyymm.substring(4, 6)) - 1; // JS months are 0-indexed
                            const day = parseInt(dd);
                            
                            const folderMidnight = new Date(Date.UTC(year, month, day));
                            const diffTime = todayMidnight - folderMidnight;
                            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

                            if (diffDays > pdfMaxDays) {
                                const pdfCount = countPdfsInDir(fullDdPath);
                                try {
                                    fs.rmSync(fullDdPath, { recursive: true, force: true });
                                    deletedPdfsCount += pdfCount;
                                    console.log(`Deleted old PDF directory: ${fullDdPath} (contained ${pdfCount} PDFs, age: ${diffDays} days)`);
                                } catch (err) {
                                    console.error(`Error deleting PDF directory ${fullDdPath}:`, err.message);
                                }
                            }
                        }
                    }

                    // Remove YYYYMM directory if it becomes empty
                    const remainingDdEntries = fs.readdirSync(fullYmPath);
                    if (remainingDdEntries.length === 0) {
                        try {
                            fs.rmdirSync(fullYmPath);
                            console.log(`Removed empty YYYYMM directory: ${fullYmPath}`);
                        } catch (err) {
                            console.error(`Error removing empty YYYYMM directory ${fullYmPath}:`, err.message);
                        }
                    }
                }
            }
        }

        // 2. Delete invoices older than 180 days from DB
        // (This will cascade delete invoices_rec and generated_documents rows due to FOREIGN KEY constraints)
        const [invoiceRes] = await db.execute(`
            DELETE FROM invoices 
            WHERE created_at < NOW() - INTERVAL ? DAY
        `, [invoiceMaxDays]);
        deletedInvoicesCount = invoiceRes.affectedRows;
        console.log(`Deleted ${deletedInvoicesCount} invoices from database (cascaded to items and documents).`);

        // 3. Delete activity logs older than 60 days from DB
        // (Using STR_TO_DATE since log_datetime is stored in format 'DD-MM-YYYY HH:MM')
        const [logRes] = await db.execute(`
            DELETE FROM activity_logs 
            WHERE STR_TO_DATE(log_datetime, '%d-%m-%Y %H:%i') < NOW() - INTERVAL ? DAY
        `, [logMaxDays]);
        deletedLogsCount = logRes.affectedRows;
        console.log(`Deleted ${deletedLogsCount} activity logs from database.`);

        // 4. Delete puppeteer temp files
        const tmpDir = os.tmpdir();
        if (fs.existsSync(tmpDir)) {
            const tempThresholdMs = tempFilesMaxDays * 24 * 60 * 60 * 1000;
            const tempEntries = fs.readdirSync(tmpDir);
            for (const entry of tempEntries) {
                if (entry.startsWith('puppeteer_profile_')) {
                    const fullPath = path.join(tmpDir, entry);
                    try {
                        const stat = fs.statSync(fullPath);
                        if (stat.isDirectory()) {
                            const nowMs = Date.now();
                            const ageMs = nowMs - stat.mtimeMs;
                            // Delete only if older than threshold to avoid breaking active Puppeteer runs
                            if (ageMs > tempThresholdMs) {
                                fs.rmSync(fullPath, { recursive: true, force: true });
                                deletedTempDirsCount++;
                                console.log(`Deleted puppeteer temp directory: ${fullPath}`);
                            }
                        }
                    } catch (err) {
                        console.error(`Error deleting temp directory ${fullPath}:`, err.message);
                    }
                }
            }
        }

        // 5. Log cleanup run to DB
        const logValues = `pdfs_deleted:${deletedPdfsCount},invoices_deleted:${deletedInvoicesCount},logs_deleted:${deletedLogsCount},temp_dirs_deleted:${deletedTempDirsCount}`;
        await logActivity('CRON_CLEANUP', logValues, 'cron');
        console.log(`✅ Cleanup job finished successfully. Logged: ${logValues}`);

    } catch (error) {
        console.error('❌ Error during cleanup process:', error.message);
    } finally {
        if (shouldEndPool) {
            try {
                await db.end();
                console.log('🔌 MySQL pool disconnected.');
            } catch (dbEndErr) {
                console.error('Error ending database pool:', dbEndErr.message);
            }
            process.exit(0);
        }
    }
}

// Only execute if run directly
if (require.main === module) {
    runCleanup(true);
}

module.exports = { runCleanup };
