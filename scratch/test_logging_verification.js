/**
 * Verification script for:
 *  1. customers.js PUT /:tax_rec_id  -> EDIT_CUSTOMER logging (field diff + relink diff)
 *  2. customer-profiles.js PUT /:id  -> EDIT_PROFILE logging (field diff)
 *  3. upload.js CSV customer-profile -> EDIT_CUSTOMER_UPLOAD logging (field diff)
 *  4. logs.js keyword search on log_values
 *
 * Uses isolated TEST-* rows against the local dev DB. Cleans up after itself.
 * Does NOT touch production. Does NOT commit/push anything.
 */
const mysql = require('mysql2/promise');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
require('dotenv').config();

const baseUrl = 'http://127.0.0.1:3091';
const testLogsDir = path.join(__dirname, '_test_logs_output');
let spawnedProcess = null;
let failures = 0;

function ok(label) { console.log(`✅ ${label}`); }
function fail(label, detail) { console.log(`❌ ${label}${detail ? ' -> ' + detail : ''}`); failures++; }

function startServer() {
    return new Promise((resolve, reject) => {
        console.log('🚀 Starting Express server on port 3091 (test LOGS_DIR override)...');
        if (fs.existsSync(testLogsDir)) fs.rmSync(testLogsDir, { recursive: true, force: true });
        fs.mkdirSync(testLogsDir, { recursive: true });

        const testEnv = { ...process.env, PORT: '3091', NODE_ENV: 'test', LOGS_DIR: testLogsDir };
        console.log(`[Debug] spawning with PORT=${testEnv.PORT} LOGS_DIR=${testEnv.LOGS_DIR} cwd=${path.join(__dirname, '..')}`);
        const server = spawn('node', ['src/index.js'], { env: testEnv, cwd: path.join(__dirname, '..') });
        spawnedProcess = server;
        console.log(`[Debug] spawned pid=${server.pid}`);
        server.stderr.on('data', d => console.error(`[Server:err] ${d.toString().trim()}`));
        server.stdout.on('data', d => console.log(`[Server:out] ${d.toString().trim()}`));
        server.on('exit', (code) => console.log(`[Server] exited early with code ${code}`));
        server.on('error', (err) => console.log(`[Server] spawn error: ${err.message}`));
        setTimeout(() => resolve(server), 8000);
    });
}

function extractCookie(res) {
    const raw = res.headers.get('set-cookie') || res.headers.raw?.()['set-cookie'];
    if (Array.isArray(raw)) return raw.map(c => c.split(';')[0]).join('; ');
    return raw ? raw.split(';')[0] : '';
}

