const db = require('../src/db');
const { generatePdf } = require('../src/services/pdfService');

async function testPdfGen() {
    try {
        // Find recent invoices
        const [rows] = await db.query(`
            SELECT i.tax_rec_id, i.customer_num, i.status, p.customer_name, p.customer_addr, p.tax_id
            FROM invoices i
            LEFT JOIN customer_profile p ON i.customer_num = p.customer_num
            ORDER BY i.created_at DESC
            LIMIT 10
        `);

        console.log("Recent Invoices:");
        console.table(rows);

        for (const row of rows) {
            console.log(`\nTesting PDF gen for ${row.tax_rec_id}...`);
            try {
                const pdfUrl = await generatePdf(row.tax_rec_id);
                console.log(`✅ SUCCESS: ${pdfUrl}`);
            } catch (err) {
                console.error(`❌ FAILED for ${row.tax_rec_id}:`, err.message, err.stack);
            }
        }
    } catch (err) {
        console.error("Test error:", err);
    } finally {
        process.exit(0);
    }
}

testPdfGen();
