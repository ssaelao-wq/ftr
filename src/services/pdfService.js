const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const db = require('../db');
const thaiBahtText = require('../utils/thaiBaht');
const { getBKKDate } = require('../utils/timezone');

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
    const date = getBKKDate(dateInput);
    if (isNaN(date.getTime())) return String(dateInput);

    const dd = String(date.getUTCDate()).padStart(2, '0');
    const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
    // For BE year (common in Thai tax documents), add 543 to Christian year.
    // e.g. 2026 + 543 = 2569 -> "69"
    const christianYear = date.getUTCFullYear();
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
 * Formats and wraps a comma-separated container string into lines of maxLineChars.
 * Splits on whitespace, commas, semicolons, and newlines to extract clean container numbers.
 * Re-joins them with a comma and a space, and chunks them to fit the character limits.
 * @param {string} containerStr 
 * @param {number} maxLineChars 
 * @returns {string[]}
 */
function wrapContainerNumbers(containerStr, maxLineChars = 40) {
    if (!containerStr) return [];
    const rawTokens = containerStr.split(/[\s,;\n\r/]+/);
    const containers = rawTokens.map(t => t.trim()).filter(t => t.length > 0);
    
    const lines = [];
    let currentLine = [];
    let currentLength = 0;
    
    for (const container of containers) {
        const addedLength = container.length + (currentLine.length > 0 ? 2 : 0);
        if (currentLength + addedLength <= maxLineChars) {
            currentLine.push(container);
            currentLength += addedLength;
        } else {
            if (currentLine.length > 0) {
                lines.push(currentLine.join(', '));
            }
            currentLine = [container];
            currentLength = container.length;
        }
    }
    if (currentLine.length > 0) {
        lines.push(currentLine.join(', '));
    }
    return lines;
}



/**
 * Core function to generate PDF from database record
 * @param {string} taxRecId - The ID of the invoice record
 * @param {object} [existingBrowser=null] - Optional pre-launched Puppeteer browser instance
 * @returns {Promise<string>} Path to the generated PDF
 */
