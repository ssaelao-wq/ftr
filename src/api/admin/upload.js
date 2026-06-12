const express = require('express');
const router = express.Router();
const multer = require('multer');
const { parse } = require('csv-parse/sync');
const db = require('../../db');
const { logActivity } = require('../../logger');

const upload = multer({ storage: multer.memoryStorage() });

// Helper to convert date format from DD/MM/YYYY to YYYY-MM-DD
function parseCSVDate(dateStr) {
    if (!dateStr) return null;
    const parts = dateStr.trim().split('/');
    if (parts.length === 3) {
        const day = parts[0].padStart(2, '0');
        const month = parts[1].padStart(2, '0');
        let year = parseInt(parts[2], 10);
        // Handle Buddhist Era if any (though in sample it's 2026, which is Christian Era)
        if (year > 2400) {
            year = year - 543;
        }
        return `${year}-${month}-${day}`;
    }
    return null;
}

// POST /api/admin/upload/cdms
router.post('/cdms', upload.single('file'), async (req, res) => {
    const username = req.session.adminUser ? req.session.adminUser.username : 'system';
    
    if (!req.file) {
        return res.status(400).json({ success: false, message: 'No file uploaded.' });
    }

    try {
        const buffer = req.file.buffer;
        let isUtf8 = true;
        try {
            new TextDecoder('utf-8', { fatal: true }).decode(buffer);
        } catch (err) {
            isUtf8 = false;
        }
        const encoding = isUtf8 ? 'utf-8' : 'windows-874';
        const decoder = new TextDecoder(encoding);
        const csvContent = decoder.decode(buffer);
        const records = parse(csvContent, {
            delimiter: '|',
            columns: true,
            skip_empty_lines: true,
            trim: true
        });

        if (records.length === 0) {
            return res.status(400).json({ success: false, message: 'CSV file is empty.' });
        }

        // Validate required columns
        const requiredColumns = ['InvoiceNo', 'InvoiceDate', 'PartNumber', 'PartName', 'Qty', 'Price', 'Amount'];
        const firstRecord = records[0];
        const headers = Object.keys(firstRecord);
        const missingColumns = requiredColumns.filter(col => !headers.includes(col));

        if (missingColumns.length > 0) {
            return res.status(400).json({ 
                success: false, 
                message: `Invalid CSV columns. Missing required column(s): ${missingColumns.join(', ')}` 
            });
        }

        // Validate internal header consistency (dates must be identical for same InvoiceNo)
        const uniqueInvoiceNos = new Set();
        const invoiceMetadataMap = new Map();

        for (let i = 0; i < records.length; i++) {
            const r = records[i];
            const invNo = r.InvoiceNo.trim();
            const invDate = r.InvoiceDate.trim();

            if (!invNo) {
                return res.status(400).json({ success: false, message: `Empty InvoiceNo found on line ${i + 2}.` });
            }

            uniqueInvoiceNos.add(invNo);

            if (!invoiceMetadataMap.has(invNo)) {
                invoiceMetadataMap.set(invNo, { date: invDate });
            } else {
                const existing = invoiceMetadataMap.get(invNo);
                if (existing.date !== invDate) {
                    return res.status(400).json({
                        success: false,
                        message: `CSV Data Conflict: InvoiceNo "${invNo}" has inconsistent Date across rows.`
                    });
                }
            }
        }

        const uniqueInvoiceNosArr = [...uniqueInvoiceNos];

        const [existingDbRows] = await db.query(
            'SELECT tax_rec_id FROM invoices WHERE tax_rec_id IN (?)',
            [uniqueInvoiceNosArr]
        );

        if (existingDbRows.length > 0) {
            const existingIds = existingDbRows.map(row => row.tax_rec_id);
            return res.status(400).json({
                success: false,
                message: `Some Invoices already exist, cancel uploading. Duplicate record: ${existingIds.slice(0, 10).join(', ')}${existingIds.length > 10 ? ' ... and others' : ''}`
            });
        }

        // Group rows by InvoiceNo for transaction insertion
        const invoicesGroupMap = new Map();
        for (const r of records) {
            const invNo = r.InvoiceNo.trim();
            if (!invoicesGroupMap.has(invNo)) {
                invoicesGroupMap.set(invNo, {
                    tax_rec_id: invNo,
                    service_date: parseCSVDate(r.InvoiceDate),
                    items: []
                });
            }
            invoicesGroupMap.get(invNo).items.push({
                part_desc: `${r.PartNumber.trim()} ${r.PartName.trim()}`.trim(),
                price: parseFloat(r.Price) || 0,
                unit_num: parseFloat(r.Qty) || 0,
                amount: parseFloat(r.Amount) || 0
            });
        }

        // Database transaction execution
        const connection = await db.getConnection();
        await connection.beginTransaction();

        try {
            for (const [tax_rec_id, inv] of invoicesGroupMap.entries()) {
                // Insert into Parent invoices table
                await connection.execute(
                    'INSERT INTO invoices (tax_rec_id, service_date, status, is_accounting_exported) VALUES (?, ?, ?, ?)',
                    [inv.tax_rec_id, inv.service_date, 'pending', false]
                );

                // Insert into Child invoices_rec table
                for (const item of inv.items) {
                    await connection.execute(
                        'INSERT INTO invoices_rec (tax_rec_id, part_desc, price, unit_num, amount) VALUES (?, ?, ?, ?, ?)',
                        [tax_rec_id, item.part_desc, item.price, item.unit_num, item.amount]
                    );
                }
            }

            await connection.commit();
        } catch (txErr) {
            await connection.rollback();
            throw txErr;
        } finally {
            connection.release();
        }

        await logActivity('REQ_UPLOAD_CDMS', `${username}:${invoicesGroupMap.size}`, username);

        res.json({
            success: true,
            message: `Successfully imported ${invoicesGroupMap.size} unique invoices with ${records.length} item records.`
        });

    } catch (error) {
        console.error('CSV upload/parse error:', error);
        res.status(500).json({ success: false, message: 'Internal server error during CSV upload.' });
    }
});

