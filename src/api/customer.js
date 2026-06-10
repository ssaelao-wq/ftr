const express = require('express');
const router = express.Router();
const db = require('../db');
const { logActivity } = require('../logger');
const { generatePdf } = require('../services/pdfService');
const { sendInvoiceEmail } = require('../services/emailService');

// GET /api/customer/lookup-branches
// Lookup registered branches for a given tax_id (public route for customer LIFF)
router.get('/lookup-branches', async (req, res) => {
    const { tax_id } = req.query;
    
    if (!tax_id || !tax_id.trim()) {
        return res.status(400).json({ success: false, message: 'Tax ID is required.' });
    }

    try {
        const [rows] = await db.execute(
            'SELECT customer_branch, customer_num, customer_name, customer_addr FROM customer_profile WHERE tax_id = ? ORDER BY customer_branch = \'สำนักงานใหญ่\' DESC, customer_branch ASC',
            [tax_id.trim()]
        );
        res.json({ success: true, branches: rows });
    } catch (error) {
        console.error('Customer lookup-branches error:', error);
        res.status(500).json({ success: false, message: 'Internal server error during branch lookup.' });
    }
});

// POST /api/customer/update-profile
router.post('/update-profile', async (req, res) => {
    const { line_user_id, tax_rec_id, tax_id, customer_branch, address, container_num } = req.body;

    if (!tax_rec_id || !tax_id || !customer_branch || !address) {
        return res.status(400).json({ success: false, message: 'Missing required fields' });
    }

    try {
        // Fetch invoice to make sure it exists
        const [rows] = await db.execute('SELECT tax_id FROM invoices WHERE tax_rec_id = ?', [tax_rec_id]);
        
        if (rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Your Tax Record is not ready yet, please do it again next day' });
        }

        const record = rows[0];
        if (record.tax_id) {
            return res.status(403).json({ success: false, message: 'Information has already been updated. Please contact Admin for any corrections.' });
        }

        // Validate that customer profile exists for this tax_id & branch
        const [profiles] = await db.execute(
            'SELECT customer_name FROM customer_profile WHERE tax_id = ? AND customer_branch = ?',
            [tax_id.trim(), customer_branch.trim()]
        );
        if (profiles.length === 0) {
            return res.status(400).json({ 
                success: false, 
                message: 'ข้อมูลผู้เสียภาษีและสาขานี้ยังไม่ได้ลงทะเบียนในระบบ กรุณาติดต่อเจ้าหน้าที่ (Profile/Branch combination is not registered. Please contact staff.)' 
            });
        }

        const profileName = profiles[0].customer_name;

        // Update existing master customer profile's customer_addr
        await db.execute(
            'UPDATE customer_profile SET customer_addr = ? WHERE tax_id = ? AND customer_branch = ?',
            [address.trim(), tax_id.trim(), customer_branch.trim()]
        );

        // Link the invoice, set container_num, status, and reset export flag
        await db.execute(
            'UPDATE invoices SET tax_id = ?, customer_branch = ?, container_num = ?, is_accounting_exported = FALSE, status = \'pending\' WHERE tax_rec_id = ?',
            [tax_id.trim(), customer_branch.trim(), container_num ? container_num.trim() : null, tax_rec_id]
        );

        logActivity('REQ_MISS_DATA', `${profileName}:${address}:${tax_rec_id}`); // Non-blocking

        res.json({ success: true, message: 'Profile updated successfully' });
    } catch (error) {
        console.error('Error updating profile:', error);
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
});

// POST /api/customer/request-invoice
router.post('/request-invoice', async (req, res) => {
    const { line_user_id, tax_rec_id, tax_id, email_sending } = req.body;

    if (!tax_rec_id || !tax_id || !email_sending) {
        return res.status(400).json({ success: false, message: 'Missing required fields' });
    }

    try {
        logActivity('REQ_FULL_TAX', `${tax_rec_id}:${tax_id}:${email_sending}`); // Non-blocking

        // Check if CDMS data exists and join with customer_profile
        const [rows] = await db.execute(`
            SELECT i.tax_rec_id, i.tax_id, i.customer_branch, i.status,
                   p.customer_name AS customer, p.customer_addr AS customer_addr
            FROM invoices i
            LEFT JOIN customer_profile p ON i.tax_id = p.tax_id AND i.customer_branch = p.customer_branch
            WHERE i.tax_rec_id = ?
        `, [tax_rec_id]);
        
        if (rows.length === 0) {
            return res.status(404).json({ success: false, message: 'The Data is not ready yet' });
        }

        const record = rows[0];

        // Check for incomplete profile
        if (!record.customer || !record.customer_addr || !record.tax_id) {
            return res.status(400).json({ success: false, message: 'Some missing data: company name, address, tax id' });
        }

        // Check if PDF already exists and invoice status is ready
        const [pdfRows] = await db.execute('SELECT pdf_folder FROM generated_documents WHERE tax_rec_id = ?', [tax_rec_id]);
        
        if (record.status === 'ready' && pdfRows.length > 0) {
            // PDF Already Exists
            const existingPdfUrl = pdfRows[0].pdf_folder;
            
            // Background Task: Dispatch Email (non-blocking)
            (async () => {
                try {
                    await sendInvoiceEmail(email_sending, tax_rec_id, record.tax_id, existingPdfUrl);
                    await logActivity('SENDING_EMAIL', `${email_sending}:${existingPdfUrl}`);
                } catch (emailErr) {
                    console.error('[customer] Email dispatch failed (existing PDF):', emailErr.message);
                }
            })();

            return res.json({ 
                success: true, 
                message: `ใบกำกับภาษี จะส่งให้คุณทางอีเมล์ ${email_sending}` 
            });
        } else {
            // Background Task: Generate PDF & Dispatch Email (non-blocking)
            (async () => {
                try {
                    const generatedPdfUrl = await generatePdf(tax_rec_id);
                    await logActivity('ONTHEFLY_GEN_PDF', `${tax_rec_id}:${tax_id}:${email_sending}:${generatedPdfUrl}`);

                    try {
                        await sendInvoiceEmail(email_sending, tax_rec_id, tax_id, generatedPdfUrl);
                        await logActivity('SENDING_EMAIL', `${email_sending}:${generatedPdfUrl}`);
                    } catch (emailErr) {
                        console.error('[customer] Email dispatch failed (on-the-fly):', emailErr.message);
                    }
                } catch (err) {
                    console.error('Background PDF generation failed:', err);
                }
            })();

            return res.json({ 
                success: true, 
                message: `ใบกำกับภาษี จะส่งให้คุณทางอีเมล์ ${email_sending} ภายใน 10-15 นาที` 
            });
        }

    } catch (error) {
        console.error('Error requesting invoice:', error);
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
});

module.exports = router;
