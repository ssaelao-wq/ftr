const db = require('../src/db');

async function main() {
    try {
        console.log("=== TABLES SCHEMAS ===");
        const [tables] = await db.query("SHOW TABLES");
        console.log("Tables:", tables.map(t => Object.values(t)[0]));

        for (const t of ['invoices', 'customer_profile', 'activity_logs', 'generated_documents']) {
            console.log(`\n--- SCHEMA OF ${t} ---`);
            const [cols] = await db.query(`DESCRIBE ${t}`);
            console.table(cols.map(c => ({ Field: c.Field, Type: c.Type, Null: c.Null, Key: c.Key })));
        }

        console.log("\n=== ALL INVOICES ===");
        const [invs] = await db.query("SELECT * FROM invoices");
        console.table(invs);

        console.log("\n=== ALL CUSTOMER PROFILES ===");
        const [profs] = await db.query("SELECT * FROM customer_profile");
        console.table(profs);

        console.log("\n=== ACTIVITY LOGS ===");
        const [logs] = await db.query("SELECT * FROM activity_logs LIMIT 50");
        console.table(logs);

    } catch (err) {
        console.error(err);
    } finally {
        process.exit(0);
    }
}

main();
