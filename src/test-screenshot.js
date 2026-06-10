/**
 * Screenshot script: Render the invoice HTML template to a PNG screenshot
 * for visual comparison with the reference image.
 * 
 * Usage: node src/test-screenshot.js
 * Output: storage/pdfs/TEST_SCREENSHOT.png
 */
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const os = require('os');

async function main() {
    console.log('Rendering template to screenshot...');

    // Load template
    let html = fs.readFileSync(path.join(__dirname, 'templates/invoice.html'), 'utf8');

    // Replace placeholders with sample data matching full_tax_invoice.jpg
    const itemsHtml = `
        <tr>
            <td class="text-center">1</td>
            <td class="text-left">FU FACILITIES USAGE FUEL FEE</td>
            <td class="text-center">1.00</td>
            <td class="text-center">UNIT</td>
            <td class="text-right">100.00</td>
            <td class="text-right">100.00</td>
        </tr>
        <tr>
            <td class="text-center">2</td>
            <td class="text-left">AF ADMISSION FEE</td>
            <td class="text-center">1.00</td>
            <td class="text-center">UNIT</td>
            <td class="text-right">238.32</td>
            <td class="text-right">238.32</td>
        </tr>
        <tr>
            <td class="text-center">3</td>
            <td class="text-left">SV-IN LIFT OFF CHARGE</td>
            <td class="text-center">1.00</td>
            <td class="text-center">UNIT</td>
            <td class="text-right">600.00</td>
            <td class="text-right">600.00</td>
        </tr>
        <tr>
            <td class="text-center">&nbsp;</td>
            <td class="text-left" style="padding-left:20px">TEMU4009700</td>
            <td></td>
            <td></td>
            <td></td>
            <td></td>
        </tr>
    `;

    // Load logo base64
    const logoPath = path.join(__dirname, '../unicon_logo.jpg');
    let logoBase64 = '';
    if (fs.existsSync(logoPath)) {
        logoBase64 = 'data:image/jpeg;base64,' + fs.readFileSync(logoPath, 'base64');
    }

    html = html
        .replace(/{{logoBase64}}/g, logoBase64)
        .replace(/{{customer}}/g, 'CUS-01262')
        .replace(/{{customerCompanyName}}/g, 'OPTIMAL TECH CO.,LTD.')
        .replace(/{{customerAddr}}/g, '5 SOI UDOMSUK 34, UDOMSUK RD.,BANGNA NUEA, BANGNA BANGKOK,\n10260THAILAND')
        .replace(/{{taxId}}/g, '0105534102275')
        .replace(/{{invoiceNo}}/g, 'RF2605-00589')
        .replace(/{{invoiceDate}}/g, '07/05/69')
        .replace(/{{itemRows}}/g, itemsHtml)
        .replace(/{{subtotal}}/g, '938.32')
        .replace(/{{discount}}/g, '0.00')
        .replace(/{{afterDiscount}}/g, '938.32')
        .replace(/{{deposit}}/g, '0.00')
        .replace(/{{afterDeposit}}/g, '938.32')
        .replace(/{{vat}}/g, '65.68')
        .replace(/{{totalAmount}}/g, '1,004.00')
        .replace(/{{bahtText}}/g, '( หนึ่งพันสี่บาทถ้วน )');

    // Find Chrome
    const chromePaths = process.platform === 'win32'
        ? [
            'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
            'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
            path.join(os.homedir(), 'AppData\\Local\\Google\\Chrome\\Application\\chrome.exe'),
          ]
        : ['/usr/bin/google-chrome', '/usr/bin/chromium-browser', '/usr/bin/chromium'];

    let executablePath;
    for (const p of chromePaths) {
        if (fs.existsSync(p)) { executablePath = p; break; }
    }
    if (!executablePath) executablePath = await puppeteer.executablePath();

    const browser = await puppeteer.launch({
        headless: 'new',
        executablePath,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    try {
        const page = await browser.newPage();
        await page.setViewport({ width: 794, height: 1123 });
        await page.setContent(html, { waitUntil: 'load', timeout: 15000 });
        await new Promise(r => setTimeout(r, 2000)); // Wait for fonts

        const outputPath = path.join(__dirname, '../storage/pdfs/TEST_SCREENSHOT.png');
        await page.screenshot({ path: outputPath, fullPage: true });
        console.log('Screenshot saved:', outputPath);
    } finally {
        await browser.close();
    }
}

main().catch(err => {
    console.error('Error:', err);
    process.exit(1);
});
