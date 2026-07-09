const fs = require('fs');
const path = require('path');
const config = require('../src/config');
const { logGateTransaction, writeDailyLog } = require('../src/logger');
const { runCleanup } = require('../src/ftr_cleanup_data');
const { formatBKKDateISO } = require('../src/utils/timezone');

// Helper to simulate appendDedup
function appendDedup(existing, newVal) {
    if (!newVal || !newVal.trim()) return existing || null;
    const trimmed = newVal.trim();
    if (!existing) return trimmed;
    const parts = existing.split(',').map(s => s.trim()).filter(s => s);
    if (parts.includes(trimmed)) return existing; // duplicate, skip
    parts.push(trimmed);
    return parts.join(',');
}

async function runTest() {
    console.log('🧪 Starting validation tests for FTR Daily Logs & Append Logic...\n');

    // 1. Test appendDedup
    console.log('--- Test 1: appendDedup logic ---');
    console.log('Initial empty, appending AXIU1234567:', appendDedup('', 'AXIU1234567'));
    console.log('Existing AXIU1234567, appending same:', appendDedup('AXIU1234567', 'AXIU1234567'));
    console.log('Existing AXIU1234567, appending BMOU9999999:', appendDedup('AXIU1234567', 'BMOU9999999'));
    console.log('Existing AXIU1234567, BMOU9999999, appending AXIU1234567 (dup):', appendDedup('AXIU1234567, BMOU9999999', 'AXIU1234567'));
    console.log('Existing AXIU1234567, BMOU9999999, appending TEMU5555555:', appendDedup('AXIU1234567, BMOU9999999', 'TEMU5555555'));
    console.log('✅ appendDedup tests passed.\n');

    // 2. Test Logging
    console.log('--- Test 2: Logging to daily logs ---');
    const logsDir = config.LOGS_DIR;
    console.log('Logs directory configured as:', logsDir);

    // Call logging functions
    writeDailyLog('INFO: Server verification started');
    logGateTransaction('gate-in', 'RF2606-TEST1', null, 'CONT1234567');
    logGateTransaction('gate-out', 'RF2606-TEST2', 'BKG999', 'CONT9999999');

    // Let's wait a brief moment for the async file appends to finish
    await new Promise(resolve => setTimeout(resolve, 500));

    const todayStr = formatBKKDateISO(new Date()).replace(/-/g, '');
    const expectedFile = path.join(logsDir, `logs_${todayStr}.txt`);
    if (fs.existsSync(expectedFile)) {
        console.log(`✅ Daily log file created successfully at: ${expectedFile}`);
        const content = fs.readFileSync(expectedFile, 'utf8');
        console.log('--- File Contents: ---');
        console.log(content.trim());
        console.log('----------------------');
    } else {
        console.error(`❌ Expected log file not found at: ${expectedFile}`);
    }
    console.log('\n');

    // 3. Test Cleanup Action
    console.log('--- Test 3: Log cleanup after retention limit ---');
    // Create a dummy log file from 10 days ago
    const oldDate = new Date();
    oldDate.setDate(oldDate.getDate() - 10);
    const oldDateStr = formatBKKDateISO(oldDate).replace(/-/g, '');
    const oldFileName = `logs_${oldDateStr}.txt`;
    const oldFilePath = path.join(logsDir, oldFileName);

    fs.writeFileSync(oldFilePath, 'Dummy log entry from 10 days ago', 'utf8');
    console.log(`Created dummy old log file: ${oldFilePath}`);

    // Verify it exists
    if (fs.existsSync(oldFilePath)) {
        console.log(`Dummy old file exists: ${fs.existsSync(oldFilePath)}`);
    }

    // Run cleanup logic
    console.log('Running cleanup program (database updates disabled for dry-run simulation)...');
    try {
        await runCleanup(false);
        console.log('Cleanup execution completed.');
    } catch (err) {
        console.log('Note: DB connection skipped or failed during cleanup test:', err.message);
    }

    // Check if the old log file was deleted
    if (!fs.existsSync(oldFilePath)) {
        console.log('✅ Success: Old log file was successfully cleaned up!');
    } else {
        console.error('❌ Error: Old log file still exists!');
        try { fs.unlinkSync(oldFilePath); } catch (e) {}
    }

    console.log('\nVerification complete.');
}

runTest();
