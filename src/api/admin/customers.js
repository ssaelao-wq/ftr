const express = require('express');
const router = express.Router();
const path = require('path');
const archiver = require('archiver');
const db = require('../../db');
const { logActivity } = require('../../logger');
const { getBKKDate, formatBKKDateISO } = require('../../utils/timezone');
const { generatePdf } = require('../../services/pdfService');
const { sendInvoiceEmail } = require('../../services/emailService');
const { generateUniqueTmpCustomerNum } = require('../../utils/customer');

// GET /api/admin/customers/stats
router.get('/stats', async (req, res) => {
    try {
        const [pendingRows] = await db.query(`
            SELECT COUNT(*) AS count 
            FROM invoices i
            LEFT JOIN customer_profile p ON i.customer_num = p.customer_num
            WHERE i.customer_num IS NULL 
               OR p.customer_name IS NULL 
               OR p.customer_addr IS NULL
        `);
        const [readyExportRows] = await db.query(`
            SELECT COUNT(*) AS count 
            FROM invoices i
            JOIN customer_profile p ON i.customer_num = p.customer_num
            WHERE p.customer_name IS NOT NULL 
              AND p.customer_addr IS NOT NULL 
              AND i.is_accounting_exported = FALSE
        `);
        const [newCustomerRows] = await db.query(`
            SELECT COUNT(*) AS count 
            FROM customer_profile 
            WHERE customer_num LIKE 'TMP-%'
        `);
        const [pendingPdfRows] = await db.query(`
            SELECT COUNT(*) AS count 
            FROM invoices i
            JOIN customer_profile p ON i.customer_num = p.customer_num
            WHERE p.customer_name IS NOT NULL 
              AND p.customer_addr IS NOT NULL 
              AND i.status != 'ready'
        `);

        res.json({
            success: true,
            stats: {
                pending: pendingRows[0].count,
                readyExport: readyExportRows[0].count,
                newCustomerData: newCustomerRows[0].count,
                pendingPdf: pendingPdfRows[0].count
            }
        });
    } catch (error) {
        console.error('Stats query error:', error);
        res.status(500).json({ success: false, message: 'Internal server error during stats lookup.' });
    }
});


// Helper to build dynamic sql query from filters
function buildSearchQuery(queryParams) {
    const { tax_rec_id, customer, address, tax_id, date_from, date_to, is_accounting_exported, status, pdf_status } = queryParams;
    let sql = `
        SELECT i.tax_rec_id, p.tax_id, p.customer_branch, i.container_num, i.service_date, i.status, i.is_accounting_exported, i.created_at, i.updated_at,
               p.customer_name AS customer, p.customer_addr, p.customer_num AS customer_code
        FROM invoices i
        LEFT JOIN customer_profile p ON i.customer_num = p.customer_num
        WHERE 1=1
    `;
    const params = [];

    if (tax_rec_id) {
        sql += ' AND i.tax_rec_id LIKE ?';
        params.push(`%${tax_rec_id}%`);
    }
    if (customer) {
        sql += ' AND (p.customer_name LIKE ? OR p.customer_num LIKE ?)';
        params.push(`%${customer}%`, `%${customer}%`);
    }
    if (address) {
        sql += ' AND p.customer_addr LIKE ?';
        params.push(`%${address}%`);
    }
    if (tax_id) {
        sql += ' AND p.tax_id = ?';
        params.push(tax_id);
    }
    if (date_from) {
        sql += ' AND i.service_date >= ?';
        params.push(date_from);
    }
    if (date_to) {
        sql += ' AND i.service_date <= ?';
        params.push(date_to);
    }
    if (is_accounting_exported !== undefined && is_accounting_exported !== 'all') {
        const flag = is_accounting_exported === 'true' || is_accounting_exported === '1';
        sql += ' AND i.is_accounting_exported = ?';
        params.push(flag);
    }
    const finalStatus = status || pdf_status;
    if (finalStatus && finalStatus !== 'all') {
        if (finalStatus === 'incomplete') {
            sql += " AND i.status = 'pending' AND (p.customer_name IS NULL OR p.customer_addr IS NULL OR p.tax_id IS NULL)";
        } else if (finalStatus === 'pending') {
            sql += " AND i.status = 'pending' AND p.customer_name IS NOT NULL AND p.customer_addr IS NOT NULL AND p.tax_id IS NOT NULL";
        } else {
            sql += ' AND i.status = ?';
            params.push(finalStatus);
        }
    }

    return { sql, params };
}

