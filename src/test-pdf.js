/**
 * Test script: Generate a sample PDF from the invoice template
 * using hardcoded sample data (no DB required).
 * 
 * Usage: node src/test-pdf.js
 * Output: storage/pdfs/TEST_SAMPLE.pdf
 */
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const thaiBahtText = require('./utils/thaiBaht');

function formatCurrency(value) {
    return Number(value).toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
}

function formatQty(value) {
    return Number(value).toFixed(2);
}

async function main() {
    console.log('Generating test PDF...');

    // Sample data matching reference image (full_tax_invoice.jpg)
    const header = {
        tax_rec_id: 'RF2605-00589',
        customer: 'CUS-01262',
        customer_addr: '5 SOI UDOMSUK 34, UDOMSUK RD.,BANGNA NUEA, BANGNA BANGKOK,\n10260THAILAND',
        tax_id: '0105534102275',
        service_date: '2026-05-07',  // Will format to 07/05/69
        booking_num: 'BKG1234567',
        container_num: 'MSKU9876543',
    };

    const items = [
        { part_desc: 'FU FACILITIES USAGE FUEL FEE', unit_num: 1, price: 100.00, amount: 100.00, container_no: 'TEMU4009700' },
        { part_desc: 'AF ADMISSION FEE', unit_num: 1, price: 238.32, amount: 238.32, container_no: null },
        { part_desc: 'SV-IN LIFT OFF CHARGE', unit_num: 1, price: 600.00, amount: 600.00, container_no: null },
        { part_desc: 'MOCK ITEM 4', unit_num: 1, price: 100.00, amount: 100.00 },
        { part_desc: 'MOCK ITEM 5', unit_num: 1, price: 200.00, amount: 200.00 },
        { part_desc: 'MOCK ITEM 6', unit_num: 1, price: 300.00, amount: 300.00 },
        { part_desc: 'MOCK ITEM 7', unit_num: 1, price: 400.00, amount: 400.00 },
        { part_desc: 'MOCK ITEM 8', unit_num: 1, price: 500.00, amount: 500.00 }
    ];

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

    // Combine any container numbers from items if present, or simulate a list
    let subtotal = 0;
    const itemObjects = items.map((item, index) => {
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
    const containerNum = (header.container_num || '').trim();
    const hasBkg = bookingNum.length > 0;
    const hasCntr = containerNum.length > 0;
    const hasBkgCntr = hasBkg || hasCntr;

    // Chunking logic to split items into pages
    const MAX_ROWS_PER_PAGE = 9;
    const pages = [];
    const tempItems = [...itemObjects];

    if (hasBkgCntr) {
        if (tempItems.length <= 7) {
            pages.push({
                items: tempItems,
                hasBkgCntr: true
            });
        } else {
            while (tempItems.length > 7) {
                pages.push({
                    items: tempItems.splice(0, 9),
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
                    items: tempItems.splice(0, 9),
                    hasBkgCntr: false
                });
            }
        }
    }

    const totalPages = pages.length;

    const vat = subtotal * 0.07;
    const totalAmount = subtotal + vat;
    const bahtTextStr = thaiBahtText(totalAmount);

    // Format date (BE year)
    const date = new Date(header.service_date);
    const dd = String(date.getDate()).padStart(2, '0');
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const beYear = date.getFullYear() + 543;
    const yy = String(beYear).slice(-2);
    const formattedDate = `${dd}/${mm}/${yy}`;

    // Load template
    const templatePath = path.join(__dirname, 'templates/invoice.html');
    let htmlContent = fs.readFileSync(templatePath, 'utf8');

    // Load logo base64
    const logoPath = path.join(__dirname, '../unicon_logo_withline.jpg');
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
            itemsHtml += `
                <tr style="height: 22px;">
                    <td class="text-center">&nbsp;</td>
                    <td class="text-left" style="padding-left: 20px;">BKG: ${bookingNum}</td>
                    <td class="text-center"></td>
                    <td class="text-center"></td>
                    <td class="text-right"></td>
                    <td class="text-right"></td>
                </tr>
                <tr style="height: 22px;">
                    <td class="text-center">&nbsp;</td>
                    <td class="text-left" style="padding-left: 20px;">CNTR: ${containerNum}</td>
                    <td class="text-center"></td>
                    <td class="text-center"></td>
                    <td class="text-right"></td>
                    <td class="text-right"></td>
                </tr>
            `;
            rowCount += 2;
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
            .replace(/{{customer}}/g, header.customer || '')
            .replace(/{{customerCompanyName}}/g, 'OPTIMAL TECH CO.,LTD.')
            .replace(/{{customerAddr}}/g, (header.customer_addr || '').replace(/\n/g, '<br>'))
            .replace(/{{taxId}}/g, header.tax_id || '')
            .replace(/{{customerBranch}}/g, '00002')
            .replace(/{{invoiceNo}}/g, header.tax_rec_id || '')
            .replace(/{{invoiceDate}}/g, formattedDate)
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

    // Output paths
    const pdfDir = path.join(__dirname, '../storage/pdfs');
    if (!fs.existsSync(pdfDir)) {
        fs.mkdirSync(pdfDir, { recursive: true });
    }
    const pdfPath = path.join(pdfDir, 'TEST_SAMPLE.pdf');

    // Find Chrome
    const os = require('os');
    const chromePaths = process.platform === 'win32'
        ? [
            'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
            'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
            path.join(os.homedir(), 'AppData\\Local\\Google\\Chrome\\Application\\chrome.exe'),
          ]
        : ['/usr/bin/google-chrome', '/usr/bin/chromium-browser', '/usr/bin/chromium'];

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
    console.log('Using Chrome at:', executablePath);

    // Generate PDF
    const browser = await puppeteer.launch({
        headless: 'new',
        executablePath,
        userDataDir: path.join(__dirname, '../storage/puppeteer_tmp_' + Math.random().toString(36).substring(7)),
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    try {
        const page = await browser.newPage();
        await page.setContent(htmlContent, { waitUntil: 'domcontentloaded' });
        
        // Wait a bit for fonts to load
        await new Promise(resolve => setTimeout(resolve, 1500));
        
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
        console.log('✅ PDF generated successfully:', pdfPath);
    } finally {
        await browser.close();
    }
}

main().catch(err => {
    console.error('❌ Error generating test PDF:', err);
    process.exit(1);
});
