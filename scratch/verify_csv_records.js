const db = require('../src/db');

async function main() {
    try {
        const sql = `
            SELECT i.tax_rec_id, p.tax_id, p.customer_branch, i.container_num, i.service_date, i.status, i.is_accounting_exported,
                   p.customer_name AS company_name, p.customer_addr AS address, p.customer_num AS customer_code
            FROM invoices i
            LEFT JOIN customer_profile p ON i.customer_num = p.customer_num
            WHERE p.customer_name IS NOT NULL
        `;
        let exportSql = `
            SELECT 
                filtered.tax_rec_id, 
                filtered.customer_code, 
                filtered.company_name, 
                filtered.address, 
                filtered.tax_id,
                filtered.customer_branch,
                filtered.service_date,
                ir.part_desc,
                ir.price,
                ir.unit_num,
                ir.amount,
                ir.raw_cdms_row
            FROM (${sql}) AS filtered 
            JOIN invoices_rec ir ON filtered.tax_rec_id = ir.tax_rec_id
        `;
        const [rows] = await db.query(exportSql);
        
        // Group rows by unique tax_rec_id
        const uniqueInvoicesMap = new Map();
        rows.forEach(r => {
            if (!uniqueInvoicesMap.has(r.tax_rec_id)) {
                uniqueInvoicesMap.set(r.tax_rec_id, r);
            }
        });
        const uniqueInvoices = Array.from(uniqueInvoicesMap.values());

        const clean = (val) => {
            if (val === undefined || val === null) return '';
            return String(val).replace(/[\r\n]+/g, ' ').replace(/\|/g, '\\|');
        };

        const formatDateForCsv = (dateInput) => {
            if (!dateInput) return '';
            const d = new Date(dateInput);
            if (isNaN(d.getTime())) return String(dateInput);
            const dd = String(d.getDate()).padStart(2, '0');
            const mm = String(d.getMonth() + 1).padStart(2, '0');
            const yyyy = d.getFullYear();
            return `${dd}/${mm}/${yyyy}`;
        };

        // Generating CSV 1 (rows mapping)
        const csvRows1 = rows.map(r => r.tax_rec_id); // we just care about line count
        
        // Generating CSV 2 (uniqueInvoices mapping)
        const csvRows2 = uniqueInvoices.map(r => {
            let cdms = {};
            if (r.raw_cdms_row) {
                try { cdms = JSON.parse(r.raw_cdms_row); } catch (e) {}
            }
            const getVal = (key, fallback = '') => {
                return (cdms[key] !== undefined && cdms[key] !== null) ? String(cdms[key]).trim() : String(fallback).trim();
            };
            const fallbackDate = formatDateForCsv(r.service_date);
            return [
                clean(getVal('ShipmentNo', r.tax_rec_id)),
                clean(getVal('InvoiceNo', r.tax_rec_id))
            ].join('|');
        });

        // Generating CSV 3 (uniqueInvoices mapping)
        const csvRows3 = uniqueInvoices.map(r => r.tax_rec_id);

        console.log(`File 1 Detail Rows: ${csvRows1.length}`);
        console.log(`File 2 VAT Rows: ${csvRows2.length}`);
        console.log(`File 3 Transfer Rows: ${csvRows3.length}`);

        if (csvRows1.length !== 2) {
            throw new Error(`File 1 should have 2 rows, but has ${csvRows1.length}`);
        }
        if (csvRows2.length !== 1) {
            throw new Error(`File 2 should have 1 row, but has ${csvRows2.length}`);
        }
        if (csvRows3.length !== 1) {
            throw new Error(`File 3 should have 1 row, but has ${csvRows3.length}`);
        }

        console.log('✅ CSV records logic verified successfully!');

    } catch (err) {
        console.error('❌ Verification failed:', err);
        process.exit(1);
    } finally {
        await db.end();
    }
}

main();
