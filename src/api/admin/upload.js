const express = require('express');
const router = express.Router();
const multer = require('multer');
const { parse } = require('csv-parse/sync');
const db = require('../../db');
const { logActivity } = require('../../logger');
const config = require('../../config');

const upload = multer({ storage: multer.memoryStorage() });

// Configured list of ZIM PartNames for fast lookups
const zimPartsSet = new Set(
    (config.ZIM_PART_NAME_LIST || []).map(name => name.trim().toLowerCase())
);

// Helper function to check if the record needs a ZIM prefix
function shouldPrefixZim(customerCode, partName) {
    if (!customerCode || !partName) return false;
    const cleanCode = customerCode.trim().toUpperCase();
    const cleanPart = partName.trim().toLowerCase();
    
    // Checks if CustomerCode starts with "ZIM" (e.g. ZIM, ZIM (THAILAND) CO.,LTD.)
    return cleanCode.startsWith('ZIM') && zimPartsSet.has(cleanPart);
}

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

        const existingIdsSet = new Set(existingDbRows.map(row => row.tax_rec_id));
        const duplicateCount = existingIdsSet.size;

        // Group rows by InvoiceNo for transaction insertion, skipping duplicates
        const invoicesGroupMap = new Map();
        for (const r of records) {
            const invNo = r.InvoiceNo.trim();
            if (existingIdsSet.has(invNo)) {
                continue; // Skip this duplicate record
            }
            if (!invoicesGroupMap.has(invNo)) {
                invoicesGroupMap.set(invNo, {
                    tax_rec_id: invNo,
                    service_date: parseCSVDate(r.InvoiceDate),
                    items: []
                });
            }

            const rawPartName = r.PartName ? r.PartName.trim() : '';
            const customerCode = r.CustomerCode ? r.CustomerCode.trim() : '';
            let finalPartDesc = '';
            
            if (shouldPrefixZim(customerCode, rawPartName)) {
                finalPartDesc = `ZIM - 02 ${rawPartName}`;
            } else {
                const partNum = r.PartNumber ? r.PartNumber.trim() : '';
                finalPartDesc = `${partNum} ${rawPartName}`.trim();
            }

            invoicesGroupMap.get(invNo).items.push({
                part_desc: finalPartDesc,
                price: parseFloat(r.Price) || 0,
                unit_num: parseFloat(r.Qty) || 0,
                amount: parseFloat(r.Amount) || 0,
                raw_row: JSON.stringify(r)
            });
        }

        if (invoicesGroupMap.size === 0) {
            await logActivity('REQ_UPLOAD_CDMS', `${username}:0 (all ${duplicateCount} duplicate skipped)`, username);
            return res.json({
                success: true,
                message: `No new invoices were imported. All ${duplicateCount} invoices already exist in the system.`
            });
        }

        // Database transaction execution
        const connection = await db.getConnection();
        let transactionStarted = false;
        try {
            await connection.beginTransaction();
            transactionStarted = true;
            for (const [tax_rec_id, inv] of invoicesGroupMap.entries()) {
                // Insert into Parent invoices table, setting is_accounting_exported = TRUE (Exported / not pending initially)
                await connection.execute(
                    'INSERT INTO invoices (tax_rec_id, service_date, status, is_accounting_exported) VALUES (?, ?, ?, ?)',
                    [inv.tax_rec_id, inv.service_date, 'pending', true]
                );

                // Insert into Child invoices_rec table
                for (const item of inv.items) {
                    await connection.execute(
                        'INSERT INTO invoices_rec (tax_rec_id, part_desc, price, unit_num, amount, raw_cdms_row) VALUES (?, ?, ?, ?, ?, ?)',
                        [tax_rec_id, item.part_desc, item.price, item.unit_num, item.amount, item.raw_row]
                    );
                }
            }

            await connection.commit();
        } catch (txErr) {
            if (transactionStarted) {
                await connection.rollback().catch(() => {});
            }
            throw txErr;
        } finally {
            connection.release();
        }

        await logActivity('REQ_UPLOAD_CDMS', `${username}:${invoicesGroupMap.size}`, username);

        res.json({
            success: true,
            message: `Successfully imported ${invoicesGroupMap.size} new invoices. Skipped ${duplicateCount} duplicate invoices.`
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
        let transactionStarted = false;
        try {
            await connection.beginTransaction();
            transactionStarted = true;

            let importCount = 0;
            let duplicateCount = 0;
            const skippedTaxIds = [];

            for (let i = 1; i < rawRecords.length; i++) {
                const r = rawRecords[i];
                if (r.length < headers.length) continue; // Skip malformed rows
                
                const taxId = r[indexes.tax_id] ? r[indexes.tax_id].trim() : '';
                const customerNum = r[indexes.customer_num] ? r[indexes.customer_num].trim() : '';

                // Skip completely empty Tax ID silently
                if (!taxId) {
                    continue;
                }

                // Handle less or more than 13 digits: ignore and log
                if (taxId.length !== 13 || !/^\d+$/.test(taxId)) {
                    skippedTaxIds.push({
                        row: i + 1,
                        customerNum: customerNum,
                        taxId: taxId,
                        reason: taxId.length !== 13 ? `Length is ${taxId.length} (must be 13)` : 'Contains non-digit characters'
                    });
                    continue;
                }

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

                // Check if customer_num already exists
                const [existing] = await connection.execute(
                    'SELECT id FROM customer_profile WHERE customer_num = ?', 
                    [customerNum]
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
            
            // Pass variables to outer scope
            res.locals.importCount = importCount;
            res.locals.duplicateCount = duplicateCount;
            res.locals.skippedTaxIds = skippedTaxIds;
        } catch (txErr) {
            if (transactionStarted) {
                await connection.rollback().catch(() => {});
            }
            throw txErr;
        } finally {
            connection.release();
        }

        const importCount = res.locals.importCount;
        const duplicateCount = res.locals.duplicateCount;
        const skippedTaxIds = res.locals.skippedTaxIds;

        await logActivity('REQ_UPLOAD_CUSTOMER', `${username}:${importCount}`, username);

        let message = `Successfully imported ${importCount} customer profiles.`;
        if (duplicateCount > 0) {
            message += ` ${duplicateCount} duplicate records were skipped.`;
        }
        if (skippedTaxIds.length > 0) {
            message += `\n\nIgnored ${skippedTaxIds.length} records with invalid Tax ID (must be exactly 13 digits):\n` + 
                skippedTaxIds.map(item => `- Row ${item.row} (Cust Code: ${item.customerNum || 'N/A'}): "${item.taxId}" (${item.reason})`).join('\n');
        }

        if (importCount === 0) {
            let errorMsg = `All records failed to save.`;
            if (skippedTaxIds.length > 0) {
                errorMsg += `\n\nIgnored ${skippedTaxIds.length} records with invalid Tax ID (must be exactly 13 digits):\n` +
                    skippedTaxIds.map(item => `- Row ${item.row} (Cust Code: ${item.customerNum || 'N/A'}): "${item.taxId}" (${item.reason})`).join('\n');
            }
            return res.status(400).json({
                success: false,
                message: errorMsg,
                skipped: skippedTaxIds
            });
        }

        res.json({
            success: true,
            message: message,
            importCount,
            duplicateCount,
            skippedCount: skippedTaxIds.length,
            skipped: skippedTaxIds
        });

    } catch (error) {
        console.error('Customer CSV upload error:', error);
        res.status(500).json({ success: false, message: 'Internal server error during Customer Profile upload.' });
    }
});

// Helper: append a value to a comma-separated field, deduplicating
function appendDedup(existing, newVal) {
    if (!newVal || !newVal.trim()) return existing || null;
    const trimmed = newVal.trim();
    if (!existing) return trimmed;
    const parts = existing.split(',').map(s => s.trim()).filter(s => s);
    if (parts.includes(trimmed)) return existing; // duplicate, skip
    parts.push(trimmed);
    return parts.join(',');
}

// POST /api/admin/upload/gate-in
// Gate-In file: 7th column (index 6) = Receipt No. -> match invoices.tax_rec_id
//               4th column (index 3) = Container No. -> append to invoices.container_num
router.post('/gate-in', upload.single('file'), async (req, res) => {
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
        const rawRecords = parse(csvContent, {
            delimiter: '|',
            skip_empty_lines: true,
            trim: true
        });

        if (rawRecords.length < 2) {
            return res.status(400).json({ success: false, message: 'File is empty or missing data rows.' });
        }

        // Skip header row (index 0), process data rows
        let matchedCount = 0;
        let unmatchedCount = 0;

        const connection = await db.getConnection();
        let transactionStarted = false;
        try {
            await connection.beginTransaction();
            transactionStarted = true;

            for (let i = 1; i < rawRecords.length; i++) {
                const row = rawRecords[i];
                const receiptNo = row[6] ? row[6].trim() : '';       // 7th column (index 6)
                const containerNo = row[3] ? row[3].trim() : '';     // 4th column (index 3)

                if (!receiptNo) {
                    unmatchedCount++;
                    continue;
                }

                // Find matching invoice
                const [invoices] = await connection.execute(
                    'SELECT tax_rec_id, container_num FROM invoices WHERE tax_rec_id = ?',
                    [receiptNo]
                );

                if (invoices.length === 0) {
                    unmatchedCount++;
                    continue;
                }

                const invoice = invoices[0];
                const updatedContainer = appendDedup(invoice.container_num, containerNo);

                await connection.execute(
                    'UPDATE invoices SET container_num = ? WHERE tax_rec_id = ?',
                    [updatedContainer, receiptNo]
                );
                matchedCount++;
            }

            await connection.commit();
        } catch (txErr) {
            if (transactionStarted) {
                await connection.rollback().catch(() => {});
            }
            throw txErr;
        } finally {
            connection.release();
        }

        await logActivity('REQ_UPLOAD_GATEIN', `${username}:matched=${matchedCount},unmatched=${unmatchedCount}`, username);

        res.json({
            success: true,
            message: `Gate-In import completed. ${matchedCount} records updated, ${unmatchedCount} records not matched.`
        });

    } catch (error) {
        console.error('Gate-In upload error:', error);
        res.status(500).json({ success: false, message: 'Internal server error during Gate-In upload.' });
    }
});

