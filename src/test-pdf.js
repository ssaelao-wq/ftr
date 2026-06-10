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
    };

    const items = [
        { part_desc: 'FU FACILITIES USAGE FUEL FEE', unit_num: 1, price: 100.00, amount: 100.00, container_no: 'TEMU4009700' },
        { part_desc: 'AF ADMISSION FEE', unit_num: 1, price: 238.32, amount: 238.32, container_no: null },
        { part_desc: 'SV-IN LIFT OFF CHARGE', unit_num: 1, price: 600.00, amount: 600.00, container_no: null },
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
    // In our test, let's simulate a list of container numbers from customer:
    const testContainerStr = 'WHSU1234567, TEMU4009700, MSKU9876543, PONU1122334, KLINE9988776';
    const containerLines = wrapContainerNumbers(testContainerStr, 40);

    // Build items HTML
    let subtotal = 0;
    let itemsHtml = '';
    let rowCount = 0;
    const TOTAL_ROWS = 15; // Target total rows for items + containers + padding

    // 1. Add item rows
    items.forEach((item, index) => {
        const itemAmount = Number(item.amount) || 0;
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

    // 2. Add container number rows (if space permits)
    containerLines.forEach(line => {
        if (rowCount < TOTAL_ROWS) {
            itemsHtml += `
                <tr style="height: 22px;">
                    <td class="text-center">&nbsp;</td>
                    <td class="text-left" style="padding-left: 20px;">${line}</td>
                    <td class="text-center"></td>
                    <td class="text-center"></td>
                    <td class="text-right"></td>
                    <td class="text-right"></td>
                </tr>
            `;
            rowCount++;
        }
    });

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

    // Replace placeholders
    htmlContent = htmlContent
        .replace(/{{logoBase64}}/g, logoBase64)
        .replace(/{{customer}}/g, header.customer || '') // In real DB, customer_num
        .replace(/{{customerCompanyName}}/g, 'OPTIMAL TECH CO.,LTD.') // In real DB, customer_name
        .replace(/{{customerAddr}}/g, (header.customer_addr || '').replace(/\n/g, '<br>'))
        .replace(/{{taxId}}/g, header.tax_id || '')
        .replace(/{{customerBranch}}/g, '00002') // Mock branch ID
        .replace(/{{invoiceNo}}/g, header.tax_rec_id || '')
        .replace(/{{invoiceDate}}/g, formattedDate)
        .replace(/{{itemRows}}/g, itemsHtml)
        .replace(/{{subtotal}}/g, formatCurrency(subtotal))
        .replace(/{{discount}}/g, formatCurrency(0))
        .replace(/{{afterDiscount}}/g, formatCurrency(subtotal))
        .replace(/{{deposit}}/g, formatCurrency(0))
        .replace(/{{afterDeposit}}/g, formatCurrency(subtotal))
        .replace(/{{vat}}/g, formatCurrency(vat))
        .replace(/{{totalAmount}}/g, formatCurrency(totalAmount))
        .replace(/{{bahtText}}/g, `( ${bahtTextStr} )`);

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

    let executablePath;
    for (const p of chromePaths) {
        if (fs.existsSync(p)) {
            executablePath = p;
            break;
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
        await page.setContent(htmlContent, { waitUntil: 'load' });
        
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