// GET /api/admin/customers/search
router.get('/search', async (req, res) => {
    let page = parseInt(req.query.page, 10) || 1;
    if (page < 1) page = 1;
    const limit = 50;
    const offset = (page - 1) * limit;

    try {
        const { sql, params } = buildSearchQuery(req.query);
        
        // Count query
        const countSql = `SELECT COUNT(*) AS count FROM (${sql}) AS temp_count`;
        const [countRows] = await db.query(countSql, params);
        const totalCustomers = countRows[0].count;
        const totalPages = Math.ceil(totalCustomers / limit);

        const orderSql = `${sql} ORDER BY i.tax_rec_id DESC LIMIT ? OFFSET ?`;
        const [rows] = await db.query(orderSql, [...params, limit, offset]);

        res.json({
            success: true,
            customers: rows,
            pagination: {
                currentPage: page,
                totalPages: totalPages || 1,
                totalCustomers: totalCustomers,
                limit: limit
            }
        });
    } catch (error) {
        console.error('Customer search error:', error);
        res.status(500).json({ success: false, message: 'Internal server error during customer search.' });
    }
});

// PUT /api/admin/customers/:tax_rec_id
router.put('/:tax_rec_id', async (req, res) => {
    const { tax_rec_id } = req.params;
    const { customer, company_name, address, tax_id, customer_branch, container_num, customer_num } = req.body;
    const finalCustomer = customer || company_name;
    const finalBranch = customer_branch || 'สำนักงานใหญ่';
    const username = req.session.adminUser ? req.session.adminUser.username : 'system';

    if (!finalCustomer || !address || !tax_id) {
        return res.status(400).json({ success: false, message: 'Customer Name, Address, and Tax ID are required.' });
    }

    const connection = await db.getConnection();
    let transactionStarted = false;
    try {
        await connection.beginTransaction();
        transactionStarted = true;

        // 1. Validate invoice record exists
        const [invoiceRows] = await connection.execute(
            'SELECT tax_rec_id, customer_num FROM invoices WHERE tax_rec_id = ?',
            [tax_rec_id]
        );
        if (invoiceRows.length === 0) {
            connection.release();
            return res.status(404).json({ success: false, message: 'Tax record not found.' });
        }

        const currentCustomerNum = invoiceRows[0].customer_num;

        // 2. Check if a profile with the customer_num already exists
        const lookupCustomerNum = (customer_num && customer_num.trim()) ? customer_num.trim() : (currentCustomerNum && currentCustomerNum.trim() ? currentCustomerNum.trim() : null);

        let existingProfile = null;
        if (lookupCustomerNum && lookupCustomerNum !== 'TMP-00000' && lookupCustomerNum !== 'TMP-XXXXXX') {
            const [profileRows] = await connection.execute(
                'SELECT customer_num, customer_name, customer_addr, tax_id, customer_branch FROM customer_profile WHERE customer_num = ? LIMIT 1',
                [lookupCustomerNum]
            );
            if (profileRows.length > 0) {
                existingProfile = profileRows[0];
            }
        }

        let targetCustomerNum;
        let profileChangeLog = null;

        if (existingProfile) {
            // Check if name, address, tax_id, or branch has changed
            const nameChanged = (existingProfile.customer_name || '').trim() !== finalCustomer.trim();
            const addrChanged = (existingProfile.customer_addr || '').trim() !== address.trim();
            const taxIdChanged = (existingProfile.tax_id || '').trim() !== tax_id.trim();
            const branchChanged = (existingProfile.customer_branch || '').trim() !== finalBranch.trim();

            if (nameChanged || addrChanged || taxIdChanged || branchChanged) {
                // Update the existing profile record in-place by customer_num
                await connection.execute(
                    `UPDATE customer_profile
                     SET customer_name = ?, customer_addr = ?, tax_id = ?, customer_branch = ?, is_accounting_exported = FALSE
                     WHERE customer_num = ?`,
                    [
                        finalCustomer.trim(),
                        address.trim(),
                        tax_id.trim(),
                        finalBranch.trim(),
                        existingProfile.customer_num
                    ]
                );

                profileChangeLog = `Code: ${existingProfile.customer_num} | Existing: {TaxID: "${existingProfile.tax_id || ''}", Name: "${existingProfile.customer_name || ''}", Addr: "${existingProfile.customer_addr || ''}", Branch: "${existingProfile.customer_branch || ''}"} -> Updated to: {TaxID: "${tax_id.trim()}", Name: "${finalCustomer.trim()}", Addr: "${address.trim()}", Branch: "${finalBranch.trim()}"} (via invoice ${tax_rec_id})`;
            }
            targetCustomerNum = existingProfile.customer_num;
        } else {
            // No profile exists or it was a placeholder/not supplied: Create a new profile record
            // Generate a brand new unique 6-digit TMP- customer_num
            targetCustomerNum = await generateUniqueTmpCustomerNum(connection);

            await connection.execute(
                `INSERT INTO customer_profile
                 (tax_id, customer_num, customer_name, customer_addr, customer_branch, is_accounting_exported)
                 VALUES (?, ?, ?, ?, ?, FALSE)`,
                [
                    tax_id.trim(),
                    targetCustomerNum,
                    finalCustomer.trim(),
                    address.trim(),
                    finalBranch.trim()
                ]
            );

            profileChangeLog = `Code: ${targetCustomerNum} | New profile created: {TaxID: "${tax_id.trim()}", Name: "${finalCustomer.trim()}", Addr: "${address.trim()}", Branch: "${finalBranch.trim()}"} (via invoice ${tax_rec_id})`;
        }

        // 3. Update the invoice record with the targetCustomerNum, container_num, and status
        const customerNumChanged = (currentCustomerNum || '') !== targetCustomerNum;
        await connection.execute(
            `UPDATE invoices
             SET customer_num = ?,
                 container_num = COALESCE(?, container_num),
                 status = IF(status = 'ready', 'ready', 'pending'),
                 is_accounting_exported = FALSE
             WHERE tax_rec_id = ?`,
            [
                targetCustomerNum,
                container_num && container_num.trim() ? container_num.trim() : null,
                tax_rec_id
            ]
        );

        await connection.commit();

        if (customerNumChanged) {
            await logActivity('EDIT_CUSTOMER', `Invoice ${tax_rec_id} relinked: customer_num "${currentCustomerNum || '(none)'}" -> "${targetCustomerNum}"`, username);
        }
        if (profileChangeLog) {
            await logActivity('EDIT_CUSTOMER', profileChangeLog, username);
        }

        res.json({ success: true, message: 'Invoice customer link and profile updated successfully.' });
    } catch (error) {
        if (transactionStarted) {
            await connection.rollback().catch(() => {});
        }
        console.error('Invoice customer update error:', error);
        res.status(500).json({ success: false, message: 'Internal server error during invoice customer update.' });
    } finally {
        connection.release();
    }
});

