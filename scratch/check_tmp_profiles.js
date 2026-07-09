const mysql = require('mysql2/promise');
require('dotenv').config();

async function run() {
    const connection = await mysql.createConnection({
        host: process.env.DB_HOST || '127.0.0.1',
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || '',
        port: parseInt(process.env.DB_PORT || '3306', 10),
        multipleStatements: true
    });

    try {
        console.log('Listing databases...');
        const [databases] = await connection.query("SHOW DATABASES");
        console.log(databases);

        for (const dbObj of databases) {
            const dbName = Object.values(dbObj)[0];
            if (['information_schema', 'mysql', 'performance_schema', 'sys'].includes(dbName)) {
                continue;
            }
            console.log(`\nChecking database: ${dbName}...`);
            try {
                await connection.query(`USE \`${dbName}\``);
                const [tables] = await connection.query("SHOW TABLES");
                console.log(`Tables in ${dbName}:`, tables.map(t => Object.values(t)[0]));
                
                const hasCustProfile = tables.some(t => Object.values(t)[0] === 'customer_profile');
                if (hasCustProfile) {
                    console.log(`Found customer_profile table in ${dbName}! Querying records...`);
                    const [rows] = await connection.query("SELECT * FROM customer_profile");
                    console.log(`Total records in customer_profile: ${rows.length}`);
                    console.log('Sample profiles:', rows.slice(-10)); // show last 10 records
                }
            } catch (dbErr) {
                console.error(`Error checking database ${dbName}:`, dbErr.message);
            }
        }
    } catch (err) {
        console.error('Error during run:', err);
    } finally {
        await connection.end();
    }
}

run();
