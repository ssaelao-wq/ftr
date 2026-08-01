const db = require('../src/db');

async function main() {
    try {
        const [rows] = await db.query(`
            SELECT i.tax_rec_id, i.customer_num, i.status, i.service_date, i.created_at,
                   p.customer_name, p.customer_addr, p.tax_id, p.customer_branch
            FROM invoices i
            LEFT JOIN customer_profile p ON i.customer_num = p.customer_num
            ORDER BY i.created_at DESC
            LIMIT 30
        `);
        console.log("Recent Invoices (Latest 30):");
        console.table(rows.map(r => ({
            tax_rec_id: r.tax_rec_id,
            customer_num: r.customer_num,
            status: r.status,
            name: r.customer_name ? r.customer_name.substring(0, 15) : 'NULL',
            addr: r.customer_addr ? r.customer_addr.substring(0, 15) : 'NULL',
            tax_id: r.tax_id || 'NULL',
            created_at: r.created_at
        })));

        const [incompleteCount] = await db.query(`
            SELECT COUNT(*) AS count
            FROM invoices i
            LEFT JOIN customer_profile p ON i.customer_num = p.customer_num
            WHERE i.status = 'pending' AND (p.customer_name IS NULL OR p.customer_addr IS NULL OR p.tax_id IS NULL)
        `);
        console.log("\nTotal Incomplete Invoices count:", incompleteCount[0].count);

        const [nullCustomerNum] = await db.query(`
            SELECT COUNT(*) AS count
            FROM invoices
            WHERE customer_num IS NULL OR customer_num = ''
        `);
        console.log("Invoices with NULL/empty customer_num:", nullCustomerNum[0].count);

    } catch (err) {
        console.error(err);
    } finally {
        process.exit(0);
    }
}

main();
