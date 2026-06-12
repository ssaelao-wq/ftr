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
        const [totalRows] = await db.query('SELECT COUNT(*) AS count FROM invoices');
        const [pendingRows] = await db.query(`
            SELECT COUNT(*) AS count 
            FROM invoices i
            LEFT JOIN customer_profile p ON i.tax_id = p.tax_id AND i.customer_branch = p.customer_branch
            WHERE i.tax_id IS NULL 
               OR i.customer_branch IS NULL 
               OR p.customer_name IS NULL 
               OR p.customer_addr IS NULL
        `);
        const [readyExportRows] = await db.query(`
            SELECT COUNT(*) AS count 
            FROM invoices i
            JOIN customer_profile p ON i.tax_id = p.tax_id AND i.customer_branch = p.customer_branch
            WHERE p.customer_name IS NOT NULL 
              AND p.customer_addr IS NOT NULL 
              AND i.is_accounting_exported = FALSE
        `);
        const [exportedRows] = await db.query(`
            SELECT COUNT(*) AS count 
            FROM invoices i
            JOIN customer_profile p ON i.tax_id = p.tax_id AND i.customer_branch = p.customer_branch
            WHERE p.customer_name IS NOT NULL 
              AND p.customer_addr IS NOT NULL 
              AND i.is_accounting_exported = TRUE
        `);

        res.json({
            success: true,
            stats: {
                total: totalRows[0].count,
                pending: pendingRows[0].count,
                readyExport: readyExportRows[0].count,
                exported: exportedRows[0].count
            }
        });
    } catch (error) {
        console.error('Stats query error:', error);
        res.status(500).json({ success: false, message: 'Internal server error during stats lookup.' });
    }
});


// Helper to build dynamic sql query from filters
function buildSearchQuery(queryParams) {
    const { tax_rec_id, customer, address, tax_id, date_from, date_to, is_accounting_exported } = queryParams;
    let sql = `
        SELECT i.tax_rec_id, i.tax_id, i.customer_branch, i.container_num, i.service_date, i.status, i.is_accounting_exported, i.created_at, i.updated_at,
               p.customer_name AS customer, p.customer_addr, p.customer_num AS customer_code
        FROM invoices i
        LEFT JOIN customer_profile p ON i.tax_id = p.tax_id AND i.customer_branch = p.customer_branch
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
        sql += ' AND i.tax_id = ?';
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

    return { sql, params };
}

// GET /api/admin/customers/search
router.get('/search', async (req, res) => {
    try {
        const { sql, params } = buildSearchQuery(req.query);
        const orderSql = `${sql} ORDER BY i.service_date DESC, i.created_at DESC`;
        const [rows] = await db.query(orderSql, params);
        res.json({ success: true, customers: rows });
    } catch (error) {
        console.error('Customer search error:', error);
        res.status(500).json({ success: false, message: 'Internal server error during customer search.' });
    }
});

// PUT /api/admin/customers/:tax_rec_id
router.put('/:tax_rec_id', async (req, res) => {
    const { tax_rec_id } = req.params;
    const { customer, company_name, address, tax_id, customer_branch, container_num } = req.body;
    const finalCustomer = customer || company_name;
    const finalBranch = customer_branch || 'สำนักงานใหญ่';

    if (!finalCustomer || !address || !tax_id) {
        return res.status(400).json({ success: false, message: 'Customer Name, Address, and Tax ID are required.' });
    }

    try {
        // Validate record exists
        const [rows] = await db.execute('SELECT tax_rec_id FROM invoices WHERE tax_rec_id = ?', [tax_rec_id]);
        if (rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Tax record not found.' });
        }

        // Validate that customer profile exists for this tax_id & branch combination
        const [profiles] = await db.execute(
            'SELECT id FROM customer_profile WHERE tax_id = ? AND customer_branch = ?',
            [tax_id.trim(), finalBranch.trim()]
        );
        if (profiles.length === 0) {
            return res.status(400).json({ 
                success: false, 
                message: `Customer Profile not found for Tax ID "${tax_id}" and Branch "${finalBranch}". Please upload the customer profile first.` 
            });
        }

        // Update existing master customer profile's customer_name, customer_addr, and reset its accounting export flag
        await db.execute(
            'UPDATE customer_profile SET customer_name = ?, customer_addr = ?, is_accounting_exported = FALSE WHERE tax_id = ? AND customer_branch = ?',
            [finalCustomer.trim(), address.trim(), tax_id.trim(), finalBranch.trim()]
        );

        // Update the invoice record to link to this profile, set container_num, reset status and both export flags
        await db.execute(
            'UPDATE invoices SET tax_id = ?, customer_branch = ?, container_num = ?, status = \'pending\', is_accounting_exported = FALSE WHERE tax_rec_id = ?',
            [tax_id.trim(), finalBranch.trim(), container_num ? container_num.trim() : null, tax_rec_id]
        );

        res.json({ success: true, message: 'Invoice linked and Customer profile updated successfully.' });
    } catch (error) {
        console.error('Invoice customer update error:', error);
        res.status(500).json({ success: false, message: 'Internal server error during invoice customer update.' });
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
        const csvHeaders = 'tax_rec_id|customer_code|company_name|address|tax_id\n';
        const csvRows = rows.map(r => {
            const taxRecId = r.tax_rec_id || '';
            const customerCode = r.customer_code || '';
            const companyName = (r.company_name || '').replace(/[\r\n]+/g, ' '); // Clean newlines
            const address = (r.address || '').replace(/[\r\n]+/g, ' ');         // Clean newlines
            const taxId = r.tax_id || '';
            return `${taxRecId}|${customerCode}|${companyName}|${address}|${taxId}`;
        }).join('\n');

        const csvContent = csvHeaders + csvRows;

        // 4. Update the database flag is_accounting_exported = TRUE inside a transaction
        const taxRecIds = rows.map(r => r.tax_rec_id);
        
        const connection = await db.getConnection();
        await connection.beginTransaction();
        try {
            // Bulk update matching records
            await connection.query(
                'UPDATE invoices SET is_accounting_exported = TRUE WHERE tax_rec_id IN (?)',
                [taxRecIds]
            );
            await connection.commit();
        } catch (txErr) {
            await connection.rollback();
            throw txErr;
        } finally {
            connection.release();
        }

        // 5. Log download activity (Non-blocking)
        await logActivity('REQ_DOWNLOAD_MISS', `${username}:${rows.length}`, username);

        // 6. Return file download stream
        const filename = `accounting_export_${new Date().toISOString().slice(0,10).replace(/-/g,'')}_${Date.now()}.csv`;
        res.setHeader('Content-Type', 'text/csv');
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
            SELECT i.tax_rec_id, i.tax_id, i.customer_branch, i.status,
                   p.customer_name AS customer, p.customer_addr AS customer_addr
            FROM invoices i
            LEFT JOIN customer_profile p ON i.tax_id = p.tax_id AND i.customer_branch = p.customer_branch
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
        const [invoiceRows] = await db.execute('SELECT * FROM invoices WHERE tax_rec_id = ?', [tax_rec_id]);
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
