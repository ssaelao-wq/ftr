const mysql = require('mysql2/promise');
const { generatePdf } = require('../src/services/pdfService');
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
        console.log('Scanning database for outdated PDFs...');
        
        // Find invoices that were updated after their PDFs were generated
        const query = `
            SELECT i.tax_rec_id, i.customer_num, cp.customer_name, cp.tax_id, 
                   i.updated_at AS invoice_updated, gd.generated_at AS pdf_generated
            FROM invoices i
            JOIN generated_documents gd ON i.tax_rec_id = gd.tax_rec_id
            LEFT JOIN customer_profile cp ON i.customer_num = cp.customer_num
            WHERE i.updated_at > gd.generated_at
            ORDER BY i.updated_at DESC
        `;
        
        const [rows] = await connection.query(query);

        if (rows.length === 0) {
            console.log('\n✅ No outdated PDFs found! All PDFs are up-to-date with their invoice database records.');
            return;
        }

        console.log(`\nFound ${rows.length} records where the invoice was updated AFTER the PDF was generated:`);
        console.log('------------------------------------------------------------------------------------------------------');
        console.log(String('TAX REC ID').padEnd(15) + ' | ' + 
                    String('CUST NUM').padEnd(12) + ' | ' + 
                    String('TAX ID').padEnd(15) + ' | ' + 
                    String('INVOICE UPDATED').padEnd(20) + ' | ' + 
                    String('PDF GENERATED').padEnd(20));
        console.log('------------------------------------------------------------------------------------------------------');
        
        for (const row of rows) {
            console.log(
                String(row.tax_rec_id).padEnd(15) + ' | ' + 
                String(row.customer_num).padEnd(12) + ' | ' + 
                String(row.tax_id || 'N/A').padEnd(15) + ' | ' + 
                String(row.invoice_updated ? new Date(row.invoice_updated).toLocaleString('th-TH') : 'N/A').padEnd(20) + ' | ' + 
                String(row.pdf_generated ? new Date(row.pdf_generated).toLocaleString('th-TH') : 'N/A').padEnd(20)
            );
        }
        console.log('------------------------------------------------------------------------------------------------------');
        
        const args = process.argv.slice(2);
        if (args.includes('--run')) {
            console.log('\nStarting regeneration process...');
            for (const row of rows) {
                try {
                    console.log(`Regenerating PDF for ${row.tax_rec_id}...`);
                    await generatePdf(row.tax_rec_id);
                    console.log(`✅ Success for ${row.tax_rec_id}`);
                } catch (pdfErr) {
                    console.error(`❌ Failed for ${row.tax_rec_id}:`, pdfErr.message);
                }
            }
            console.log('\nRegeneration process completed!');
        } else {
            console.log('\n💡 Tip: To automatically regenerate all these PDFs, run this script with the --run flag:');
            console.log('   node scratch/find_outdated_pdfs.js --run');
            console.log('   (or docker exec ftr-app node /app/scratch/find_outdated_pdfs.js --run)');
        }

    } catch (err) {
        console.error('Error during execution:', err);
    } finally {
        await connection.end();
    }
}

run();
