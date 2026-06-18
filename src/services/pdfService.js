const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const db = require('../db');
const thaiBahtText = require('../utils/thaiBaht');

/**
 * Helper to format currency numbers to THB currency format (2 decimal places and commas)
 * @param {number} value 
 * @returns {string} Formatted string
 */
function formatCurrency(value) {
    return Number(value).toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
}

/**
 * Formats date to DD/MM/YY (Buddhist Era year if standard Thai invoice)
 * @param {Date|string} dateInput 
 * @returns {string} Formatted date
 */
function formatDateInvoice(dateInput) {
    if (!dateInput) return '';
    const date = new Date(dateInput);
    if (isNaN(date.getTime())) return String(dateInput);

    const dd = String(date.getDate()).padStart(2, '0');
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    // For BE year (common in Thai tax documents), add 543 to Christian year.
    // e.g. 2026 + 543 = 2569 -> "69"
    const christianYear = date.getFullYear();
    const beYear = christianYear + (christianYear < 2400 ? 543 : 0);
    const yy = String(beYear).slice(-2);
    
    return `${dd}/${mm}/${yy}`;
}

/**
 * Formats a quantity number to 2 decimal places (e.g. 1 -> "1.00")
 * @param {number} value 
 * @returns {string} Formatted string
 */
function formatQty(value) {
    return Number(value).toFixed(2);
}


/**
 * Core function to generate PDF from database record
 * @param {string} taxRecId - The ID of the invoice record
 * @returns {Promise<string>} Path to the generated PDF
 */
