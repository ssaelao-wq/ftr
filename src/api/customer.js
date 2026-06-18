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
            `SELECT p.tax_id, i.is_customer_data_updated 
             FROM invoices i
             LEFT JOIN customer_profile p ON i.customer_num = p.customer_num
             WHERE i.tax_rec_id = ?`,
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

        // Validate that customer profile exists
        let profiles = [];
        if (customer_num && customer_num.trim()) {
            const [rows] = await db.execute(
                'SELECT customer_num, customer_name FROM customer_profile WHERE customer_num = ?',
                [customer_num.trim()]
            );
            profiles = rows;
        } else {
            const [rows] = await db.execute(
                'SELECT customer_num, customer_name FROM customer_profile WHERE tax_id = ? AND customer_branch = ?',
                [tax_id.trim(), customer_branch.trim()]
            );
            profiles = rows;
        }
        if (profiles.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'ข้อมูลผู้เสียภาษีและสาขานี้ยังไม่ได้ลงทะเบียนในระบบ กรุณาติดต่อเจ้าหน้าที่'
            });
        }

        const profileName = profiles[0].customer_name;
        const profileCustNum = profiles[0].customer_num;

        // Update customer_addr in master profile; reset accounting export flag so it's picked up next time
        await db.execute(
            'UPDATE customer_profile SET customer_addr = ?, is_accounting_exported = FALSE WHERE customer_num = ?',
            [address.trim(), profileCustNum]
        );

        // Link the invoice, mark as updated
        await db.execute(
            `UPDATE invoices
             SET customer_num = ?, container_num = ?,
                 is_accounting_exported = FALSE, is_customer_data_updated = TRUE, status = 'pending'
             WHERE tax_rec_id = ?`,
            [profileCustNum, container_num ? container_num.trim() : null, tax_rec_id]
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

        // If Tax ID was found in customer_profile, get its customer_num
        let existingProfile = [];
        if (customer_num && customer_num.trim()) {
            const [rows] = await db.execute(
                'SELECT customer_num FROM customer_profile WHERE customer_num = ?',
                [customer_num.trim()]
            );
            existingProfile = rows;
        } else {
            const [rows] = await db.execute(
                'SELECT customer_num FROM customer_profile WHERE tax_id = ? AND customer_branch = ?',
                [tax_id.trim(), customer_branch.trim()]
            );
            existingProfile = rows;
        }

        let activeCustomerNum = customer_num ? customer_num.trim() : null;

        if (existingProfile.length === 0) {
            // New profile row (manual entry or first-time customer)
            if (!activeCustomerNum || activeCustomerNum === 'TMP-00000') {
                activeCustomerNum = 'TMP-' + Date.now();
            }
            await db.execute(
                `INSERT INTO customer_profile (tax_id, customer_num, customer_name, customer_addr, customer_branch, is_accounting_exported)
                 VALUES (?, ?, ?, ?, ?, FALSE)`,
                [
                    tax_id.trim(),
                    activeCustomerNum,
                    customer_name.trim(),
                    address.trim(),
                    customer_branch.trim()
                ]
            );
        } else {
            // Update existing profile
            activeCustomerNum = existingProfile[0].customer_num || activeCustomerNum || ('TMP-' + Date.now());
            await db.execute(
                'UPDATE customer_profile SET customer_name = ?, customer_addr = ?, customer_num = ?, is_accounting_exported = FALSE WHERE customer_num = ?',
                [customer_name.trim(), address.trim(), activeCustomerNum, activeCustomerNum]
            );
        }

        // --- Save customer data to invoices ---
        await db.execute(
            `UPDATE invoices
             SET customer_num = ?, container_num = ?,
                 is_accounting_exported = FALSE,
                 is_customer_data_updated = TRUE,
                 status = 'pending'
             WHERE tax_rec_id = ?`,
            [
                activeCustomerNum,
                container_num ? container_num.trim() : null,
                tax_rec_id
            ]
        );

        logActivity('REQ_MISS_DATA', `${customer_name}:${address}:${tax_rec_id}`);

        // --- Return immediate response so the UI doesn't hang ---
        let confirmMessage = 'ได้บันทึกรายการแล้ว';
        if (send_method === 'email') {
            confirmMessage = 'โปรดตรวจสอบอีเมล์ของคุณในอีก 1-2 นาที';
        } else if (send_method === 'line') {
            confirmMessage = 'โปรดรอ 1-2 นาที เพื่อสร้างใบกำกับภาษีในรูปแบบ PDF และส่ง Link ให้คุณทางไลน์เพื่อดาวโหลด';
        }

        res.json({ success: true, message: confirmMessage });

        // --- Background: Generate PDF + Dispatch (Only if email or line method requested) ---
        if (send_method === 'email' || send_method === 'line') {
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
                            // Build public PDF URL from the storage path using dynamic base URL helper
                            const baseUrl = getBaseUrl(req);
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
        }

    } catch (error) {
        console.error('Error in save-and-send:', error);
        // Only send error if headers haven't been sent yet
        if (!res.headersSent) {
            res.status(500).json({ success: false, message: 'Internal server error' });
        }
    }
});

