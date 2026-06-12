const express = require('express');
const router = express.Router();
const axios = require('axios');
const db = require('../db');
const { logActivity } = require('../logger');
const { generatePdf } = require('../services/pdfService');
const { sendInvoiceEmail } = require('../services/emailService');

// ---------------------------------------------------------------------------
// Helper: Send LINE Flex Message (PDF download link)
// ---------------------------------------------------------------------------
async function sendLinePdfLink(lineUserId, taxRecId, customerName, pdfUrl) {
    const channelToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;
    if (!channelToken) {
        throw new Error('LINE_CHANNEL_ACCESS_TOKEN not configured in .env');
    }

    const flexMessage = {
        to: lineUserId,
        messages: [
            {
                type: 'flex',
                altText: `ใบกำกับภาษีแบบเต็ม ${taxRecId}`,
                contents: {
                    type: 'bubble',
                    size: 'mega',
                    header: {
                        type: 'box',
                        layout: 'vertical',
                        contents: [
                            {
                                type: 'text',
                                text: '🧾 ใบกำกับภาษีแบบเต็ม',
                                weight: 'bold',
                                size: 'lg',
                                color: '#ffffff'
                            }
                        ],
                        backgroundColor: '#00B900',
                        paddingAll: '16px'
                    },
                    body: {
                        type: 'box',
                        layout: 'vertical',
                        spacing: 'sm',
                        contents: [
                            {
                                type: 'box',
                                layout: 'horizontal',
                                contents: [
                                    { type: 'text', text: 'หมายเลข:', size: 'sm', color: '#666666', flex: 3 },
                                    { type: 'text', text: taxRecId, size: 'sm', weight: 'bold', flex: 5, wrap: true }
                                ]
                            },
                            {
                                type: 'box',
                                layout: 'horizontal',
                                contents: [
                                    { type: 'text', text: 'ชื่อบริษัท:', size: 'sm', color: '#666666', flex: 3 },
                                    { type: 'text', text: customerName || '-', size: 'sm', weight: 'bold', flex: 5, wrap: true }
                                ]
                            },
                            {
                                type: 'separator',
                                margin: 'md'
                            },
                            {
                                type: 'text',
                                text: 'กดปุ่มด้านล่างเพื่อเปิดหรือดาวโหลดใบกำกับภาษี PDF',
                                size: 'xs',
                                color: '#888888',
                                wrap: true,
                                margin: 'sm'
                            }
                        ],
                        paddingAll: '16px'
                    },
                    footer: {
                        type: 'box',
                        layout: 'vertical',
                        contents: [
                            {
                                type: 'button',
                                action: {
                                    type: 'uri',
                                    label: '📄 เปิด/ดาวโหลด ใบกำกับภาษี (PDF)',
                                    uri: pdfUrl
                                },
                                style: 'primary',
                                color: '#00B900',
                                height: 'sm'
                            }
                        ],
                        paddingAll: '12px'
                    }
                }
            }
        ]
    };

    const response = await axios.post(
        'https://api.line.me/v2/bot/message/push',
        flexMessage,
        {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${channelToken}`
            }
        }
    );
    return response.data;
}

// ---------------------------------------------------------------------------
// GET /api/customer/lookup-branches
// Validates tax_rec_id exists and isn't locked, then looks up customer_profile
// ---------------------------------------------------------------------------
router.get('/lookup-branches', async (req, res) => {
    const { tax_rec_id, tax_id } = req.query;

    if (!tax_rec_id || !tax_rec_id.trim()) {
        return res.status(400).json({ success: false, code: 'MISSING_PARAM', message: 'Tax Record ID is required.' });
    }
    if (!tax_id || !tax_id.trim()) {
        return res.status(400).json({ success: false, code: 'MISSING_PARAM', message: 'Tax ID is required.' });
    }

    try {
        // Check 1: Does this tax_rec_id exist in invoices?
        const [invoiceRows] = await db.execute(
            'SELECT tax_rec_id, is_customer_data_updated FROM invoices WHERE tax_rec_id = ?',
            [tax_rec_id.trim()]
        );

        if (invoiceRows.length === 0) {
            return res.status(404).json({
                success: false,
                code: 'NO_RECORD',
                message: 'ไม่มีใบกำกับภาษีของหมายเลขนี้'
            });
        }

        // Check 2: 1-time lock — has customer already updated from Rich Menu?
        if (invoiceRows[0].is_customer_data_updated) {
            return res.status(403).json({
                success: false,
                code: 'LOCKED',
                message: 'ไม่สามารถแก้ไขข้อมูลลูกค้าได้มากกว่า 1 ครั้ง โปรดติดต่อ admin'
            });
        }

        // Look up customer profiles for this tax_id
        const [rows] = await db.execute(
            `SELECT customer_branch, customer_num, customer_name, customer_addr
             FROM customer_profile
             WHERE tax_id = ?
             ORDER BY customer_branch = 'สำนักงานใหญ่' DESC, customer_branch ASC`,
            [tax_id.trim()]
        );

        // Return branches (may be empty array — frontend handles empty = manual entry mode)
        res.json({ success: true, branches: rows });

    } catch (error) {
        console.error('Customer lookup-branches error:', error);
        res.status(500).json({ success: false, code: 'SERVER_ERROR', message: 'Internal server error during branch lookup.' });
    }
});

// ---------------------------------------------------------------------------
// POST /api/customer/update-profile
// (Legacy endpoint kept for compatibility — now also checks is_customer_data_updated)
// ---------------------------------------------------------------------------
router.post('/update-profile', async (req, res) => {
    const { line_user_id, tax_rec_id, tax_id, customer_branch, customer_name, customer_num, address, container_num } = req.body;

    if (!tax_rec_id || !tax_id || !customer_branch || !address) {
        return res.status(400).json({ success: false, message: 'Missing required fields' });
    }

    try {
        // Fetch invoice to make sure it exists
        const [rows] = await db.execute(
            'SELECT tax_id, is_customer_data_updated FROM invoices WHERE tax_rec_id = ?',
            [tax_rec_id]
        );

        if (rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Your Tax Record is not ready yet, please do it again next day' });
        }

        // 1-time lock check
        if (rows[0].is_customer_data_updated) {
            return res.status(403).json({
                success: false,
                message: 'ไม่สามารถแก้ไขข้อมูลลูกค้าได้มากกว่า 1 ครั้ง โปรดติดต่อ admin'
            });
        }

        // Validate that customer profile exists for this tax_id & branch
        const [profiles] = await db.execute(
            'SELECT customer_name FROM customer_profile WHERE tax_id = ? AND customer_branch = ?',
            [tax_id.trim(), customer_branch.trim()]
        );
        if (profiles.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'ข้อมูลผู้เสียภาษีและสาขานี้ยังไม่ได้ลงทะเบียนในระบบ กรุณาติดต่อเจ้าหน้าที่'
            });
        }

        const profileName = profiles[0].customer_name;

        // Update customer_addr in master profile; reset accounting export flag so it's picked up next time
        await db.execute(
            'UPDATE customer_profile SET customer_addr = ?, is_accounting_exported = FALSE WHERE tax_id = ? AND customer_branch = ?',
            [address.trim(), tax_id.trim(), customer_branch.trim()]
        );

        // Link the invoice, mark as updated
        await db.execute(
            `UPDATE invoices
             SET tax_id = ?, customer_branch = ?, container_num = ?,
                 is_accounting_exported = FALSE, is_customer_data_updated = TRUE, status = 'pending'
             WHERE tax_rec_id = ?`,
            [tax_id.trim(), customer_branch.trim(), container_num ? container_num.trim() : null, tax_rec_id]
        );

        logActivity('REQ_MISS_DATA', `${profileName}:${address}:${tax_rec_id}`);

        res.json({ success: true, message: 'Profile updated successfully' });
    } catch (error) {
        console.error('Error updating profile:', error);
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
});

// ---------------------------------------------------------------------------
// POST /api/customer/save-and-send
// Combined: save customer data + generate PDF on-the-fly + send via email or LINE
// ---------------------------------------------------------------------------
router.post('/save-and-send', async (req, res) => {
    const {
        line_user_id,
        tax_rec_id, tax_id,
        customer_branch, customer_num, customer_name,
        address, container_num,
        send_method,   // 'email' | 'line'
        email_address  // required if send_method = 'email'
    } = req.body;

    // Basic validation
    if (!tax_rec_id || !tax_id || !customer_branch || !customer_name || !address || !send_method) {
        return res.status(400).json({ success: false, message: 'Missing required fields' });
    }
    if (send_method === 'email' && !email_address) {
        return res.status(400).json({ success: false, message: 'Email address is required for email delivery' });
    }
    if (send_method === 'line' && !line_user_id) {
        return res.status(400).json({ success: false, message: 'LINE User ID is required for LINE delivery' });
    }

    try {
        // Check invoice exists and read lock flags
        const [rows] = await db.execute(
            'SELECT tax_rec_id, is_customer_data_updated, is_pdf_sent_from_richmenu FROM invoices WHERE tax_rec_id = ?',
            [tax_rec_id]
        );

        if (rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'ไม่มีใบกำกับภาษีของหมายเลขนี้'
            });
        }

        const invoice = rows[0];

        // 1-time lock: customer data
        if (invoice.is_customer_data_updated) {
            return res.status(403).json({
                success: false,
                code: 'DATA_LOCKED',
                message: 'ไม่สามารถแก้ไขข้อมูลลูกค้าได้มากกว่า 1 ครั้ง โปรดติดต่อ admin'
            });
        }

        // 1-time lock: PDF sending
        if (invoice.is_pdf_sent_from_richmenu) {
            return res.status(403).json({
                success: false,
                code: 'PDF_LOCKED',
                message: 'ไม่สามารถสร้างใบกำกับภาษีในรูปแบบ PDF ได้มากกว่า 1 ครั้ง โปรดติดต่อ admin'
            });
        }

        // --- Save customer data to invoices ---
        await db.execute(
            `UPDATE invoices
             SET tax_id = ?, customer_branch = ?, container_num = ?,
                 is_accounting_exported = FALSE,
                 is_customer_data_updated = TRUE,
                 status = 'pending'
             WHERE tax_rec_id = ?`,
            [
                tax_id.trim(),
                customer_branch.trim(),
                container_num ? container_num.trim() : null,
                tax_rec_id
            ]
        );

        // If Tax ID was NOT found in customer_profile (manual entry), insert a new profile row
        const [existingProfile] = await db.execute(
            'SELECT id FROM customer_profile WHERE tax_id = ? AND customer_branch = ?',
            [tax_id.trim(), customer_branch.trim()]
        );
        if (existingProfile.length === 0) {
            // New profile row (manual entry or first-time customer)
            // is_accounting_exported defaults to FALSE — will be picked up in next accounting export
            await db.execute(
                `INSERT INTO customer_profile (tax_id, customer_num, customer_name, customer_addr, customer_branch, is_accounting_exported)
                 VALUES (?, ?, ?, ?, ?, FALSE)`,
                [
                    tax_id.trim(),
                    customer_num ? customer_num.trim() : 'TMP-00000',
                    customer_name.trim(),
                    address.trim(),
                    customer_branch.trim()
                ]
            );
        } else {
            // Update existing profile; reset accounting export flag so updated data is re-exported
            await db.execute(
                'UPDATE customer_profile SET customer_name = ?, customer_addr = ?, customer_num = ?, is_accounting_exported = FALSE WHERE tax_id = ? AND customer_branch = ?',
                [customer_name.trim(), address.trim(), customer_num ? customer_num.trim() : null, tax_id.trim(), customer_branch.trim()]
            );
        }

        logActivity('REQ_MISS_DATA', `${customer_name}:${address}:${tax_rec_id}`);

        // --- Return immediate response so the UI doesn't hang ---
        const confirmMessage = send_method === 'email'
            ? 'โปรดตรวจสอบอีเมล์ของคุณในอีก 1-2 นาที'
            : 'โปรดรอ 1-2 นาที เพื่อสร้างใบกำกับภาษีในรูปแบบ PDF และส่ง Link ให้คุณทางไลน์เพื่อดาวโหลด';

        res.json({ success: true, message: confirmMessage });

        // --- Background: Generate PDF + Dispatch ---
        (async () => {
            try {
                const generatedPdfPath = await generatePdf(tax_rec_id);

                // Mark PDF as sent from rich menu (1-time lock)
                await db.execute(
                    'UPDATE invoices SET is_pdf_sent_from_richmenu = TRUE WHERE tax_rec_id = ?',
                    [tax_rec_id]
                );

                logActivity('ONTHEFLY_GEN_PDF', `${tax_rec_id}:${tax_id}:${send_method}:${generatedPdfPath}`);

                if (send_method === 'email') {
                    try {
                        await sendInvoiceEmail(email_address, tax_rec_id, tax_id, generatedPdfPath);
                        logActivity('SENDING_EMAIL', `${email_address}:${generatedPdfPath}`);
                    } catch (emailErr) {
                        console.error('[save-and-send] Email dispatch failed:', emailErr.message);
                    }
                } else if (send_method === 'line') {
                    try {
                        // Build public PDF URL from the storage path
                        const baseUrl = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
                        const pdfFileName = `FTR_${tax_rec_id}.pdf`;
                        const pdfPublicUrl = `${baseUrl}/storage/pdfs/${pdfFileName}`;

                        await sendLinePdfLink(line_user_id, tax_rec_id, customer_name, pdfPublicUrl);
                        logActivity('SENDING_LINE', `${tax_rec_id}:${pdfPublicUrl}`);
                    } catch (lineErr) {
                        console.error('[save-and-send] LINE push failed:', lineErr.message);
                    }
                }

            } catch (err) {
                console.error('[save-and-send] Background PDF generation failed:', err);
            }
        })();

    } catch (error) {
        console.error('Error in save-and-send:', error);
        // Only send error if headers haven't been sent yet
        if (!res.headersSent) {
            res.status(500).json({ success: false, message: 'Internal server error' });
        }
    }
});

// ---------------------------------------------------------------------------
// GET /api/customer/check-invoice
// Validates invoice exists, checks customer data completeness, and checks PDF generation state
// ---------------------------------------------------------------------------
router.get('/check-invoice', async (req, res) => {
    const { tax_rec_id, tax_id } = req.query;

    if (!tax_rec_id || !tax_rec_id.trim()) {
        return res.status(400).json({ success: false, code: 'MISSING_PARAM', message: 'Tax Record ID is required.' });
    }
    if (!tax_id || !tax_id.trim()) {
        return res.status(400).json({ success: false, code: 'MISSING_PARAM', message: 'Tax ID is required.' });
    }

    try {
        // Look up invoice
        const [invoiceRows] = await db.execute(
            'SELECT tax_rec_id, tax_id, customer_branch, status FROM invoices WHERE tax_rec_id = ?',
            [tax_rec_id.trim()]
        );

        if (invoiceRows.length === 0) {
            return res.status(404).json({
                success: false,
                code: 'NO_RECORD',
                message: 'ไม่มีใบกำกับภาษีของหมายเลขนี้'
            });
        }

        const invoice = invoiceRows[0];

        // Check if invoice has customer (tax_id) assigned
        if (!invoice.tax_id) {
            // Check if entered tax_id exists in customer_profile
            const [profileRows] = await db.execute(
                'SELECT id FROM customer_profile WHERE tax_id = ? LIMIT 1',
                [tax_id.trim()]
            );

            if (profileRows.length > 0) {
                return res.status(400).json({
                    success: false,
                    code: 'UNLINKED_CUSTOMER_EXISTS',
                    message: "กรุณาเพิ่มข้อมูลลูกค้าใน invoice จากเมนู 'เพิ่มข้อมูลลูกค้า'"
                });
            } else {
                return res.status(400).json({
                    success: false,
                    code: 'UNLINKED_CUSTOMER_NEW',
                    message: "กรุณาสร้างลูกค้าใหม่ และ เพิ่มข้อมูลลูกค้าใน invoice จากเมนู 'เพิ่มข้อมูลลูกค้า'"
                });
            }
        }

        // Check if the typed tax_id matches the assigned tax_id
        if (invoice.tax_id !== tax_id.trim()) {
            return res.status(400).json({
                success: false,
                code: 'TAX_ID_MISMATCH',
                message: 'หมายเลขประจำตัวผู้เสียภาษีไม่ตรงกับใบกำกับภาษีนี้'
            });
        }

        // Look up customer profile to make sure name and address exist
        const [profileRows] = await db.execute(
            'SELECT customer_name, customer_addr FROM customer_profile WHERE tax_id = ? AND customer_branch = ?',
            [invoice.tax_id, invoice.customer_branch]
        );

        if (profileRows.length === 0 || !profileRows[0].customer_name || !profileRows[0].customer_addr) {
            return res.status(400).json({
                success: false,
                code: 'UNLINKED_CUSTOMER_EXISTS',
                message: "กรุณาเพิ่มข้อมูลลูกค้าใน invoice จากเมนู 'เพิ่มข้อมูลลูกค้า'"
            });
        }

        // Check if PDF already exists
        const [pdfRows] = await db.execute(
            'SELECT pdf_folder FROM generated_documents WHERE tax_rec_id = ?',
            [tax_rec_id.trim()]
        );

        const pdfExists = invoice.status === 'ready' && pdfRows.length > 0;
        
        return res.json({
            success: true,
            code: pdfExists ? 'READY_WITH_PDF' : 'READY_NO_PDF',
            pdf_state: pdfExists ? 'ready' : 'no_pdf',
            customer_name: profileRows[0].customer_name
        });

    } catch (error) {
        console.error('Error in check-invoice:', error);
        res.status(500).json({ success: false, code: 'SERVER_ERROR', message: 'Internal server error during invoice check.' });
    }
});

// ---------------------------------------------------------------------------
// POST /api/customer/request-invoice
// (Updated endpoint to support 2-step verification and LINE/Email delivery)
// ---------------------------------------------------------------------------
router.post('/request-invoice', async (req, res) => {
    const { line_user_id, tax_rec_id, tax_id, send_method, email_sending } = req.body;

    const method = send_method || 'email'; // fallback for backward compatibility

    if (!tax_rec_id || !tax_id) {
        return res.status(400).json({ success: false, message: 'Missing required fields' });
    }

    if (method === 'email' && !email_sending) {
        return res.status(400).json({ success: false, message: 'Email address is required for email delivery' });
    }

    if (method === 'line' && !line_user_id) {
        return res.status(400).json({ success: false, message: 'LINE User ID is required for LINE delivery' });
    }

    try {
        logActivity('REQ_FULL_TAX', `${tax_rec_id}:${tax_id}:${method === 'email' ? email_sending : 'LINE'}`);

        const [rows] = await db.execute(`
            SELECT i.tax_rec_id, i.tax_id, i.customer_branch, i.status,
                   p.customer_name AS customer, p.customer_addr AS customer_addr
            FROM invoices i
            LEFT JOIN customer_profile p ON i.tax_id = p.tax_id AND i.customer_branch = p.customer_branch
            WHERE i.tax_rec_id = ?
        `, [tax_rec_id.trim()]);

        if (rows.length === 0) {
            return res.status(404).json({ success: false, message: 'ไม่มีใบกำกับภาษีของหมายเลขนี้' });
        }

        const record = rows[0];

        // Validation checks matching check-invoice logic
        if (!record.tax_id) {
            const [profileRows] = await db.execute(
                'SELECT id FROM customer_profile WHERE tax_id = ? LIMIT 1',
                [tax_id.trim()]
            );

            if (profileRows.length > 0) {
                return res.status(400).json({ success: false, message: "กรุณาเพิ่มข้อมูลลูกค้าใน invoice จากเมนู 'เพิ่มข้อมูลลูกค้า'" });
            } else {
                return res.status(400).json({ success: false, message: "กรุณาสร้างลูกค้าใหม่ และ เพิ่มข้อมูลลูกค้าใน invoice จากเมนู 'เพิ่มข้อมูลลูกค้า'" });
            }
        }

        if (record.tax_id !== tax_id.trim()) {
            return res.status(400).json({ success: false, message: 'หมายเลขประจำตัวผู้เสียภาษีไม่ตรงกับใบกำกับภาษีนี้' });
        }

        if (!record.customer || !record.customer_addr) {
            return res.status(400).json({ success: false, message: "กรุณาเพิ่มข้อมูลลูกค้าใน invoice จากเมนู 'เพิ่มข้อมูลลูกค้า'" });
        }

        // Check PDF existence
        const [pdfRows] = await db.execute('SELECT pdf_folder FROM generated_documents WHERE tax_rec_id = ?', [tax_rec_id.trim()]);
        const pdfExists = record.status === 'ready' && pdfRows.length > 0;

        if (pdfExists) {
            const existingPdfUrl = pdfRows[0].pdf_folder;
            const baseUrl = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
            const pdfPublicUrl = `${baseUrl}${existingPdfUrl}`;

            (async () => {
                try {
                    if (method === 'email') {
                        await sendInvoiceEmail(email_sending, tax_rec_id, record.tax_id, existingPdfUrl);
                        await logActivity('SENDING_EMAIL', `${email_sending}:${existingPdfUrl}`);
                    } else if (method === 'line') {
                        await sendLinePdfLink(line_user_id, tax_rec_id, record.customer, pdfPublicUrl);
                        await logActivity('SENDING_LINE', `${tax_rec_id}:${pdfPublicUrl}`);
                    }
                } catch (dispatchErr) {
                    console.error('[customer] Request invoice dispatch failed (existing PDF):', dispatchErr.message);
                }
            })();

            const returnMsg = method === 'email'
                ? 'โปรดตรวจสอบอีเมล์ของคุณในอีก 1-2 นาที'
                : 'โปรดรอสักครู่ กำลังส่ง Link ให้คุณทางไลน์เพื่อดาวโหลด';

            return res.json({ success: true, message: returnMsg });
        } else {
            (async () => {
                try {
                    const generatedPdfPath = await generatePdf(tax_rec_id);
                    const baseUrl = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
                    const pdfPublicUrl = `${baseUrl}${generatedPdfPath}`;

                    await logActivity('ONTHEFLY_GEN_PDF', `${tax_rec_id}:${tax_id}:${method}:${generatedPdfPath}`);

                    if (method === 'email') {
                        await sendInvoiceEmail(email_sending, tax_rec_id, tax_id, generatedPdfPath);
                        await logActivity('SENDING_EMAIL', `${email_sending}:${generatedPdfPath}`);
                    } else if (method === 'line') {
                        await sendLinePdfLink(line_user_id, tax_rec_id, record.customer, pdfPublicUrl);
                        await logActivity('SENDING_LINE', `${tax_rec_id}:${pdfPublicUrl}`);
                    }
                } catch (err) {
                    console.error('[customer] Request invoice background generation/dispatch failed:', err);
                }
            })();

            const returnMsg = method === 'email'
                ? 'โปรดตรวจสอบอีเมล์ของคุณในอีก 1-2 นาที'
                : 'โปรดรอ 1-2 นาที เพื่อสร้างใบกำกับภาษีในรูปแบบ PDF และส่ง Link ให้คุณทางไลน์เพื่อดาวโหลด';

            return res.json({ success: true, message: returnMsg });
        }

    } catch (error) {
        console.error('Error requesting invoice:', error);
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
});

module.exports = router;
