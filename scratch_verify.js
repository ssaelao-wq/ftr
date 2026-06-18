const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
require('dotenv').config();

async function resetDatabase() {
    console.log('🔄 Resetting database schema...');
    
    // Connect to MySQL server first (without database to run drop/create)
    const conn = await mysql.createConnection({
        host: process.env.DB_HOST || '127.0.0.1',
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || '',
        multipleStatements: true
    });

    try {
        const schemaSql = fs.readFileSync(path.join(__dirname, 'database/schema.sql'), 'utf8');
        await conn.query(schemaSql);
        console.log('✅ Database schema initialized successfully.');
    } catch (err) {
        console.error('❌ Failed to reset database:', err);
        process.exit(1);
    } finally {
        await conn.end();
    }
}

let spawnedProcess = null;

function startServer() {
    return new Promise((resolve, reject) => {
        console.log('🚀 Starting Express server on port 3001...');
        
        const testEnv = { ...process.env };
        for (const key of Object.keys(testEnv)) {
            if (key.toUpperCase() === 'PORT') {
                delete testEnv[key];
            }
        }
        testEnv.PORT = '3001';
        testEnv.NODE_ENV = 'test';
        testEnv.DB_HOST = '127.0.0.1';

        const server = spawn('node', ['src/index.js'], {
            env: testEnv,
            cwd: __dirname
        });
        spawnedProcess = server;

        server.stdout.on('data', (data) => {
            const output = data.toString();
            console.log(`[Server] ${output.trim()}`);
            if (output.includes('Server is running on port 3001')) {
                resolve(server);
            }
        });

        server.stderr.on('data', (data) => {
            console.error(`[Server Error] ${data.toString().trim()}`);
        });

        server.on('error', (err) => {
            reject(err);
        });

        // Set a timeout in case the port is blocked or doesn't start
        setTimeout(() => {
            reject(new Error('Server start timed out after 30 seconds'));
        }, 30000);
    });
}