// ---------------------------------------------------------------------------
// Helper: Send LINE Flex Message (Multi-PDF download links)
// ---------------------------------------------------------------------------
async function sendLineMultiPdfLink(lineUserId, taxId, customerName, invoiceLinks) {
    const channelToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;
    if (!channelToken) {
        throw new Error('LINE_CHANNEL_ACCESS_TOKEN not configured in .env');
    }

    const textLinks = invoiceLinks.map(link => ({
        type: 'box',
        layout: 'horizontal',
        spacing: 'sm',
        margin: 'sm',
        contents: [
            {
                type: 'text',
                text: link.taxRecId,
                action: {
                    type: 'uri',
                    uri: link.pdfUrl
                },
                color: '#00B900',
                decoration: 'underline',
                size: 'sm',
                weight: 'bold',
                flex: 4
            },
            {
                type: 'text',
                text: link.companyName || '-',
                size: 'sm',
                color: '#555555',
                flex: 6,
                wrap: true
            }
        ]
    }));

    const flexMessage = {
        to: lineUserId,
        messages: [
            {
                type: 'flex',
                altText: `ใบกำกับภาษีแบบเต็ม (${invoiceLinks.length} รายการ)`,
                contents: {
                    type: 'bubble',
                    size: 'mega',
                    header: {
                        type: 'box',
                        layout: 'vertical',
                        contents: [
                            {
                                type: 'text',
                                text: `Tax ID: ${taxId}`,
                                weight: 'bold',
                                size: 'md',
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
                                type: 'text',
                                text: 'กดที่หมายเลขเอกสารด้านล่างเพื่อดาวน์โหลด PDF:',
                                size: 'xs',
                                color: '#888888',
                                wrap: true,
                                margin: 'sm'
                            },
                            {
                                type: 'box',
                                layout: 'horizontal',
                                spacing: 'sm',
                                margin: 'md',
                                contents: [
                                    { type: 'text', text: 'เลขที่เอกสาร', size: 'xs', color: '#888888', weight: 'bold', flex: 4 },
                                    { type: 'text', text: 'ชื่อบริษัท', size: 'xs', color: '#888888', weight: 'bold', flex: 6 }
                                ]
                            },
                            {
                                type: 'separator',
                                margin: 'xs'
                            },
                            {
                                type: 'box',
                                layout: 'vertical',
                                spacing: 'xs',
                                contents: textLinks
                            }
                        ],
                        paddingAll: '16px'
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
// GET /api/customer/search-invoices
// Pre-filtered search to find valid invoices matching tax_id in the last 14 days
// ---------------------------------------------------------------------------
router.get('/search-invoices', async (req, res) => {
    const { tax_id } = req.query;

    if (!tax_id || !tax_id.trim()) {
        return res.status(400).json({ success: false, message: 'Tax ID is required.' });
    }

    try {
        const [rows] = await db.execute(`
            SELECT i.tax_rec_id, i.service_date, i.status, p.customer_name
            FROM invoices i
            INNER JOIN customer_profile p ON i.customer_num = p.customer_num
            WHERE p.tax_id = ?
              AND i.created_at >= DATE_SUB(NOW(), INTERVAL 14 DAY)
            ORDER BY i.created_at DESC
        `, [tax_id.trim()]);

        return res.json({
            success: true,
            invoices: rows
        });
    } catch (error) {
        console.error('Error in search-invoices:', error);
        return res.status(500).json({ success: false, message: 'Internal server error during invoice search.' });
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
        const taxRecIds = tax_rec_id.split(',').map(id => id.trim()).filter(Boolean);
        const uniqueTaxRecIds = [...new Set(taxRecIds)];

        if (uniqueTaxRecIds.length === 0) {
            return res.status(400).json({ success: false, code: 'MISSING_PARAM', message: 'No valid Tax Record IDs found.' });
        }

        const placeholders = uniqueTaxRecIds.map(() => '?').join(',');
        const [invoiceRows] = await db.execute(`
            SELECT i.tax_rec_id, p.tax_id, p.customer_branch, i.status, p.customer_name, p.customer_addr
            FROM invoices i
            LEFT JOIN customer_profile p ON i.customer_num = p.customer_num
            WHERE i.tax_rec_id IN (${placeholders})
        `, uniqueTaxRecIds);

        const invoiceMap = new Map();
        invoiceRows.forEach(row => {
            invoiceMap.set(row.tax_rec_id, row);
        });

        const valid = [];
        const excluded = [];
        let customerName = '';

        for (const id of uniqueTaxRecIds) {
            const invoice = invoiceMap.get(id);
            if (!invoice) {
                excluded.push({ id, reason: 'ไม่พบหมายเลขใบกำกับภาษีนี้' });
                continue;
            }

            if (!invoice.tax_id) {
                excluded.push({ id, reason: 'ใบกำกับภาษียังไม่ได้ผูกข้อมูลลูกค้า' });
                continue;
            }

            if (invoice.tax_id !== tax_id.trim()) {
                excluded.push({ id, reason: 'หมายเลขประจำตัวผู้เสียภาษีไม่ตรงกัน' });
                continue;
            }

            if (!invoice.customer_name || !invoice.customer_addr) {
                excluded.push({ id, reason: 'ข้อมูลที่อยู่ลูกค้ายังไม่สมบูรณ์' });
                continue;
            }

            // All checks passed
            valid.push(invoice);
            if (!customerName) {
                customerName = invoice.customer_name;
            }
        }

        if (valid.length === 0) {
            const reasons = excluded.map(item => `${item.id}: ${item.reason}`).join(', ');
            return res.status(400).json({
                success: false,
                code: 'NO_VALID_INVOICES',
                message: `ไม่มีใบกำกับภาษีที่ถูกต้องสำหรับการดำเนินการนี้ (${reasons})`,
                excluded: excluded.map(item => item.id)
            });
        }

        // Check PDF generation state for all valid ones
        const validTaxRecIds = valid.map(v => v.tax_rec_id);
        const pdfPlaceholders = validTaxRecIds.map(() => '?').join(',');
        const [pdfRows] = await db.execute(`
            SELECT tax_rec_id FROM generated_documents WHERE tax_rec_id IN (${pdfPlaceholders})
        `, validTaxRecIds);

        const pdfExistsMap = new Set(pdfRows.map(r => r.tax_rec_id));
        const allHavePdf = valid.every(v => v.status === 'ready' && pdfExistsMap.has(v.tax_rec_id));

        return res.json({
            success: true,
            code: allHavePdf ? 'READY_WITH_PDF' : 'READY_NO_PDF',
            pdf_state: allHavePdf ? 'ready' : 'no_pdf',
            customer_name: customerName,
            valid: validTaxRecIds,
            excluded: excluded.map(item => `${item.id} (${item.reason})`)
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
    const { line_user_id, line_display_name, tax_rec_id, tax_id, send_method, email_sending } = req.body;

    const method = send_method || 'email'; // fallback for backward compatibility
    const fullLineId = line_display_name ? `${line_user_id}:${line_display_name}` : line_user_id;
    const lineUsername = line_display_name ? `[c]${line_display_name}` : '[c]Customer';

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
        logActivity('REQ_FULL_TAX', `${tax_rec_id}:${tax_id}:${method === 'email' ? email_sending : fullLineId}`, lineUsername);

        const taxRecIds = tax_rec_id.split(',').map(id => id.trim()).filter(Boolean);
        const uniqueTaxRecIds = [...new Set(taxRecIds)];

        if (uniqueTaxRecIds.length === 0) {
            return res.status(400).json({ success: false, message: 'No valid Tax Record IDs provided' });
        }

        const placeholders = uniqueTaxRecIds.map(() => '?').join(',');
        const [rows] = await db.execute(`
            SELECT i.tax_rec_id, p.tax_id, p.customer_branch, i.status,
                   p.customer_name AS customer, p.customer_addr AS customer_addr
            FROM invoices i
            LEFT JOIN customer_profile p ON i.customer_num = p.customer_num
            WHERE i.tax_rec_id IN (${placeholders})
        `, uniqueTaxRecIds);

        const validInvoices = rows.filter(record => 
            record.tax_id &&
            record.tax_id === tax_id.trim() &&
            record.customer &&
            record.customer_addr
        );

        if (validInvoices.length === 0) {
            return res.status(400).json({ success: false, message: 'ไม่มีใบกำกับภาษีที่ถูกต้องตรงตามเงื่อนไขเพื่อส่งข้อมูล' });
        }

        const validTaxRecIds = validInvoices.map(v => v.tax_rec_id);
        const customerName = validInvoices[0].customer;

        // Query PDF existence for valid invoices
        const pdfPlaceholders = validTaxRecIds.map(() => '?').join(',');
        const [pdfRows] = await db.execute(`
            SELECT tax_rec_id, pdf_folder FROM generated_documents WHERE tax_rec_id IN (${pdfPlaceholders})
        `, validTaxRecIds);

        const pdfMap = new Map();
        pdfRows.forEach(r => pdfMap.set(r.tax_rec_id, r.pdf_folder));

        const allHavePdf = validInvoices.every(v => v.status === 'ready' && pdfMap.has(v.tax_rec_id));

        // Background PDF generation and dispatch
        (async () => {
            try {
                const pdfData = [];
                for (const record of validInvoices) {
                    let pdfPath = record.status === 'ready' ? pdfMap.get(record.tax_rec_id) : null;
                    if (!pdfPath) {
                        pdfPath = await generatePdf(record.tax_rec_id);
                        await logActivity('ONTHEFLY_GEN_PDF', `${record.tax_rec_id}:${tax_id}:${method}:${pdfPath}`, lineUsername);
                    }
                    const baseUrl = getBaseUrl(req);
                    const pdfPublicUrl = `${baseUrl}${pdfPath}`;
                    pdfData.push({
                        taxRecId: record.tax_rec_id,
                        pdfRelPath: pdfPath,
                        pdfUrl: pdfPublicUrl,
                        companyName: record.customer
                    });
                }

                if (method === 'email') {
                    await sendInvoiceEmail(email_sending, tax_id, pdfData);
                    await logActivity('SENDING_EMAIL_MULTI', `${email_sending}:${validTaxRecIds.join(',')}`, lineUsername);
                } else if (method === 'line') {
                    await sendLineMultiPdfLink(line_user_id, tax_id, customerName, pdfData);
                    await logActivity('SENDING_LINE_MULTI', `${validTaxRecIds.join(',')}:${fullLineId}`, lineUsername);
                }
            } catch (dispatchErr) {
                console.error('[customer] Request invoice dispatch failed:', dispatchErr);
            }
        })();

        const returnMsg = method === 'email'
            ? 'โปรดตรวจสอบอีเมล์ของคุณในอีก 1-2 นาที'
            : (allHavePdf 
                ? 'โปรดรอสักครู่ กำลังส่ง Link ให้คุณทางไลน์เพื่อดาวโหลด' 
                : 'โปรดรอ 1-2 นาที เพื่อสร้างใบกำกับภาษีในรูปแบบ PDF และส่ง Link ให้คุณทางไลน์เพื่อดาวโหลด');

        return res.json({ success: true, message: returnMsg });

    } catch (error) {
        console.error('Error requesting invoice:', error);
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
});

function getBaseUrl(req) {
    if (req) {
        // 1. Try to get origin from Referer header (the page URL loaded on phone/PC)
        const referer = req.get('referer');
        if (referer) {
            try {
                const parsed = new URL(referer);
                if (parsed.origin && !parsed.origin.includes('your-domain.com')) {
                    return parsed.origin;
                }
            } catch (e) {
                // Ignore parsing errors
            }
        }

        // 2. Try Origin header
        const origin = req.get('origin');
        if (origin && !origin.includes('your-domain.com')) {
            return origin;
        }

        // 3. Try request protocol and host headers (resolved via 'trust proxy')
        const host = req.get('host');
        if (host && !host.includes('your-domain.com')) {
            return `${req.protocol}://${host}`;
        }
    }

    // 4. Fallback to process.env.BASE_URL if it is not the placeholder
    const envUrl = process.env.BASE_URL;
    if (envUrl && !envUrl.includes('your-domain.com')) {
        return envUrl;
    }

    // 5. Hard fallback
    return `http://localhost:${process.env.PORT || 3000}`;
}

module.exports = router;