// POST /api/admin/upload/gate-out
// Gate-Out file: 9th column (index 8) = Receipt No. -> match invoices.tax_rec_id
//                3rd column (index 2) = BKG# -> append to invoices.booking_num
//                6th column (index 5) = Container No. -> append to invoices.container_num
router.post('/gate-out', upload.single('file'), async (req, res) => {
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
        const rawRecords = parse(csvContent, {
            delimiter: '|',
            skip_empty_lines: true,
            trim: true
        });

        if (rawRecords.length < 2) {
            return res.status(400).json({ success: false, message: 'File is empty or missing data rows.' });
        }

        // Skip header row (index 0), process data rows
        let matchedCount = 0;
        let unmatchedCount = 0;

        const connection = await db.getConnection();
        let transactionStarted = false;
        try {
            await connection.beginTransaction();
            transactionStarted = true;

            for (let i = 1; i < rawRecords.length; i++) {
                const row = rawRecords[i];
                const receiptNo = row[8] ? row[8].trim() : '';       // 9th column (index 8)
                const bookingNo = row[2] ? row[2].trim() : '';       // 3rd column (index 2)
                const containerNo = row[5] ? row[5].trim() : '';     // 6th column (index 5)

                if (!receiptNo) {
                    unmatchedCount++;
                    continue;
                }

                // Find matching invoice
                const [invoices] = await connection.execute(
                    'SELECT tax_rec_id, booking_num, container_num FROM invoices WHERE tax_rec_id = ?',
                    [receiptNo]
                );

                if (invoices.length === 0) {
                    unmatchedCount++;
                    continue;
                }

                const invoice = invoices[0];
                const updatedBooking = appendDedup(invoice.booking_num, bookingNo);
                const updatedContainer = appendDedup(invoice.container_num, containerNo);

                await connection.execute(
                    'UPDATE invoices SET booking_num = ?, container_num = ? WHERE tax_rec_id = ?',
                    [updatedBooking, updatedContainer, receiptNo]
                );
                matchedCount++;
            }

            await connection.commit();
        } catch (txErr) {
            if (transactionStarted) {
                await connection.rollback().catch(() => {});
            }
            throw txErr;
        } finally {
            connection.release();
        }

        await logActivity('REQ_UPLOAD_GATEOUT', `${username}:matched=${matchedCount},unmatched=${unmatchedCount}`, username);

        res.json({
            success: true,
            message: `Gate-Out import completed. ${matchedCount} records updated, ${unmatchedCount} records not matched.`
        });

    } catch (error) {
        console.error('Gate-Out upload error:', error);
        res.status(500).json({ success: false, message: 'Internal server error during Gate-Out upload.' });
    }
});

module.exports = router;