async function run() {
    const pool = mysql.createPool({
        host: process.env.DB_HOST, user: process.env.DB_USER,
        password: process.env.DB_PASSWORD, database: process.env.DB_NAME
    });

    // --- Cleanup any leftovers from a previous run ---
    await pool.query("DELETE FROM invoices WHERE tax_rec_id LIKE 'TEST-INV-%'");
    await pool.query("DELETE FROM customer_profile WHERE customer_num LIKE 'TEST-CUST-%'");
    await pool.query("DELETE FROM activity_logs WHERE log_values LIKE '%TEST-CUST-%' OR log_values LIKE '%TEST-INV-%'");

    // --- Seed test data ---
    await pool.query(`INSERT INTO customer_profile (tax_id, customer_num, customer_name, customer_addr, customer_branch, is_accounting_exported) VALUES
        ('1111111111111','TEST-CUST-001','Test Old Name A','Old Addr A','สำนักงานใหญ่',FALSE),
        ('3333333333333','TEST-CUST-002','Other Co B','Other Addr B','สำนักงานใหญ่',FALSE),
        ('5555555555555','TEST-CUST-004','CSV Old Name D','CSV Old Addr D','สำนักงานใหญ่',FALSE)`);
    await pool.query(`UPDATE customer_profile SET customer_email='old2@example.com', customer_phone='0811111111' WHERE customer_num='TEST-CUST-004'`);
    const [profRows] = await pool.query(`INSERT INTO customer_profile (tax_id, customer_num, customer_name, customer_addr, customer_email, customer_phone, customer_branch, is_accounting_exported)
        VALUES ('4444444444444','TEST-CUST-003','Profile Old Name C','Old Addr C','old@example.com','0800000000','สำนักงานใหญ่',FALSE)`);
    const profile003Id = profRows.insertId;

    await pool.query(`INSERT INTO invoices (tax_rec_id, customer_num, status, is_accounting_exported, service_date) VALUES
        ('TEST-INV-001','TEST-CUST-001','ready',FALSE,'2026-07-15')`);

    let server;
    try {
        server = await startServer();

        // --- Login ---
        const loginRes = await fetch(`${baseUrl}/api/admin/auth/login`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: 'admin', password: 'admin369' })
        });
        const loginData = await loginRes.json();
        if (!loginData.success) { fail('Admin login', JSON.stringify(loginData)); throw new Error('cannot continue without auth'); }
        ok('Admin login succeeded');
        const cookie = extractCookie(loginRes);

        // =========================================================
        // TEST 1: customers.js PUT -> field diff logging
        // =========================================================
        const put1 = await fetch(`${baseUrl}/api/admin/customers/TEST-INV-001`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', Cookie: cookie },
            body: JSON.stringify({
                customer: 'Test New Name A', address: 'New Addr A', tax_id: '2222222222222',
                customer_branch: 'สำนักงานใหญ่', customer_num: 'TEST-CUST-001'
            })
        });
        const put1Data = await put1.json();
        if (!put1Data.success) fail('customers.js PUT (field change)', JSON.stringify(put1Data));
        else ok('customers.js PUT (field change) request succeeded');

        const [prof1] = await pool.query("SELECT * FROM customer_profile WHERE customer_num='TEST-CUST-001'");
        if (prof1[0].tax_id === '2222222222222' && prof1[0].customer_name === 'Test New Name A' && prof1[0].customer_addr === 'New Addr A') {
            ok('DB: customer_profile TEST-CUST-001 updated to new values');
        } else {
            fail('DB: customer_profile TEST-CUST-001 not updated correctly', JSON.stringify(prof1[0]));
        }

        const [log1] = await pool.query("SELECT * FROM activity_logs WHERE log_action='EDIT_CUSTOMER' AND log_values LIKE '%TEST-CUST-001%' ORDER BY log_id DESC LIMIT 5");
        const fieldDiffLog = log1.find(l => l.log_values.includes('Existing:'));
        if (fieldDiffLog
            && fieldDiffLog.log_values.includes('TaxID: "1111111111111"')
            && fieldDiffLog.log_values.includes('"2222222222222"')
            && fieldDiffLog.log_values.includes('Test Old Name A')
            && fieldDiffLog.log_values.includes('Test New Name A')
            && fieldDiffLog.username === 'admin') {
            ok('activity_logs: EDIT_CUSTOMER field-diff entry has correct old/new/user');
        } else {
            fail('activity_logs: EDIT_CUSTOMER field-diff entry missing or incorrect', JSON.stringify(fieldDiffLog));
        }

        // =========================================================
        // TEST 2: customers.js PUT -> relink-only logging (no field diff on target profile)
        // =========================================================
        const put2 = await fetch(`${baseUrl}/api/admin/customers/TEST-INV-001`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', Cookie: cookie },
            body: JSON.stringify({
                customer: 'Other Co B', address: 'Other Addr B', tax_id: '3333333333333',
                customer_branch: 'สำนักงานใหญ่', customer_num: 'TEST-CUST-002'
            })
        });
        const put2Data = await put2.json();
        if (!put2Data.success) fail('customers.js PUT (relink only)', JSON.stringify(put2Data));

        const [log2] = await pool.query("SELECT * FROM activity_logs WHERE log_action='EDIT_CUSTOMER' AND log_values LIKE '%relinked%' ORDER BY log_id DESC LIMIT 5");
        const relinkLog = log2.find(l => l.log_values.includes('TEST-CUST-001') && l.log_values.includes('TEST-CUST-002'));
        if (relinkLog && relinkLog.username === 'admin') {
            ok('activity_logs: EDIT_CUSTOMER relink-only entry logged even with no field diff (gap fix confirmed)');
        } else {
            fail('activity_logs: EDIT_CUSTOMER relink-only entry missing', JSON.stringify(log2));
        }

        // =========================================================
        // TEST 3: customer-profiles.js PUT -> field diff logging
        // =========================================================
        const put3 = await fetch(`${baseUrl}/api/admin/customer-profiles/${profile003Id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', Cookie: cookie },
            body: JSON.stringify({
                customer_name: 'Profile New Name C', customer_addr: 'New Addr C',
                customer_email: 'new@example.com', customer_phone: '0899999999', customer_branch: 'สำนักงานใหญ่'
            })
        });
        const put3Data = await put3.json();
        if (!put3Data.success) fail('customer-profiles.js PUT', JSON.stringify(put3Data));

        const [log3] = await pool.query("SELECT * FROM activity_logs WHERE log_action='EDIT_PROFILE' AND log_values LIKE '%TEST-CUST-003%' ORDER BY log_id DESC LIMIT 1");
        if (log3.length && log3[0].log_values.includes('Profile Old Name C') && log3[0].log_values.includes('Profile New Name C')
            && log3[0].log_values.includes('old@example.com') && log3[0].log_values.includes('new@example.com')
            && log3[0].username === 'admin') {
            ok('activity_logs: EDIT_PROFILE entry has correct old/new/user (name+email captured, previously missing)');
        } else {
            fail('activity_logs: EDIT_PROFILE entry missing or incomplete', JSON.stringify(log3));
        }

        // =========================================================
        // TEST 4: upload.js CSV customer-profile replace -> field diff logging
        // =========================================================
        const csvHeader = 'รหัสลูกค้า|เลขประจำตัวผู้เสียภาษี|ชื่อลูกค้า|ที่อยู่|email|โทรศัพท์|ประเภทสาขา|สาขา';
        const csvRow = 'TEST-CUST-004|9999999999999|CSV New Name D|CSV New Addr D|new2@example.com|0822222222|สำนักงานใหญ่|สำนักงานใหญ่';
        const csvContent = `${csvHeader}\n${csvRow}\n`;
        const formData = new FormData();
        const blob = new Blob([csvContent], { type: 'text/csv' });
        formData.append('file', blob, 'test_customer_profile.csv');

        const put4 = await fetch(`${baseUrl}/api/admin/upload/customer-profile`, {
            method: 'POST', headers: { Cookie: cookie }, body: formData
        });
        const put4Data = await put4.json();
        if (!put4Data.success) fail('upload.js CSV customer-profile', JSON.stringify(put4Data));
        else ok(`upload.js CSV customer-profile upload succeeded (updateCount=${put4Data.updateCount})`);

        const [log4] = await pool.query("SELECT * FROM activity_logs WHERE log_action='EDIT_CUSTOMER_UPLOAD' AND log_values LIKE '%TEST-CUST-004%' ORDER BY log_id DESC LIMIT 1");
        if (log4.length && log4[0].log_values.includes('5555555555555') && log4[0].log_values.includes('9999999999999')
            && log4[0].log_values.includes('CSV Old Name D') && log4[0].log_values.includes('CSV New Name D')
            && log4[0].username === 'admin') {
            ok('activity_logs: EDIT_CUSTOMER_UPLOAD entry has correct old/new/user (now DB-visible, not just file-only)');
        } else {
            fail('activity_logs: EDIT_CUSTOMER_UPLOAD entry missing or incomplete', JSON.stringify(log4));
        }

        // =========================================================
        // TEST 5: keyword search filters log_values correctly
        // =========================================================
        const searchRes = await fetch(`${baseUrl}/api/admin/logs?keyword=TEST-INV-001`, { headers: { Cookie: cookie } });
        const searchData = await searchRes.json();
        const allMatch = searchData.success && searchData.logs.length > 0 && searchData.logs.every(l => l.log_values.includes('TEST-INV-001'));
        if (allMatch) {
            ok(`logs.js keyword search: found ${searchData.logs.length} row(s), all contain "TEST-INV-001"`);
        } else {
            fail('logs.js keyword search: results missing or contain non-matching rows', JSON.stringify(searchData));
        }

        const noMatchRes = await fetch(`${baseUrl}/api/admin/logs?keyword=DOES_NOT_EXIST_XYZ`, { headers: { Cookie: cookie } });
        const noMatchData = await noMatchRes.json();
        if (noMatchData.success && noMatchData.logs.length === 0) {
            ok('logs.js keyword search: correctly returns 0 rows for a non-matching keyword');
        } else {
            fail('logs.js keyword search: expected 0 rows for non-matching keyword', JSON.stringify(noMatchData));
        }

        const exportRes = await fetch(`${baseUrl}/api/admin/logs/export?keyword=TEST-INV-001`, { headers: { Cookie: cookie } });
        const exportText = await exportRes.text();
        const exportLines = exportText.trim().split('\n').slice(1); // drop header
        const exportAllMatch = exportLines.length > 0 && exportLines.every(l => l.includes('TEST-INV-001'));
        if (exportAllMatch) {
            ok(`logs.js /export keyword search: ${exportLines.length} row(s) exported, all match`);
        } else {
            fail('logs.js /export keyword search: mismatch', exportText);
        }

        // =========================================================
        // TEST 6: log file actually written to disk (the ./logs folder fix, verified in isolation)
        // =========================================================
        const todayFile = fs.readdirSync(testLogsDir).find(f => f.startsWith('logs_'));
        if (todayFile) {
            const content = fs.readFileSync(path.join(testLogsDir, todayFile), 'utf8');
            const hasEditCustomer = content.includes('EDIT_CUSTOMER') && content.includes('TEST-CUST-001');
            const hasUpload = content.includes('EDIT_CUSTOMER_UPLOAD') && content.includes('TEST-CUST-004');
            if (hasEditCustomer && hasUpload) {
                ok(`Daily log file written correctly to LOGS_DIR (${todayFile}) with matching entries`);
            } else {
                fail('Daily log file exists but missing expected entries', content.slice(0, 500));
            }
        } else {
            fail('No daily log file was created in the test LOGS_DIR at all');
        }

    } catch (err) {
        console.error('\n💥 Test run aborted:', err.message);
        failures++;
    } finally {
        // --- Cleanup ---
        await pool.query("DELETE FROM invoices WHERE tax_rec_id LIKE 'TEST-INV-%'");
        await pool.query("DELETE FROM customer_profile WHERE customer_num LIKE 'TEST-CUST-%'");
        await pool.query("DELETE FROM activity_logs WHERE log_values LIKE '%TEST-CUST-%' OR log_values LIKE '%TEST-INV-%'");
        await pool.end();
        if (spawnedProcess) spawnedProcess.kill();
        if (fs.existsSync(testLogsDir)) fs.rmSync(testLogsDir, { recursive: true, force: true });

        console.log(`\n${'='.repeat(60)}`);
        if (failures === 0) {
            console.log('🎉 ALL CHECKS PASSED');
        } else {
            console.log(`💥 ${failures} CHECK(S) FAILED`);
        }
        process.exit(failures === 0 ? 0 : 1);
    }
}

run();