// POST /api/admin/customers/export
// Generates outbound CSV file for results matching current query, restricted to completed profiles
router.post('/export', async (req, res) => {
    const username = req.session.adminUser ? req.session.adminUser.username : 'system';
    
    try {
        // 1. Build query from request filters
        const { sql, params } = buildSearchQuery(req.body);
        
        // 2. We only export records that have complete profiles
        // 2. We only export records that have complete profiles, joining with invoices_rec to obtain item details and raw_cdms_row
        let exportSql = `
            SELECT 
                filtered.tax_rec_id, 
                filtered.customer_code, 
                filtered.customer AS company_name, 
                filtered.customer_addr AS address, 
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
            WHERE filtered.customer IS NOT NULL AND filtered.customer_addr IS NOT NULL AND filtered.tax_id IS NOT NULL
        `;
        
        const [rows] = await db.query(exportSql, params);

        if (rows.length === 0) {
            return res.status(400).json({ success: false, message: 'No completed customer profiles match the filter criteria for export.' });
        }

        // 3. Generate three CSV contents with UTF-8 BOM
        const clean = (val) => {
            if (val === undefined || val === null) return '';
            return String(val).replace(/[\r\n]+/g, ' ').replace(/\|/g, '\\|');
        };

        const longDigits = `${Date.now()}_${Math.floor(Math.random() * 1000)}`;

        const formatDateForCsv = (dateInput) => {
            if (!dateInput) return '';
            const d = new Date(dateInput);
            if (isNaN(d.getTime())) return String(dateInput);
            const dd = String(d.getDate()).padStart(2, '0');
            const mm = String(d.getMonth() + 1).padStart(2, '0');
            const yyyy = d.getFullYear();
            return `${dd}/${mm}/${yyyy}`;
        };

        // --- FILE 1: Cash-Sale_01-Detail ---
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
                try {
                    cdms = JSON.parse(r.raw_cdms_row);
                } catch (e) {
                    console.error('Failed to parse raw_cdms_row JSON:', e);
                }
            }

            const getVal = (cdmsKey, fallbackVal = '') => {
                return (cdms[cdmsKey] !== undefined && cdms[cdmsKey] !== null) ? String(cdms[cdmsKey]).trim() : String(fallbackVal).trim();
            };

            let brchcode = '00000';
            if (r.customer_branch && 
                r.customer_branch.trim() !== 'สำนักงานใหญ่' && 
                r.customer_branch.trim().toUpperCase() !== 'HEAD OFFICE') {
                brchcode = r.customer_branch.trim();
            }

            const shipmentno = getVal('ShipmentNo', r.tax_rec_id);
            const fallbackDate = formatDateForCsv(r.service_date);
            const shipmentdate = getVal('ShipmentDate', fallbackDate);
            const invoiceno = getVal('InvoiceNo', r.tax_rec_id);
            const invoicedate = getVal('InvoiceDate', fallbackDate);
            const customercode = r.customer_code || '';
            const customername = r.company_name || '';
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
                clean(brchcode),
                clean(shipmentno),
                clean(shipmentdate),
                clean(invoiceno),
                clean(invoicedate),
                clean(customercode),
                clean(customername),
                clean(customerpo),
                clean(creditstartdate),
                clean(creditdays),
                clean(creditenddate),
                clean(duedate),
                clean(senddate),
                clean(transpcode),
                clean(salecode),
                clean(salename),
                clean(partnumber),
                clean(partname),
                clean(inventory),
                clean(location),
                clean(unit),
                clean(qty),
                clean(price),
                clean(discount),
                clean(amount),
                clean(jobcode),
                clean(jobname),
                clean(unitrate),
                clean(vattype),
                clean(sumgoodamount),
                clean(billdiscount),
                clean(billafterdiscount),
                clean(basevat),
                clean(vatrate),
                clean(vatamount),
                clean(netamount),
                clean(vatcode),
                clean(vatgroup),
                clean(goodtype),
                clean(fob),
                clean(stockflag),
                clean(commission),
                clean(incoterm),
                clean(bookcode),
                clean(bookno),
                clean(trandate),
                clean(description)
            ].join('|');
        }).join('\r\n');
        csvContent1 += csvRows1 + '\r\n';

        // Group rows by unique tax_rec_id for File 2 (Cash-Sale_03-VAT) and File 3 (Cash-Sale_05-Transfer)
        const uniqueInvoicesMap = new Map();
        rows.forEach(r => {
            if (!uniqueInvoicesMap.has(r.tax_rec_id)) {
                uniqueInvoicesMap.set(r.tax_rec_id, r);
            }
        });
        const uniqueInvoices = Array.from(uniqueInvoicesMap.values());

        // --- FILE 2: Cash-Sale_03-VAT ---
        let csvContent2 = '\uFEFF';
        const headers2 = [
            'shipmentno', 'invoiceno', 'invoicedate', 'vatremark', 'taxid',
            'brchname', 'brchnameeng', 'basevat', 'vatrate', 'vatamount'
        ].join('|');
        csvContent2 += headers2 + '\r\n';

        const csvRows2 = uniqueInvoices.map(r => {
            let cdms = {};
            if (r.raw_cdms_row) {
                try {
                    cdms = JSON.parse(r.raw_cdms_row);
                } catch (e) {
                    console.error('Failed to parse raw_cdms_row JSON:', e);
                }
            }

            const getVal = (cdmsKey, fallbackVal = '') => {
                return (cdms[cdmsKey] !== undefined && cdms[cdmsKey] !== null) ? String(cdms[cdmsKey]).trim() : String(fallbackVal).trim();
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
                clean(shipmentno),
                clean(invoiceno),
                clean(invoicedate),
                clean(vatremark),
                clean(taxid),
                clean(brchname),
                clean(brchnameeng),
                clean(basevat),
                clean(vatrate),
                clean(vatamount)
            ].join('|');
        }).join('\r\n');
        csvContent2 += csvRows2 + '\r\n';

        // --- FILE 3: Cash-Sale_05-Transfer ---
        let csvContent3 = '\uFEFF';
        const headers3 = [
            'invoiceno', 'bookcode', 'bookno', 'trandate', 'amount', 'remark'
        ].join('|');
        csvContent3 += headers3 + '\r\n';

        const csvRows3 = uniqueInvoices.map(r => {
            let cdms = {};
            if (r.raw_cdms_row) {
                try {
                    cdms = JSON.parse(r.raw_cdms_row);
                } catch (e) {
                    console.error('Failed to parse raw_cdms_row JSON:', e);
                }
            }

            const getVal = (cdmsKey, fallbackVal = '') => {
                return (cdms[cdmsKey] !== undefined && cdms[cdmsKey] !== null) ? String(cdms[cdmsKey]).trim() : String(fallbackVal).trim();
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
                clean(invoiceno),
                clean(bookcode),
                clean(bookno),
                clean(trandate),
                clean(amount),
                clean(remark)
            ].join('|');
        }).join('\r\n');
        csvContent3 += csvRows3 + '\r\n';

        // 4. Update the database flag is_accounting_exported = TRUE inside a transaction (using unique IDs)
        const taxRecIds = [...new Set(rows.map(r => r.tax_rec_id))];
        
        const connection = await db.getConnection();
        let transactionStarted = false;
        try {
            await connection.beginTransaction();
            transactionStarted = true;
            await connection.query(
                'UPDATE invoices SET is_accounting_exported = TRUE WHERE tax_rec_id IN (?)',
                [taxRecIds]
            );
            await connection.commit();
        } catch (txErr) {
            if (transactionStarted) {
                await connection.rollback().catch(() => {});
            }
            throw txErr;
        } finally {
            connection.release();
        }

        // 5. Log download activity (Non-blocking)
        await logActivity('REQ_DOWNLOAD_MISS', `${username}:${taxRecIds.length}`, username);

        // 6. Return file download ZIP stream
        const zipFilename = `invoice_data_${formatBKKDateISO().replace(/-/g,'')}_${Date.now()}.zip`;
        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', `attachment; filename=${zipFilename}`);

        const archive = new archiver.ZipArchive({ zlib: { level: 9 } });
        
        archive.on('warning', (err) => {
            if (err.code === 'ENOENT') {
                console.warn('Archiver warning:', err);
            } else {
                throw err;
            }
        });
        
        archive.on('error', (err) => {
            console.error('Archiver error:', err);
            res.status(500).end();
        });

        archive.pipe(res);

        archive.append(csvContent1, { name: `Cash-Sale_01-Detail_${longDigits}.csv` });
        archive.append(csvContent2, { name: `Cash-Sale_03-VAT_${longDigits}.csv` });
        archive.append(csvContent3, { name: `Cash-Sale_05-Transfer_${longDigits}.csv` });

        await archive.finalize();

    } catch (error) {
        console.error('CSV export error:', error);
        res.status(500).json({ success: false, message: 'Internal server error during CSV export.' });
    }
});