async function runTests() {
    await resetDatabase();
    
    let server;
    try {
        server = await startServer();
    } catch (err) {
        console.error('❌ Failed to start server:', err);
        if (spawnedProcess) spawnedProcess.kill();
        process.exit(1);
    }

    const baseUrl = 'http://127.0.0.1:3001';
    let cookie = '';

    try {
        // 1. Authenticate (Login as Admin)
        console.log('\n--- Step 1: Admin Login ---');
        const loginRes = await fetch(`${baseUrl}/api/admin/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: 'admin', password: 'admin123' })
        });
        
        const loginData = await loginRes.json();
        console.log('Login Status:', loginRes.status, loginData);
        if (!loginData.success) throw new Error('Login failed');
        
        const setCookieHeader = loginRes.headers.get('set-cookie');
        if (setCookieHeader) {
            cookie = setCookieHeader.split(';')[0];
            console.log('Session Cookie retrieved.');
        }

        // 2. Upload Customer Profile CSV
        console.log('\n--- Step 2: Upload Customer Profile CSV ---');
        const profileCsv = [
            'เลขประจำตัวผู้เสียภาษี|รหัสลูกค้า|ชื่อลูกค้า|ที่อยู่|email|โทรศัพท์|ประเภทสาขา|สาขา',
            '1234567890123|CUS-00001|Unicon Head Office|123 Rama 9 Rd, Bangkok|info@unicon.com|021234567|สำนักงานใหญ่|',
            '1234567890123|CUS-00002|Unicon Laem Chabang Branch|456 Harbor Rd, Chonburi|lcb@unicon.com|038123456|สาขาย่อย|00001'
        ].join('\n');

        const profileBlob = new Blob([profileCsv], { type: 'text/csv' });
        const profileFormData = new FormData();
        profileFormData.append('file', profileBlob, 'customer_profiles.csv');

        const profileUploadRes = await fetch(`${baseUrl}/api/admin/upload/customer-profile`, {
            method: 'POST',
            headers: { 'cookie': cookie },
            body: profileFormData
        });
        const profileUploadData = await profileUploadRes.json();
        console.log('Profile Upload Status:', profileUploadRes.status, profileUploadData);
        if (!profileUploadData.success) throw new Error('Profile upload failed');

        // 3. Upload CDMS Invoice CSV
        console.log('\n--- Step 3: Upload CDMS Invoice CSV ---');
        const cdmsCsv = [
            'ShipmentNo|ShipmentDate|InvoiceNo|InvoiceDate|CreditDays|SaleCode|CustomerCode|CustomerName|PartNumber|PartName|Inventory|Location|Unit|Qty|Price|Amount|UnitRate|VatType|BaseVat|VatRate|VatAmount|VatCode|VatGroup|GoodType|StockFlag|Cancel_invoice|Reference_Invoice',
            'RF2605-01109|12/05/2026|RF2605-01109|12/05/2026|0|UCS003|WHL|WAN HAI LINES (THAILAND) LTD.|AF|Gate Charge|UCS|UCS|service|1|238.32|238.32|1|1|838.32|7|58.68|SO-EX7|1|2|Y||',
            'RF2605-01109|12/05/2026|RF2605-01109|12/05/2026|0|UCS003|WHL|WAN HAI LINES (THAILAND) LTD.|SV-OUT|Gate Out Lift On Charge (Empty)|UCS|UCS|service|1|500|500|1|1|838.32|7|58.68|SO-EX7|1|2|Y||'
        ].join('\n');

        const cdmsBlob = new Blob([cdmsCsv], { type: 'text/csv' });
        const cdmsFormData = new FormData();
        cdmsFormData.append('file', cdmsBlob, 'cdms_invoice.csv');

        const cdmsUploadRes = await fetch(`${baseUrl}/api/admin/upload/cdms`, {
            method: 'POST',
            headers: { 'cookie': cookie },
            body: cdmsFormData
        });
        const cdmsUploadData = await cdmsUploadRes.json();
        console.log('CDMS Upload Status:', cdmsUploadRes.status, cdmsUploadData);
        if (!cdmsUploadData.success) throw new Error('CDMS upload failed');

        // 4. Test Customer LIFF branch lookup endpoint
        console.log('\n--- Step 4: LIFF Branch Lookup ---');
        const lookupRes = await fetch(`${baseUrl}/api/customer/lookup-branches?tax_id=1234567890123&tax_rec_id=RF2605-01109`);
        const lookupData = await lookupRes.json();
        console.log('Lookup Status:', lookupRes.status);
        console.log('Branches returned:', lookupData.branches);
        if (!lookupData.success || lookupData.branches.length !== 2) {
            throw new Error('Branch lookup validation failed');
        }

        // 5. Test Customer LIFF profile update (linking branch, address, container_num)
        console.log('\n--- Step 5: Update Customer Profile & Link Invoice ---');
        const updatePayload = {
            line_user_id: 'mock_liff_user_123',
            tax_rec_id: 'RF2605-01109',
            tax_id: '1234567890123',
            customer_branch: '00001',
            address: '456 Harbor Rd, Chonburi (Address Edited by Client)',
            container_num: 'TCNU1234567\nTCNU7654321' // 2 lines
        };

        const updateRes = await fetch(`${baseUrl}/api/customer/update-profile`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updatePayload)
        });
        const updateData = await updateRes.json();
        console.log('Update Status:', updateRes.status, updateData);
        if (!updateData.success) throw new Error('Update profile failed');

        // 6. Direct Database Validation
        console.log('\n--- Step 6: Database Direct Check ---');
        const pool = mysql.createPool({
            host: process.env.DB_HOST || '127.0.0.1',
            user: process.env.DB_USER || 'root',
            password: process.env.DB_PASSWORD || '',
            database: process.env.DB_NAME || 'ftr_db'
        });

        const [invRows] = await pool.query('SELECT * FROM invoices WHERE tax_rec_id = ?', ['RF2605-01109']);
        console.log('Updated Invoice record:', invRows[0]);
        
        const [profRows] = await pool.query('SELECT * FROM customer_profile WHERE tax_id = ? AND customer_branch = ?', ['1234567890123', '00001']);
        console.log('Updated Customer Profile record:', profRows[0]);

        await pool.end();

        if (invRows[0].container_num !== 'TCNU1234567\nTCNU7654321') {
            throw new Error('Database container_num value mismatch');
        }
        if (profRows[0].customer_addr !== '456 Harbor Rd, Chonburi (Address Edited by Client)') {
            throw new Error('Database customer_addr value mismatch');
        }
        console.log('✅ Database updates verified successfully.');

        // 7. Verify PDF generation using pdfService directly
        console.log('\n--- Step 7: PDF Generation Service Test ---');
        const { generatePdf } = require('./src/services/pdfService');
        const pdfUrl = await generatePdf('RF2605-01109');
        console.log('Generated PDF URL:', pdfUrl);
        const pdfFilePath = path.join(__dirname, pdfUrl);
        if (fs.existsSync(pdfFilePath)) {
            console.log('✅ PDF file successfully created on disk at:', pdfFilePath);
        } else {
            throw new Error('PDF file was not created on disk.');
        }

        console.log('\n💯 ALL INTEGRATION TESTS PASSED SUCCESSFULLY! 💯');

    } catch (err) {
        console.error('❌ Integration Test Failed:', err);
        process.exit(1);
    } finally {
        console.log('\n🛑 Stopping Express server...');
        if (server) server.kill();
        if (spawnedProcess) spawnedProcess.kill();
        // Force exit to close any open database connection pools or handles
        setTimeout(() => {
            process.exit(0);
        }, 500);
    }
}

runTests();