async function generatePdf(taxRecId, existingBrowser = null) {
    // 1. Fetch Header Info with joined customer profile details
    const [headerRows] = await db.execute(`
        SELECT i.tax_rec_id, p.tax_id, p.customer_branch, i.container_num, i.booking_num, i.service_date, i.status, i.created_at,
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
    const itemObjects = itemRows.map((item, index) => {
        const itemAmount = Number(item.amount) || (Number(item.price) * Number(item.unit_num)) || 0;
        subtotal += itemAmount;
        return {
            type: 'item',
            index: index + 1,
            part_desc: item.part_desc,
            unit_num: item.unit_num,
            price: item.price,
            amount: itemAmount
        };
    });

    const bookingNum = (header.booking_num || '').trim();
    const hasBkg = bookingNum.length > 0;

    // Format & wrap container numbers
    const rawContainerNum = (header.container_num || '');
    const cntrLines = wrapContainerNumbers(rawContainerNum, 40);
    const hasCntr = cntrLines.length > 0;
    const hasBkgCntr = hasBkg || hasCntr;

    // Calculate how many rows BKG & CNTR lines will occupy
    let extraRowsCount = 0;
    if (hasBkg) extraRowsCount += 1;
    if (hasCntr) extraRowsCount += cntrLines.length;

    // Chunking logic to split items into pages
    const MAX_ROWS_PER_PAGE = 9;
    const pages = [];
    const tempItems = [...itemObjects];

    if (hasBkgCntr) {
        const lastPageThreshold = Math.max(1, MAX_ROWS_PER_PAGE - extraRowsCount);
        if (tempItems.length <= lastPageThreshold) {
            pages.push({
                items: tempItems,
                hasBkgCntr: true
            });
        } else {
            while (tempItems.length > lastPageThreshold) {
                pages.push({
                    items: tempItems.splice(0, MAX_ROWS_PER_PAGE),
                    hasBkgCntr: false
                });
            }
            pages.push({
                items: tempItems,
                hasBkgCntr: true
            });
        }
    } else {
        if (tempItems.length === 0) {
            pages.push({
                items: [],
                hasBkgCntr: false
            });
        } else {
            while (tempItems.length > 0) {
                pages.push({
                    items: tempItems.splice(0, MAX_ROWS_PER_PAGE),
                    hasBkgCntr: false
                });
            }
        }
    }

    const totalPages = pages.length;

    // Load & Extract template
    const templatePath = path.join(__dirname, '../templates/invoice.html');
    let htmlContent = fs.readFileSync(templatePath, 'utf8');

    // Load logo base64
    const logoPath = path.join(__dirname, '../../unicon_logo_withline.jpg');
    let logoBase64 = '';
    if (fs.existsSync(logoPath)) {
        logoBase64 = 'data:image/jpeg;base64,' + fs.readFileSync(logoPath, 'base64');
    }

    // Extract the page template between comments
    const templateStartTag = '<!-- START_PAGE_TEMPLATE -->';
    const templateEndTag = '<!-- END_PAGE_TEMPLATE -->';
    const startIdx = htmlContent.indexOf(templateStartTag);
    const endIdx = htmlContent.indexOf(templateEndTag);
    if (startIdx === -1 || endIdx === -1) {
        throw new Error('Template tags START_PAGE_TEMPLATE/END_PAGE_TEMPLATE not found in invoice.html');
    }
    const pageTemplate = htmlContent.substring(startIdx + templateStartTag.length, endIdx);

    const vatRate = 0.07;
    const vat = subtotal * vatRate;
    const totalAmount = subtotal + vat;
    const bahtTextStr = thaiBahtText(totalAmount);

    let pagesHtml = '';

    // Generate each page
    pages.forEach((pageData, pageIdx) => {
        let itemsHtml = '';
        let rowCount = 0;

        // Render item rows
        pageData.items.forEach((item) => {
            itemsHtml += `
                <tr style="height: 22px;">
                    <td class="text-center">${item.index}</td>
                    <td class="text-left">${item.part_desc || ''}</td>
                    <td class="text-center">${formatQty(item.unit_num)}</td>
                    <td class="text-center">UNIT</td>
                    <td class="text-right">${formatCurrency(item.price)}</td>
                    <td class="text-right">${formatCurrency(item.amount)}</td>
                </tr>
            `;
            rowCount++;
        });

        // Append BKG and CNTR rows if needed on this page
        if (pageData.hasBkgCntr) {
            if (hasBkg) {
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
            if (hasCntr) {
                cntrLines.forEach((line, lineIdx) => {
                    const prefix = lineIdx === 0 ? 'CNTR: ' : '&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;';
                    itemsHtml += `
                        <tr style="height: 22px;">
                            <td class="text-center">&nbsp;</td>
                            <td class="text-left" style="padding-left: 20px;">${prefix}${line}</td>
                            <td class="text-center"></td>
                            <td class="text-center"></td>
                            <td class="text-right"></td>
                            <td class="text-right"></td>
                        </tr>
                    `;
                    rowCount++;
                });
            }
        }

        // Pad table with empty rows
        while (rowCount < MAX_ROWS_PER_PAGE) {
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

        // Summary values check
        const isLastPage = (pageIdx === totalPages - 1);
        const subtotalVal = isLastPage ? formatCurrency(subtotal) : '';
        const discountVal = isLastPage ? formatCurrency(0) : '';
        const afterDiscountVal = isLastPage ? formatCurrency(subtotal) : '';
        const depositVal = isLastPage ? formatCurrency(0) : '';
        const afterDepositVal = isLastPage ? formatCurrency(subtotal) : '';
        const vatVal = isLastPage ? formatCurrency(vat) : '';
        const totalAmountVal = isLastPage ? formatCurrency(totalAmount) : '';
        const bahtTextVal = isLastPage ? `( ${bahtTextStr} )` : '( อ่านต่อหน้าถัดไป / Continued on Next Page )';

        // Replace placeholders in page template
        let pageHtml = pageTemplate
            .replace(/{{logoBase64}}/g, logoBase64)
            .replace(/{{customer}}/g, header.customer_num || '')
            .replace(/{{customerCompanyName}}/g, header.customer_name || '')
            .replace(/{{customerAddr}}/g, (header.customer_addr || '').replace(/\n/g, '<br>'))
            .replace(/{{taxId}}/g, header.tax_id || '')
            .replace(/{{customerBranch}}/g, header.customer_branch || '')
            .replace(/{{invoiceNo}}/g, header.tax_rec_id || '')
            .replace(/{{invoiceDate}}/g, formatDateInvoice(header.service_date))
            .replace(/{{pageNumber}}/g, `${pageIdx + 1} / ${totalPages}`)
            .replace(/{{itemRows}}/g, itemsHtml)
            .replace(/{{subtotal}}/g, subtotalVal)
            .replace(/{{discount}}/g, discountVal)
            .replace(/{{afterDiscount}}/g, afterDiscountVal)
            .replace(/{{deposit}}/g, depositVal)
            .replace(/{{afterDeposit}}/g, afterDepositVal)
            .replace(/{{vat}}/g, vatVal)
            .replace(/{{totalAmount}}/g, totalAmountVal)
            .replace(/{{bahtText}}/g, bahtTextVal);

        pagesHtml += pageHtml;
    });

    // Reconstruct the full HTML by placing pages inside <body>
    htmlContent = htmlContent.substring(0, startIdx) + pagesHtml + htmlContent.substring(endIdx + templateEndTag.length);

    // 5. Setup storage path
    const createdAt = getBKKDate(header.created_at);
    const yyyymm = `${createdAt.getUTCFullYear()}${String(createdAt.getUTCMonth() + 1).padStart(2, '0')}`;
    const dd = String(createdAt.getUTCDate()).padStart(2, '0');
    
    const relativePdfDir = `storage/pdfs/${yyyymm}/${dd}`;
    const pdfDir = path.join(__dirname, '../../', relativePdfDir);
    if (!fs.existsSync(pdfDir)) {
        fs.mkdirSync(pdfDir, { recursive: true });
    }
    const pdfPath = path.join(pdfDir, `Unicon_${taxRecId}.pdf`);
    const relativePdfPath = `/${relativePdfDir}/Unicon_${taxRecId}.pdf`;

    // 6. Generate PDF via Puppeteer
    let browser = existingBrowser;
    let createdBrowserLocally = false;

    if (!browser) {
        browser = await getBrowserInstance();
        createdBrowserLocally = true;
    }

    try {
        const page = await browser.newPage();
        try {
            await page.setContent(htmlContent, { waitUntil: 'domcontentloaded' });
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
            await page.close().catch(() => {});
        }
    } finally {
        if (createdBrowserLocally && browser) {
            const userDataDir = browser._userDataDir;
            await browser.close().catch(() => {});
            if (userDataDir && fs.existsSync(userDataDir)) {
                try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch (e) {}
            }
        }
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

/**
 * Creates and launches a shared Puppeteer browser instance optimized for server batch operations.
 */
async function getBrowserInstance() {
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

    let executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
    if (!executablePath) {
        for (const p of chromePaths) {
            if (fs.existsSync(p)) {
                executablePath = p;
                break;
            }
        }
    }
    if (!executablePath) {
        executablePath = await puppeteer.executablePath();
    }

    const userDataDir = path.join(os.tmpdir(), 'puppeteer_profile_' + Date.now() + '_' + Math.floor(Math.random() * 10000));

    const browser = await puppeteer.launch({
        headless: 'new',
        executablePath,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--disable-gpu',
            '--disable-crash-reporter',
            '--disable-breakpad',
            `--user-data-dir=${userDataDir}`
        ]
    });

    browser._userDataDir = userDataDir;
    return browser;
}

module.exports = {
    generatePdf,
    getBrowserInstance,
    formatCurrency,
    formatDateInvoice
};

