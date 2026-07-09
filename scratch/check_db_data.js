const mysql = require('mysql2/promise');
require('dotenv').config();

async function run() {
    const connection = await mysql.createConnection({
        host: process.env.DB_HOST || '127.0.0.1',
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || '',
        database: process.env.DB_NAME || 'ftr_db',
        port: parseInt(process.env.DB_PORT || '3306', 10)
    });

    try {
        console.log('Connected to DB:', process.env.DB_NAME);
        const [tables] = await connection.query("SHOW TABLES");
        for (const row of tables) {
            const tableName = Object.values(row)[0];
            console.log(`\n--- TABLE: ${tableName} ---`);
            const [columns] = await connection.query(`DESCRIBE \`${tableName}\``);
            console.log('Columns:', columns.map(c => `${c.Field} (${c.Type})`));
            
            const [data] = await connection.query(`SELECT * FROM \`${tableName}\` LIMIT 20`);
            console.log(`Rows count (sample size): ${data.length}`);
            if (data.length > 0) {
                console.log('Sample rows:', data);
            }
        }
    } catch (err) {
        console.error('Error:', err);
    } finally {
        await connection.end();
    }
}

run();
