const mysql = require('mysql2/promise');
require('dotenv').config();

async function run() {
    const connection = await mysql.createConnection({
        host: process.env.DB_HOST || '127.0.0.1',
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || '',
        database: process.env.DB_NAME || 'ftr_db'
    });

    try {
        console.log('Querying invoices_rec for RF2606-03460...');
        const [rows] = await connection.execute(
            'SELECT * FROM invoices_rec WHERE tax_rec_id = ?',
            ['RF2606-03460']
        );
        console.log('Results in invoices_rec:', JSON.stringify(rows, null, 2));

        const [inv] = await connection.execute(
            'SELECT * FROM invoices WHERE tax_rec_id = ?',
            ['RF2606-03460']
        );
        console.log('Results in invoices:', JSON.stringify(inv, null, 2));
    } catch (err) {
        console.error(err);
    } finally {
        await connection.end();
    }
}

run();