// POST /api/admin/customers/:tax_rec_id/generate-pdf
router.post('/:tax_rec_id/generate-pdf', async (req, res) => {
    const { tax_rec_id } = req.params;
    
    try {
        // 1. Fetch invoice record with customer details
        const [rows] = await db.execute(`
            SELECT i.tax_rec_id, p.tax_id, p.customer_branch, i.status,
                   p.customer_name AS customer, p.customer_addr AS customer_addr
            FROM invoices i
            LEFT JOIN customer_profile p ON i.customer_num = p.customer_num
            WHERE i.tax_rec_id = ?
        `, [tax_rec_id]);
        if (rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Tax record not found.' });
        }
        
        const record = rows[0];
        
        // 2. Validate completeness of the profile
        if (!record.customer || !record.customer_addr || !record.tax_id) {
            return res.status(400).json({ success: false, message: 'Some missing data: company name, address, tax id' });
        }
        
        const username = req.session.adminUser ? req.session.adminUser.username : 'system';

        // 3. Generate PDF (overwrites and updates DB status/timestamp)
        const generatedPdfUrl = await generatePdf(tax_rec_id);
        
        // 4. Log generation activity
        await logActivity('ONTHEFLY_GEN_PDF', `${tax_rec_id}:${record.tax_id}:admin:${generatedPdfUrl}`, username);
        
        res.json({ success: true, message: 'PDF generated successfully.', pdf_url: generatedPdfUrl });
        
    } catch (error) {
        console.error('Manual PDF generation error:', error);
        res.status(500).json({ success: false, message: `Failed to generate PDF: ${error.message || 'Internal server error'}` });
    }
});

