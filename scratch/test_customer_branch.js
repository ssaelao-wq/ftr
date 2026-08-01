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
        testEnv.DB_HOST = '127.0.0.1';

        const server = spawn('node', ['src/index.js'], {
            env: testEnv,
            cwd: __dirname + '/..'
        });
        spawnedProcess = server;

        server.stdout.on('data', (data) => {
            const output = data.toString();
            if (output.includes('Server is running on port 3002')) {
                resolve(server);
            }
        });

        server.stderr.on('data', (data) => {
            console.error(`[Server Error] ${data.toString().trim()}`);
        });

        server.on('error', (err) => {
            reject(err);
        });

        setTimeout(() => {
            reject(new Error('Server start timed out after 10 seconds'));
        }, 10000);
    });
}

async function runTests() {
    console.log('🔄 Setting up database for branch edit tests...');
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

    // Insert 2 customer profiles: Head Office (CUS-00001) and Branch 1 (CUS-00002)
    console.log('📥 Inserting test customer profiles...');
    await pool.query(`
        INSERT INTO customer_profile (tax_id, customer_num, customer_name, customer_addr, customer_branch, is_accounting_exported)
        VALUES 
        ('1234567890123', 'CUS-00001', 'Unicon Head Office', '123 Rama 9 Rd, Bangkok', 'สำนักงานใหญ่', FALSE),
        ('1234567890123', 'CUS-00002', 'Unicon Branch 1', '456 Harbor Rd, Chonburi', '00001', FALSE)
    `);

    // Insert an invoice linked to CUS-00001
    console.log('📥 Inserting test invoice...');
    await pool.query(`
        INSERT INTO invoices (tax_rec_id, customer_num, status, is_accounting_exported)
        VALUES ('RF2605-01109', 'CUS-00001', 'pending', FALSE)
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

    let cookie = '';
    try {
        // 1. Authenticate (Login as Admin)
        console.log('\n🔐 Step 1: Admin Login...');
        const loginRes = await fetch(`${baseUrl}/api/admin/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: 'admin', password: 'admin369' })
        });
        const loginData = await loginRes.json();
        if (!loginData.success) throw new Error('Login failed');
        const setCookieHeader = loginRes.headers.get('set-cookie');
        if (setCookieHeader) {
            cookie = setCookieHeader.split(';')[0];
        }

        // 2. Test updating branch to an existing branch (00001 -> should resolve to CUS-00002)
        console.log('\n🔄 Step 2: Edit invoice customer branch to an EXISTING branch (00001)...');
        const editRes = await fetch(`${baseUrl}/api/admin/customers/RF2605-01109`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'cookie': cookie },
            body: JSON.stringify({
                customer: 'Unicon Branch 1',
                tax_id: '1234567890123',
                customer_branch: '00001',
                address: '456 Harbor Rd, Chonburi (Updated)',
                customer_num: 'CUS-00001' // Old customer num passed from client
            })
        });
        const editData = await editRes.json();
        console.log('API Response:', editRes.status, editData);
        if (!editData.success) throw new Error('Failed to update invoice customer link');

        // Verify in DB that invoice RF2605-01109 is now linked to CUS-00002 and CUS-00001 is untouched
        const [invRows] = await pool.query('SELECT customer_num FROM invoices WHERE tax_rec_id = ?', ['RF2605-01109']);
        console.log('Invoice linked customer_num:', invRows[0].customer_num);
        if (invRows[0].customer_num !== 'CUS-00002') {
            throw new Error('Invoice did not link to the existing branch profile (CUS-00002)!');
        }

        const [prof1] = await pool.query('SELECT customer_branch FROM customer_profile WHERE customer_num = ?', ['CUS-00001']);
        console.log('Original CUS-00001 branch is still:', prof1[0].customer_branch);
        if (prof1[0].customer_branch !== 'สำนักงานใหญ่') {
            throw new Error('Original profile CUS-00001 was erroneously changed in-place!');
        }

        // 3. Test updating branch to a NEW branch (00002 -> should create a new profile with TMP-xxxxxx)
        console.log('\n🆕 Step 3: Edit invoice customer branch to a NEW branch (00002)...');
        const editNewRes = await fetch(`${baseUrl}/api/admin/customers/RF2605-01109`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'cookie': cookie },
            body: JSON.stringify({
                customer: 'Unicon Branch 2',
                tax_id: '1234567890123',
                customer_branch: '00002',
                address: '789 Ocean St, Chonburi',
                customer_num: 'CUS-00002'
            })
        });
        const editNewData = await editNewRes.json();
        console.log('API Response:', editNewRes.status, editNewData);
        if (!editNewData.success) throw new Error('Failed to update invoice customer link to new branch');

        // Verify in DB that a new customer profile was created and invoice points to it
        const [invRowsNew] = await pool.query('SELECT customer_num FROM invoices WHERE tax_rec_id = ?', ['RF2605-01109']);
        const newCustNum = invRowsNew[0].customer_num;
        console.log('Invoice now linked to customer_num:', newCustNum);
        if (!newCustNum.startsWith('TMP-')) {
            throw new Error('A new TMP- customer profile was not created for the new branch!');
        }

        const [newProf] = await pool.query('SELECT customer_branch, customer_name, customer_addr FROM customer_profile WHERE customer_num = ?', [newCustNum]);
        console.log('New Profile details:', newProf[0]);
        if (newProf[0].customer_branch !== '00002' || newProf[0].customer_name !== 'Unicon Branch 2') {
            throw new Error('New profile details do not match!');
        }

        // 4. Test editing Customer Profile directly via customer-profiles API
        console.log('\n📝 Step 4: Edit customer profile directly (PUT /api/admin/customer-profiles/:id)...');
        const [profToEdit] = await pool.query('SELECT id FROM customer_profile WHERE customer_num = ?', ['CUS-00001']);
        const editProfileRes = await fetch(`${baseUrl}/api/admin/customer-profiles/${profToEdit[0].id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'cookie': cookie },
            body: JSON.stringify({
                customer_name: 'Unicon Headquarters Edited',
                customer_addr: '123 Rama 9 Rd, Bangkok (Updated)',
                customer_branch: 'HQ-NEW'
            })
        });
        const editProfileData = await editProfileRes.json();
        console.log('API Response:', editProfileRes.status, editProfileData);
        if (!editProfileData.success) throw new Error('Failed to update customer profile directly');

        // Verify in DB that profile was updated
        const [editedProf] = await pool.query('SELECT customer_name, customer_branch FROM customer_profile WHERE customer_num = ?', ['CUS-00001']);
        console.log('Edited profile:', editedProf[0]);
        if (editedProf[0].customer_name !== 'Unicon Headquarters Edited' || editedProf[0].customer_branch !== 'HQ-NEW') {
            throw new Error('Direct profile updates did not apply!');
        }

        console.log('\n🎉 ALL CUSTOMER BRANCH LOGIC TESTS PASSED SUCCESSFULLY! 🎉');

    } catch (e) {
        console.error('❌ Test failed:', e.message);
        process.exit(1);
    } finally {
        if (spawnedProcess) spawnedProcess.kill();
        await pool.end();
    }
}

runTests();
