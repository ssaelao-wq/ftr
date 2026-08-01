const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
require('dotenv').config();

const baseUrl = 'http://127.0.0.1:3092';
let spawnedProcess = null;
let failures = 0;

function ok(label) { console.log(`✅ ${label}`); }
function fail(label, detail) { console.log(`❌ ${label}${detail ? ' -> ' + detail : ''}`); failures++; }

function startServer() {
    return new Promise((resolve) => {
        const testLogsDir = path.join(__dirname, '_test_logs_date_validation');
        if (fs.existsSync(testLogsDir)) fs.rmSync(testLogsDir, { recursive: true, force: true });
        const testEnv = { ...process.env, PORT: '3092', NODE_ENV: 'test', LOGS_DIR: testLogsDir };
        const server = spawn('node', ['src/index.js'], { env: testEnv, cwd: path.join(__dirname, '..') });
        spawnedProcess = server;
        server.stderr.on('data', d => console.error(`[Server:err] ${d.toString().trim()}`));
        setTimeout(() => resolve(server), 6000);
    });
}

function extractCookie(res) {
    const raw = res.headers.get('set-cookie');
    return raw ? raw.split(';')[0] : '';
}

async function run() {
    try {
        await startServer();

        const loginRes = await fetch(`${baseUrl}/api/admin/auth/login`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: 'admin', password: 'admin369' })
        });
        const loginData = await loginRes.json();
        if (!loginData.success) { fail('Admin login', JSON.stringify(loginData)); throw new Error('cannot continue'); }
        const cookie = extractCookie(loginRes);

        // Reproduce the exact malformed values seen in production
        const badCases = ['52026-07-24', '20265-07-31', '2026-13-40', 'not-a-date'];
        for (const bad of badCases) {
            const res = await fetch(`${baseUrl}/api/admin/logs?date_from=${encodeURIComponent(bad)}`, { headers: { Cookie: cookie } });
            const data = await res.json();
            if (res.status === 400 && data.success === false && data.message.includes(bad)) {
                ok(`date_from="${bad}" correctly rejected with 400 and a clear message`);
            } else {
                fail(`date_from="${bad}" not handled correctly`, `status=${res.status} body=${JSON.stringify(data)}`);
            }
        }

        for (const bad of badCases) {
            const res = await fetch(`${baseUrl}/api/admin/logs/export?date_to=${encodeURIComponent(bad)}`, { headers: { Cookie: cookie } });
            const data = await res.json().catch(() => null);
            if (res.status === 400 && data && data.success === false) {
                ok(`/export date_to="${bad}" correctly rejected with 400`);
            } else {
                fail(`/export date_to="${bad}" not handled correctly`, `status=${res.status}`);
            }
        }

        // Confirm valid dates still work exactly as before (no regression)
        const goodRes = await fetch(`${baseUrl}/api/admin/logs?date_from=2026-07-01&date_to=2026-08-01`, { headers: { Cookie: cookie } });
        const goodData = await goodRes.json();
        if (goodRes.status === 200 && goodData.success === true) {
            ok('Valid date range (2026-07-01 to 2026-08-01) still works correctly (no regression)');
        } else {
            fail('Valid date range broken by the fix', JSON.stringify(goodData));
        }

        // Edge case: Feb 30 doesn't exist - should also be rejected even though format looks right
        const feb30Res = await fetch(`${baseUrl}/api/admin/logs?date_from=2026-02-30`, { headers: { Cookie: cookie } });
        const feb30Data = await feb30Res.json();
        if (feb30Res.status === 400) {
            ok('Semantically invalid date "2026-02-30" (format OK, date doesn\'t exist) correctly rejected');
        } else {
            fail('"2026-02-30" should have been rejected', JSON.stringify(feb30Data));
        }

    } catch (err) {
        console.error('💥 Test run aborted:', err.message);
        failures++;
    } finally {
        if (spawnedProcess) spawnedProcess.kill();
        const testLogsDir = path.join(__dirname, '_test_logs_date_validation');
        if (fs.existsSync(testLogsDir)) fs.rmSync(testLogsDir, { recursive: true, force: true });
        console.log(`\n${'='.repeat(60)}`);
        console.log(failures === 0 ? '🎉 ALL CHECKS PASSED' : `💥 ${failures} CHECK(S) FAILED`);
        process.exit(failures === 0 ? 0 : 1);
    }
}

run();
