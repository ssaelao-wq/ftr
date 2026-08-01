const mysql = require('mysql2/promise');
const { spawn } = require('child_process');
require('dotenv').config();

const baseUrl = 'http://127.0.0.1:3002';
let spawnedProcess = null;

function startServer() {
    return new Promise((resolve, reject) => {
        console.log('🚀 Starting Express server on port 3002...');
        const testEnv = { ...process.env };
        for (const key of Object.keys(testEnv)) {
            if (key.toUpperCase() === 'PORT') {
                delete testEnv[key];
            }
        }
        testEnv.PORT = '3002';
        testEnv.NODE_ENV = 'test';
        testEnv.DB_HOST = process.env.DB_HOST || 'localhost';

        const server = spawn('node', ['src/index.js'], {
            env: testEnv,
            cwd: __dirname + '/..'
        });
        spawnedProcess = server;

        server.stderr.on('data', (data) => {
            console.error(`[Server Error] ${data.toString().trim()}`);
        });

        server.on('error', (err) => {
            reject(err);
        });

        // Simply wait for 4 seconds for the server to spin up
        setTimeout(() => {
            resolve(server);
        }, 4000);
    });
}

async function runTests() {
    console.log('🔄 Setting up database for save-and-send verification...');
    const pool = mysql.createPool({
        host: process.env.DB_HOST || '127.0.0.1',
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || '',
        database: process.env.DB_NAME || 'ftr_db'
    });

    // Clear existing data for a clean test
    await pool.query('SET FOREIGN_KEY_CHECKS = 0');
    await pool.query('TRUNCATE TABLE invoices_rec');
    await pool.query('TRUNCATE TABLE invoices');
    await pool.query('TRUNCATE TABLE customer_profile');
    await pool.query('TRUNCATE TABLE activity_logs');
    await pool.query('SET FOREIGN_KEY_CHECKS = 1');

    // Insert 2 invoices
    console.log('📥 Inserting test invoices...');
    await pool.query(`
        INSERT INTO invoices (tax_rec_id, customer_num, status, is_accounting_exported, service_date)
        VALUES 
        ('RF2607-01565', NULL, 'pending', FALSE, '2026-07-15'),
        ('RF2607-01566', NULL, 'pending', FALSE, '2026-07-15')
    `);

    let server;
    try {
        server = await startServer();
    } catch (err) {
        console.error('❌ Failed to start server:', err);
        if (spawnedProcess) spawnedProcess.kill();
        await pool.end();
        process.exit(1);
    }

    try {
        // 1. Submit first invoice (RF2607-01565) - Should generate new customer number
        console.log('\n📝 Step 1: Submitting RF2607-01565...');
        const res1 = await fetch(`${baseUrl}/api/customer/save-and-send`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                line_user_id: 'mock_user_1',
                line_display_name: 'Test User',
                tax_rec_id: 'RF2607-01565',
                tax_id: '0105535006083',
                customer_branch: '00000',
                customer_num: '',
                customer_name: 'Original Test Name Co.',
                address: '123 Original St',
                send_method: 'line'
            })
        });

        const data1 = await res1.json();
        console.log('Response:', data1);
        if (!data1.success) {
            throw new Error('Failed Step 1 submit: ' + JSON.stringify(data1));
        }

        // Verify Step 1 DB state
        const [profiles1] = await pool.query('SELECT * FROM customer_profile WHERE tax_id = ?', ['0105535006083']);
        console.log('Profiles in DB:', profiles1);
        if (profiles1.length !== 1) {
            throw new Error('Expected 1 customer profile to be created.');
        }

        const generatedCode = profiles1[0].customer_num;
        console.log(`Generated customer number: ${generatedCode}`);

        const [invoices1] = await pool.query('SELECT * FROM invoices WHERE tax_rec_id = ?', ['RF2607-01565']);
        console.log('Invoice RF2607-01565 in DB:', invoices1[0]);
        if (invoices1[0].customer_num !== generatedCode) {
            throw new Error(`Expected Invoice customer_num to match generatedCode (${generatedCode})`);
        }

        // 2. Submit second invoice (RF2607-01566) with same profile, updating details
        console.log('\n📝 Step 2: Submitting RF2607-01566 (Updating name and address)...');
        const res2 = await fetch(`${baseUrl}/api/customer/save-and-send`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                line_user_id: 'mock_user_1',
                line_display_name: 'Test User',
                tax_rec_id: 'RF2607-01566',
                tax_id: '0105535006083',
                customer_branch: '00000',
                customer_num: generatedCode,
                customer_name: 'Updated Test Name Co.',
                address: '456 Updated St',
                send_method: 'line'
            })
        });

        const data2 = await res2.json();
        console.log('Response:', data2);
        if (!data2.success) {
            throw new Error('Failed Step 2 submit: ' + JSON.stringify(data2));
        }

        // Verify Step 2 DB state
        const [profiles2] = await pool.query('SELECT * FROM customer_profile WHERE tax_id = ?', ['0105535006083']);
        console.log('Profiles in DB after Step 2:', profiles2);
        if (profiles2.length !== 1) {
            throw new Error('Expected still only 1 customer profile to exist.');
        }

        const currentCode = profiles2[0].customer_num;
        console.log(`Current customer number in profile: ${currentCode}`);

        // ASSERT: customer_num must NOT have changed!
        if (currentCode !== generatedCode) {
            throw new Error(`CRITICAL BUG: Customer number changed from ${generatedCode} to ${currentCode}!`);
        }

        // ASSERT: Name and address must be updated in-place
        if (profiles2[0].customer_name !== 'Updated Test Name Co.' || profiles2[0].customer_addr !== '456 Updated St') {
            throw new Error('Customer name or address was not updated in-place.');
        }

        // ASSERT: Both invoices must reference the same customer_num
        const [invoices2] = await pool.query('SELECT * FROM invoices ORDER BY tax_rec_id ASC');
        console.log('Invoices after Step 2:', invoices2);
        if (invoices2[0].customer_num !== generatedCode || invoices2[1].customer_num !== generatedCode) {
            throw new Error(`Invoices are not both linked to ${generatedCode}! One of them is orphaned!`);
        }

        console.log('\n✅ FIX VERIFIED SUCCESSFULLY! No customer code regeneration occurred, and no invoices were orphaned.');

    } catch (err) {
        console.error('\n❌ Test execution failed:', err.message);
        process.exitCode = 1;
    } finally {
        console.log('Stopping server...');
        if (spawnedProcess) spawnedProcess.kill();
        await pool.end();
        console.log('Done.');
    }
}

runTests();