async function generatePdf(taxRecId) {
    // 1. Fetch Header Info with joined customer profile details
    const [headerRows] = await db.execute(`
        SELECT i.tax_rec_id, p.tax_id, p.customer_branch, i.container_num, i.booking_num, i.service_date, i.status,
               p.customer_num, p.customer_name, p.customer_addr
        FROM invoices i
        LEFT JOIN customer_profile p ON i.customer_num = p.customer_num
        WHERE i.tax_rec_id = ?
    `, [taxRecId]);
    if (headerRows.length === 0) {
        throw new Error(`Invoice header not found for tax_rec_id: ${taxRecId}`);
    }
    const header = headerRows[0];

    // 2. Fetch Item Records
    const [itemRows] = await db.execute('SELECT * FROM invoices_rec WHERE tax_rec_id = ? ORDER BY rec_id ASC', [taxRecId]);
    
    // 3. Perform Calculations
    let subtotal = 0;
    let itemsHtml = '';
    let rowCount = 0;
    const TOTAL_ROWS = 10; // Target total rows for items + containers + padding to fill page perfectly

    // 1. Add item rows
    itemRows.forEach((item, index) => {
        const itemAmount = Number(item.amount) || (Number(item.price) * Number(item.unit_num)) || 0;
        subtotal += itemAmount;

        itemsHtml += `
            <tr style="height: 22px;">
                <td class="text-center">${index + 1}</td>
                <td class="text-left">${item.part_desc || ''}</td>
                <td class="text-center">${formatQty(item.unit_num)}</td>
                <td class="text-center">UNIT</td>
                <td class="text-right">${formatCurrency(item.price)}</td>
                <td class="text-right">${formatCurrency(itemAmount)}</td>
            </tr>
        `;
        rowCount++;
    });

    // 2. Add BKG and CNTR rows (if either has a value)
    const bookingNum = (header.booking_num || '').trim();
    const containerNum = (header.container_num || '').trim();
    const hasBkg = bookingNum.length > 0;
    const hasCntr = containerNum.length > 0;

    if (hasBkg || hasCntr) {
        // BKG line
        if (rowCount < TOTAL_ROWS) {
            itemsHtml += `
                <tr style="height: 22px;">
                    <td class="text-center">&nbsp;</td>
                    <td class="text-left" style="padding-left: 20px;">BKG: ${bookingNum}</td>
                    <td class="text-center"></td>
                    <td class="text-center"></td>
                    <td class="text-right"></td>
                    <td class="text-right"></td>
                </tr>
            `;
            rowCount++;
        }
        // CNTR line
        if (rowCount < TOTAL_ROWS) {
            itemsHtml += `
                <tr style="height: 22px;">
                    <td class="text-center">&nbsp;</td>
                    <td class="text-left" style="padding-left: 20px;">CNTR: ${containerNum}</td>
                    <td class="text-center"></td>
                    <td class="text-center"></td>
                    <td class="text-right"></td>
                    <td class="text-right"></td>
                </tr>
            `;
            rowCount++;
        }
    }

    // 3. Add empty padding rows to reach TOTAL_ROWS
    while (rowCount < TOTAL_ROWS) {
        itemsHtml += `
            <tr style="height: 22px;">
                <td class="text-center">&nbsp;</td>
                <td></td>
                <td></td>
                <td></td>
                <td></td>
                <td></td>
            </tr>
        `;
        rowCount++;
    }

    const vatRate = 0.07;
    const vat = subtotal * vatRate;
    const totalAmount = subtotal + vat;
    const bahtTextStr = thaiBahtText(totalAmount);

    // 4. Load & Populate Template
    const templatePath = path.join(__dirname, '../templates/invoice.html');
    let htmlContent = fs.readFileSync(templatePath, 'utf8');

    // Load logo base64
    const logoPath = path.join(__dirname, '../../unicon_logo_withline.jpg');
    let logoBase64 = '';
    if (fs.existsSync(logoPath)) {
        logoBase64 = 'data:image/jpeg;base64,' + fs.readFileSync(logoPath, 'base64');
    }

    // Replace all template placeholders
    htmlContent = htmlContent
        // Logo
        .replace(/{{logoBase64}}/g, logoBase64)
        // Customer info
        .replace(/{{customer}}/g, header.customer_num || '')
        .replace(/{{customerCompanyName}}/g, header.customer_name || '')
        .replace(/{{customerAddr}}/g, (header.customer_addr || '').replace(/\n/g, '<br>'))
        .replace(/{{taxId}}/g, header.tax_id || '')
        .replace(/{{customerBranch}}/g, header.customer_branch || '')
        // Invoice metadata
        .replace(/{{invoiceNo}}/g, header.tax_rec_id || '')
        .replace(/{{invoiceDate}}/g, formatDateInvoice(header.service_date))
        // Items
        .replace(/{{itemRows}}/g, itemsHtml)
        // Summary calculations
        .replace(/{{subtotal}}/g, formatCurrency(subtotal))
        .replace(/{{discount}}/g, formatCurrency(0))
        .replace(/{{afterDiscount}}/g, formatCurrency(subtotal))
        .replace(/{{deposit}}/g, formatCurrency(0))
        .replace(/{{afterDeposit}}/g, formatCurrency(subtotal))
        .replace(/{{vat}}/g, formatCurrency(vat))
        .replace(/{{totalAmount}}/g, formatCurrency(totalAmount))
        .replace(/{{bahtText}}/g, `( ${bahtTextStr} )`);

    // 5. Setup storage path
    const pdfDir = path.join(__dirname, '../../storage/pdfs');
    if (!fs.existsSync(pdfDir)) {
        fs.mkdirSync(pdfDir, { recursive: true });
    }
    const pdfPath = path.join(pdfDir, `FTR_${taxRecId}.pdf`);
    const relativePdfPath = `/storage/pdfs/FTR_${taxRecId}.pdf`;

    // 6. Generate PDF via Puppeteer
    // Determine Chrome executable path. Prefer system-installed Chrome so we
    // don't rely on the puppeteer cache (which may point to a different user's
    // home directory if `npm install` was run under a different account).
    const os = require('os');
    const chromePaths = process.platform === 'win32'
        ? [
            'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
            'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
            path.join(os.homedir(), 'AppData\\Local\\Google\\Chrome\\Application\\chrome.exe'),
            'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
          ]
        : [
            '/usr/bin/google-chrome',
            '/usr/bin/chromium-browser',
            '/usr/bin/chromium',
          ];

    let executablePath;
    for (const p of chromePaths) {
        if (fs.existsSync(p)) {
            executablePath = p;
            break;
        }
    }
    // Fall back to puppeteer's bundled path (may fail if cache is wrong user)
    // Note: in puppeteer v22+, executablePath() returns a Promise — must await it.
    if (!executablePath) {
        executablePath = await puppeteer.executablePath();
    }

    const browser = await puppeteer.launch({
        headless: 'new',
        executablePath,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            `--user-data-dir=${path.join(os.tmpdir(), 'puppeteer_profile_' + Date.now())}`
        ]
    });
    
    try {
        const page = await browser.newPage();
        await page.setContent(htmlContent, { waitUntil: 'load' });
        await page.pdf({
            path: pdfPath,
            format: 'A4',
            printBackground: true,
            margin: {
                top: '10mm',
                bottom: '8mm',
                left: '12mm',
                right: '12mm'
            }
        });
    } finally {
        await browser.close();
    }

    // 7. Write to generated_documents & update status
    // Check if doc metadata already exists
    const [existingDocs] = await db.execute('SELECT id FROM generated_documents WHERE tax_rec_id = ?', [taxRecId]);
    if (existingDocs.length === 0) {
        await db.execute(
            'INSERT INTO generated_documents (tax_rec_id, pdf_folder) VALUES (?, ?)',
            [taxRecId, relativePdfPath]
        );
    } else {
        await db.execute(
            'UPDATE generated_documents SET pdf_folder = ?, generated_at = CURRENT_TIMESTAMP WHERE tax_rec_id = ?',
            [relativePdfPath, taxRecId]
        );
    }

    await db.execute('UPDATE invoices SET status = ? WHERE tax_rec_id = ?', ['ready', taxRecId]);

    return relativePdfPath;
}

module.exports = {
    generatePdf,
    formatCurrency,
    formatDateInvoice
};
