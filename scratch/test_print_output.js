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
        console.log('--- Fetched rows count:', rows.length);
        
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

        console.log('\n--- FILE 2: Cash-Sale_03-VAT (Current logic) ---');
        const csvRows2Current = rows.map(r => {
            let cdms = {};
            if (r.raw_cdms_row) {
                try { cdms = JSON.parse(r.raw_cdms_row); } catch (e) {}
            }
            const getVal = (key, fallback = '') => {
                return (cdms[key] !== undefined && cdms[key] !== null) ? String(cdms[key]).trim() : String(fallback).trim();
            };
            const fallbackDate = formatDateForCsv(r.service_date);
            const shipmentno = getVal('ShipmentNo', r.tax_rec_id);
            const invoiceno = getVal('InvoiceNo', r.tax_rec_id);
            const invoicedate = getVal('InvoiceDate', fallbackDate);
            const vatremark = 'ขายเงินสดให้xx';
            const taxid = '';
            const brchname = '';
            const brchnameeng = '';
            const basevat = getVal('BaseVat', r.amount || '0');
            const vatrate = getVal('VatRate', '7');
            const vatamount = getVal('VatAmount', '0');
            return [
                clean(shipmentno), clean(invoiceno), clean(invoicedate), clean(vatremark), clean(taxid),
                clean(brchname), clean(brchnameeng), clean(basevat), clean(vatrate), clean(vatamount)
            ].join('|');
        });
        console.log(csvRows2Current.join('\n'));

        console.log('\n--- FILE 3: Cash-Sale_05-Transfer (Current logic) ---');
        const uniqueInvoicesMap = new Map();
        rows.forEach(r => {
            if (!uniqueInvoicesMap.has(r.tax_rec_id)) {
                uniqueInvoicesMap.set(r.tax_rec_id, r);
            }
        });
        const uniqueInvoices = Array.from(uniqueInvoicesMap.values());
        const csvRows3Current = uniqueInvoices.map(r => {
            let cdms = {};
            if (r.raw_cdms_row) {
                try { cdms = JSON.parse(r.raw_cdms_row); } catch (e) {}
            }
            const getVal = (key, fallback = '') => {
                return (cdms[key] !== undefined && cdms[key] !== null) ? String(cdms[key]).trim() : String(fallback).trim();
            };
            const fallbackDate = formatDateForCsv(r.service_date);
            const invoiceno = getVal('InvoiceNo', r.tax_rec_id);
            const bookcode = 'SA01';
            const bookno = '4902105005';
            const trandate = getVal('InvoiceDate', fallbackDate);
            const baseVatNum = parseFloat(getVal('BaseVat', r.amount || '0')) || 0;
            const vatAmtNum = parseFloat(getVal('VatAmount', '0')) || 0;
            const amount = (baseVatNum + vatAmtNum).toFixed(2);
            const remark = '';
            return [
                clean(invoiceno), clean(bookcode), clean(bookno), clean(trandate), clean(amount), clean(remark)
            ].join('|');
        });
        console.log(csvRows3Current.join('\n'));

    } catch (err) {
        console.error(err);
    } finally {
        await db.end();
    }
}

main();
