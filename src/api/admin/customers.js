const express = require('express');
const router = express.Router();
const path = require('path');
const db = require('../../db');
const { logActivity } = require('../../logger');
const { generatePdf } = require('../../services/pdfService');
const { sendInvoiceEmail } = require('../../services/emailService');

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

        // 2. Check if a profile with the submitted customer_num or tax_id and customer_branch already exists
        let profileRows = [];
        if (customer_num && customer_num.trim()) {
            const [rows] = await connection.execute(
                'SELECT customer_num, customer_name, customer_addr FROM customer_profile WHERE customer_num = ? LIMIT 1',
                [customer_num.trim()]
            );
            profileRows = rows;
        } else {
            const [rows] = await connection.execute(
                'SELECT customer_num, customer_name, customer_addr FROM customer_profile WHERE tax_id = ? AND customer_branch = ? LIMIT 1',
                [tax_id.trim(), finalBranch.trim()]
            );
            profileRows = rows;
        }

        let targetCustomerNum;
        let shouldCreateNew = false;

        if (profileRows.length > 0) {
            const existingProfile = profileRows[0];
            
            // Check if name or address has changed
            const nameChanged = (existingProfile.customer_name || '').trim() !== finalCustomer.trim();
            const addrChanged = (existingProfile.customer_addr || '').trim() !== address.trim();

            if (nameChanged || addrChanged) {
                // If any field changed, we treat it as an edit -> create a new TMP record
                shouldCreateNew = true;
            } else {
                // No changes, use the existing profile as is (no update/export trigger for customer_profile)
                targetCustomerNum = existingProfile.customer_num;
            }
        } else {
            // No profile exists for this Tax ID + Branch combo at all
            shouldCreateNew = true;
        }

        if (shouldCreateNew) {
            // Generate a brand new TMP- customer_num
            const now = new Date();
            const yy = String(now.getFullYear()).slice(-2);
            const mm = String(now.getMonth() + 1).padStart(2, '0');
            const dd = String(now.getDate()).padStart(2, '0');
            const hh = String(now.getHours()).padStart(2, '0');
            const min = String(now.getMinutes()).padStart(2, '0');
            const ss = String(now.getSeconds()).padStart(2, '0');
            targetCustomerNum = `TMP-${yy}${mm}${dd}${hh}${min}${ss}`;

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
        }

        // 3. Update the invoice record with the targetCustomerNum, container_num, and status
        await connection.execute(
            `UPDATE invoices 
             SET customer_num = ?, container_num = ?, status = 'pending', is_accounting_exported = FALSE 
             WHERE tax_rec_id = ?`,
            [
                targetCustomerNum,
                container_num ? container_num.trim() : null,
                tax_rec_id
            ]
        );

        await connection.commit();
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
        let exportSql = `
            SELECT tax_rec_id, customer_code, customer AS company_name, customer_addr AS address, tax_id 
            FROM (${sql}) AS filtered 
            WHERE customer IS NOT NULL AND customer_addr IS NOT NULL AND tax_id IS NOT NULL
        `;
        
        const [rows] = await db.query(exportSql, params);

        if (rows.length === 0) {
            return res.status(400).json({ success: false, message: 'No completed customer profiles match the filter criteria for export.' });
        }

        // 3. Format CSV content with | delimiter
        let csvContent = '\uFEFF'; // UTF-8 BOM to avoid corruption of Thai characters in Excel
        csvContent += 'tax_rec_id|customer_code|company_name|address|tax_id\r\n';
        
        const csvRows = rows.map(r => {
            const taxRecId = r.tax_rec_id || '';
            const customerCode = r.customer_code || '';
            const companyName = (r.company_name || '').replace(/[\r\n]+/g, ' '); // Clean newlines
            const address = (r.address || '').replace(/[\r\n]+/g, ' ');         // Clean newlines
            const taxId = r.tax_id || '';
            return `${taxRecId}|${customerCode}|${companyName}|${address}|${taxId}`;
        }).join('\r\n');

        csvContent += csvRows + '\r\n';

        // 4. Update the database flag is_accounting_exported = TRUE inside a transaction
        const taxRecIds = rows.map(r => r.tax_rec_id);
        
        const connection = await db.getConnection();
        let transactionStarted = false;
        try {
            await connection.beginTransaction();
            transactionStarted = true;
            // Bulk update matching records
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
        await logActivity('REQ_DOWNLOAD_MISS', `${username}:${rows.length}`, username);

        // 6. Return file download stream
        const filename = `accounting_export_${new Date().toISOString().slice(0,10).replace(/-/g,'')}_${Date.now()}.csv`;
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
        res.status(200).send(csvContent);

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
        res.status(500).json({ success: false, message: 'Internal server error during manual PDF generation.' });
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
        
        // 3. Send file download stream
        res.download(absolutePdfPath, `FTR_${tax_rec_id}.pdf`);
        
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
