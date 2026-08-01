const fs = require('fs');
const path = require('path');
const archiver = require('archiver');
const db = require('../src/db');

// Mock buildSearchQuery behaviour
function mockBuildSearchQuery() {
    // Return a query that fetches some completed customer profile invoices
    // We fetch any records where customer IS NOT NULL and is_accounting_exported = FALSE (or all)
    return {
        sql: `
            SELECT i.tax_rec_id, i.customer_num, i.service_date, i.status, i.is_accounting_exported
            FROM invoices i
            LEFT JOIN customer_profile p ON i.customer_num = p.customer_num
            WHERE p.customer_name IS NOT NULL
        `,
        params: []
    };
}

async function testExport() {
    try {
        console.log('Starting export verification test...');
        const { sql, params } = mockBuildSearchQuery();
        
        let exportSql = `
            SELECT 
                filtered.tax_rec_id, 
                filtered.customer_num, 
                filtered.service_date,
                ir.part_desc,
                ir.price,
                ir.unit_num,
                ir.amount,
                ir.raw_cdms_row
            FROM (${sql}) AS filtered 
            JOIN invoices_rec ir ON filtered.tax_rec_id = ir.tax_rec_id
        `;
        
        const [rows] = await db.query(exportSql, params);
        console.log(`Fetched ${rows.length} rows for testing.`);
        if (rows.length === 0) {
            console.log('No rows found. Please make sure there is some completed customer data in the DB.');
            process.exit(0);
        }

        // Helper cleaner
        const clean = (val) => {
            if (val === undefined || val === null) return '';
            return String(val).replace(/[\r\n]+/g, ' ').replace(/\|/g, '\\|');
        };

        const longDigits = `${Date.now()}_test`;

        const formatDateForCsv = (dateInput) => {
            if (!dateInput) return '';
            const d = new Date(dateInput);
            if (isNaN(d.getTime())) return String(dateInput);
            const dd = String(d.getDate()).padStart(2, '0');
            const mm = String(d.getMonth() + 1).padStart(2, '0');
            const yyyy = d.getFullYear();
            return `${dd}/${mm}/${yyyy}`;
        };

        // --- FILE 1 ---
        let csvContent1 = '\uFEFF';
        const headers1 = [
            'brchcode', 'shipmentno', 'shipmentdate', 'invoiceno', 'invoicedate',
            'customercode', 'customername', 'customerpo', 'creditstartdate', 'creditdays',
            'creditenddate', 'duedate', 'senddate', 'transpcode', 'salecode',
            'salename', 'partnumber', 'partname', 'inventory', 'location',
            'unit', 'qty', 'price', 'discount', 'amount',
            'jobcode', 'jobname', 'unitrate', 'vattype', 'sumgoodamount',
            'billdiscount', 'billafterdiscount', 'basevat', 'vatrate', 'vatamount',
            'netamount', 'vatcode', 'vatgroup', 'goodtype', 'fob',
            'stockflag', 'commission', 'incoterm', 'bookcode', 'bookno',
            'trandate', 'description'
        ].join('|');
        csvContent1 += headers1 + '\r\n';

        const csvRows1 = rows.map(r => {
            let cdms = {};
            if (r.raw_cdms_row) {
                try { cdms = JSON.parse(r.raw_cdms_row); } catch (e) {}
            }
            const getVal = (key, fallback = '') => {
                return (cdms[key] !== undefined && cdms[key] !== null) ? String(cdms[key]).trim() : String(fallback).trim();
            };

            let brchcode = '00000';
            const shipmentno = getVal('ShipmentNo', r.tax_rec_id);
            const fallbackDate = formatDateForCsv(r.service_date);
            const shipmentdate = getVal('ShipmentDate', fallbackDate);
            const invoiceno = getVal('InvoiceNo', r.tax_rec_id);
            const invoicedate = getVal('InvoiceDate', fallbackDate);
            const customercode = r.customer_num || '';
            const customername = 'TEST_COMPANY';
            const customerpo = '';
            const creditstartdate = '';
            const creditdays = '';
            const creditenddate = '';
            const duedate = '';
            const senddate = '';
            const transpcode = '';
            const salecode = '';
            const salename = '';
            const partnumber = getVal('PartNumber', '');
            const partname = getVal('PartName', r.part_desc || '');
            const inventory = getVal('Inventory', '');
            const location = getVal('Location', '');
            const unit = getVal('Unit', '');
            const qty = getVal('Qty', r.unit_num || '0');
            const price = getVal('Price', r.price || '0');
            const discount = '';
            const amount = getVal('Amount', r.amount || '0');
            const jobcode = '';
            const jobname = '';
            const unitrate = getVal('UnitRate', '1');
            const vattype = getVal('VatType', '');
            const sumgoodamount = getVal('BaseVat', r.amount || '0');
            const billdiscount = '';
            const billafterdiscount = getVal('BaseVat', r.amount || '0');
            const basevat = getVal('BaseVat', r.amount || '0');
            const vatrate = getVal('VatRate', '7');
            const vatamount = getVal('VatAmount', '0');

            const baseVatNum = parseFloat(getVal('BaseVat', r.amount || '0')) || 0;
            const vatAmtNum = parseFloat(getVal('VatAmount', '0')) || 0;
            const netamount = (baseVatNum + vatAmtNum).toFixed(2);

            const vatcode = getVal('VatCode', '');
            const vatgroup = getVal('VatGroup', '');
            const goodtype = getVal('GoodType', '');
            const fob = '';
            const stockflag = getVal('StockFlag', '');
            const commission = '';
            const incoterm = '';
            const bookcode = 'SA01';
            const bookno = '4902105005';
            const trandate = invoicedate;
            const description = '';

            return [
                clean(brchcode), clean(shipmentno), clean(shipmentdate), clean(invoiceno), clean(invoicedate),
                clean(customercode), clean(customername), clean(customerpo), clean(creditstartdate), clean(creditdays),
                clean(creditenddate), clean(duedate), clean(senddate), clean(transpcode), clean(salecode),
                clean(salename), clean(partnumber), clean(partname), clean(inventory), clean(location),
                clean(unit), clean(qty), clean(price), clean(discount), clean(amount),
                clean(jobcode), clean(jobname), clean(unitrate), clean(vattype), clean(sumgoodamount),
                clean(billdiscount), clean(billafterdiscount), clean(basevat), clean(vatrate), clean(vatamount),
                clean(netamount), clean(vatcode), clean(vatgroup), clean(goodtype), clean(fob),
                clean(stockflag), clean(commission), clean(incoterm), clean(bookcode), clean(bookno),
                clean(trandate), clean(description)
            ].join('|');
        }).join('\r\n');
        csvContent1 += csvRows1 + '\r\n';

        // Group rows by unique tax_rec_id for File 2 and File 3
        const uniqueInvoicesMap = new Map();
        rows.forEach(r => {
            if (!uniqueInvoicesMap.has(r.tax_rec_id)) {
                uniqueInvoicesMap.set(r.tax_rec_id, r);
            }
        });
        const uniqueInvoices = Array.from(uniqueInvoicesMap.values());

        // --- FILE 2 ---
        let csvContent2 = '\uFEFF';
        const headers2 = [
            'shipmentno', 'invoiceno', 'invoicedate', 'vatremark', 'taxid',
            'brchname', 'brchnameeng', 'basevat', 'vatrate', 'vatamount'
        ].join('|');
        csvContent2 += headers2 + '\r\n';

        const csvRows2 = uniqueInvoices.map(r => {
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
        }).join('\r\n');
        csvContent2 += csvRows2 + '\r\n';

        // --- FILE 3 ---
        let csvContent3 = '\uFEFF';
        const headers3 = [
            'invoiceno', 'bookcode', 'bookno', 'trandate', 'amount', 'remark'
        ].join('|');
        csvContent3 += headers3 + '\r\n';

        const csvRows3 = uniqueInvoices.map(r => {
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
        }).join('\r\n');
        csvContent3 += csvRows3 + '\r\n';

        // Verify CSV header counts
        console.log('Verifying column counts...');
        const cols1 = headers1.split('|').length;
        const cols2 = headers2.split('|').length;
        const cols3 = headers3.split('|').length;
        console.log(`File 1 headers: ${cols1} (Expected: 47)`);
        console.log(`File 2 headers: ${cols2} (Expected: 10)`);
        console.log(`File 3 headers: ${cols3} (Expected: 6)`);
        
        if (cols1 !== 47 || cols2 !== 10 || cols3 !== 6) {
            console.error('❌ Mismatch in column count!');
            process.exit(1);
        }

        // Test writing ZIP file
        const zipPath = path.join(__dirname, 'test_export_output.zip');
        const outputStream = fs.createWriteStream(zipPath);
        const archive = new archiver.ZipArchive({ zlib: { level: 9 } });
        
        archive.pipe(outputStream);
        archive.append(csvContent1, { name: `Cash-Sale_01-Detail_${longDigits}.csv` });
        archive.append(csvContent2, { name: `Cash-Sale_03-VAT_${longDigits}.csv` });
        archive.append(csvContent3, { name: `Cash-Sale_05-Transfer_${longDigits}.csv` });
        
        await archive.finalize();
        
        console.log(`✅ Test ZIP file written successfully: ${zipPath}`);
        
    } catch (err) {
        console.error('❌ Test failed:', err);
    } finally {
        await db.end();
    }
}

testExport();