// GET /api/admin/customers/:tax_rec_id/download-pdf
router.get('/:tax_rec_id/download-pdf', async (req, res) => {
    const { tax_rec_id } = req.params;
    
    try {
        // 1. Check if document entry exists
        const [pdfRows] = await db.execute('SELECT pdf_folder FROM generated_documents WHERE tax_rec_id = ?', [tax_rec_id]);
        if (pdfRows.length === 0) {
            return res.status(404).json({ success: false, message: 'PDF file not generated yet.' });
        }
        
        const relativePdfPath = pdfRows[0].pdf_folder;
        // 2. Resolve absolute path relative to the project root (src/api/admin is two subfolders deep from project root)
        const absolutePdfPath = path.join(__dirname, '../../..', relativePdfPath);
        
        // 3. Log the download activity (non-blocking or handled within try-catch)
        const username = req.session.adminUser ? req.session.adminUser.username : 'system';
        await logActivity('DOWNLOAD_PDF', relativePdfPath, username);

        // 4. Send file download stream
        res.download(absolutePdfPath, `Unicon_${tax_rec_id}.pdf`);
        
    } catch (error) {
        console.error('PDF download error:', error);
        res.status(500).json({ success: false, message: 'Internal server error during PDF download.' });
    }
});

// POST /api/admin/customers/:tax_rec_id/send-email
// Sends the generated PDF invoice to a specified recipient email address
router.post('/:tax_rec_id/send-email', async (req, res) => {
    const { tax_rec_id } = req.params;
    const { email_sending } = req.body;

    if (!email_sending || !email_sending.trim()) {
        return res.status(400).json({ success: false, message: 'Recipient email address (email_sending) is required.' });
    }

    // Basic email format validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email_sending.trim())) {
        return res.status(400).json({ success: false, message: 'Invalid email address format.' });
    }

    try {
        // 1. Fetch invoice to confirm it exists and is ready
        const [invoiceRows] = await db.execute(`
            SELECT i.*, p.tax_id 
            FROM invoices i 
            LEFT JOIN customer_profile p ON i.customer_num = p.customer_num 
            WHERE i.tax_rec_id = ?
        `, [tax_rec_id]);
        if (invoiceRows.length === 0) {
            return res.status(404).json({ success: false, message: 'Tax record not found.' });
        }

        const record = invoiceRows[0];
        if (record.status !== 'ready') {
            return res.status(400).json({ success: false, message: 'PDF has not been generated yet. Please generate it first.' });
        }

        // 2. Get PDF path from generated_documents
        const [pdfRows] = await db.execute('SELECT pdf_folder FROM generated_documents WHERE tax_rec_id = ?', [tax_rec_id]);
        if (pdfRows.length === 0) {
            return res.status(404).json({ success: false, message: 'PDF file record not found. Please regenerate.' });
        }

        const pdfRelPath = pdfRows[0].pdf_folder;

        const username = req.session.adminUser ? req.session.adminUser.username : 'system';

        // 3. Dispatch email (synchronous for admin — gives real-time success/failure feedback)
        await sendInvoiceEmail(email_sending.trim(), tax_rec_id, record.tax_id, pdfRelPath);

        // 4. Log the dispatch
        await logActivity('SENDING_EMAIL', `${email_sending.trim()}:${pdfRelPath}`, username);

        res.json({ success: true, message: `Email sent successfully to ${email_sending.trim()}.` });

    } catch (error) {
        console.error('Admin send-email error:', error);
        res.status(500).json({ success: false, message: `Failed to send email: ${error.message}` });
    }
});

module.exports = router;