// POST /api/admin/upload/customer-profile
router.post('/customer-profile', upload.single('file'), async (req, res) => {
    const username = req.session.adminUser ? req.session.adminUser.username : 'system';
    
    if (!req.file) {
        return res.status(400).json({ success: false, message: 'No file uploaded.' });
    }

    try {
        const buffer = req.file.buffer;
        let isUtf8 = true;
        try {
            new TextDecoder('utf-8', { fatal: true }).decode(buffer);
        } catch (err) {
            isUtf8 = false;
        }
        const encoding = isUtf8 ? 'utf-8' : 'windows-874';
        const decoder = new TextDecoder(encoding);
        const csvContent = decoder.decode(buffer);
        
        // Auto-detect delimiter
        let delimiter = '|';
        const firstLine = csvContent.split('\n')[0];
        const commaCount = (firstLine.match(/,/g) || []).length;
        const pipeCount = (firstLine.match(/\|/g) || []).length;
        if (commaCount > pipeCount) {
            delimiter = ',';
        }

        const rawRecords = parse(csvContent, {
            delimiter: delimiter,
            skip_empty_lines: true,
            trim: true
        });

        if (rawRecords.length < 2) {
            return res.status(400).json({ success: false, message: 'CSV file is empty or missing data rows.' });
        }

        const headers = rawRecords[0].map(h => h.trim());

        const requiredMappings = {
            'เลขประจำตัวผู้เสียภาษี': 'tax_id',
            'รหัสลูกค้า': 'customer_num',
            'ชื่อลูกค้า': 'customer_name',
            'ที่อยู่': 'customer_addr',
            'email': 'customer_email',
            'โทรศัพท์': 'customer_phone',
            'ประเภทสาขา': 'branch_type',
            'สาขา': 'branch_code'
        };

        const indexes = {};
        const missing = [];

        for (const [colName, key] of Object.entries(requiredMappings)) {
            let idx = -1;
            if (colName === 'email') {
                idx = headers.findIndex(h => h.toLowerCase().replace('-', '') === 'email');
            } else {
                idx = headers.indexOf(colName);
            }

            if (idx === -1) {
                missing.push(colName);
            } else {
                indexes[key] = idx;
            }
        }

        if (missing.length > 0) {
            return res.status(400).json({
                success: false,
                message: `Invalid CSV columns for Customer Profile. Missing required column(s): ${missing.join(', ')}`
            });
        }

        const connection = await db.getConnection();
        await connection.beginTransaction();

        let importCount = 0;
        let duplicateCount = 0;
        try {
            for (let i = 1; i < rawRecords.length; i++) {
                const r = rawRecords[i];
                if (r.length < headers.length) continue; // Skip malformed rows
                
                const taxId = r[indexes.tax_id] ? r[indexes.tax_id].trim() : '';
                
                // Skip rows without a valid Tax ID
                if (!taxId) {
                    continue;
                }

                const customerNum = r[indexes.customer_num] ? r[indexes.customer_num].trim() : '';
                const customerName = r[indexes.customer_name] ? r[indexes.customer_name].trim() : '';
                const address = r[indexes.customer_addr] ? r[indexes.customer_addr].trim() : '';
                const email = r[indexes.customer_email] ? r[indexes.customer_email].trim() : '';
                const phone = r[indexes.customer_phone] ? r[indexes.customer_phone].trim() : '';
                const branchType = r[indexes.branch_type] ? r[indexes.branch_type].trim() : '';
                const branchCode = r[indexes.branch_code] ? r[indexes.branch_code].trim() : '';

                let customerBranch = null;
                if (branchType === 'สำนักงานใหญ่') {
                    customerBranch = 'สำนักงานใหญ่';
                } else if (branchType === 'สาขาย่อย') {
                    customerBranch = branchCode;
                }

                // Check if tax_id and customer_branch combination exists
                const [existing] = await connection.execute(
                    'SELECT id FROM customer_profile WHERE tax_id = ? AND customer_branch = ?', 
                    [taxId, customerBranch]
                );

                if (existing.length > 0) {
                    duplicateCount++;
                } else {
                    await connection.execute(`
                        INSERT INTO customer_profile 
                        (tax_id, customer_num, customer_name, customer_addr, customer_email, customer_phone, customer_branch, is_accounting_exported)
                        VALUES (?, ?, ?, ?, ?, ?, ?, TRUE)
                    `, [taxId, customerNum, customerName, address, email, phone, customerBranch]);
                    importCount++;
                }
            }

            await connection.commit();
        } catch (txErr) {
            await connection.rollback();
            throw txErr;
        } finally {
            connection.release();
        }

        await logActivity('REQ_UPLOAD_CUSTOMER', `${username}:${importCount}`, username);

        if (importCount === 0) {
            return res.status(400).json({
                success: false,
                message: `All records fail to save`
            });
        }

        if (duplicateCount > 0) {
            return res.json({
                success: true,
                message: `Can be saved some records`
            });
        }

        res.json({
            success: true,
            message: `Successfully imported ${importCount} customer profiles.`
        });

    } catch (error) {
        console.error('Customer CSV upload error:', error);
        res.status(500).json({ success: false, message: 'Internal server error during Customer Profile upload.' });
    }
});

module.exports = router;
