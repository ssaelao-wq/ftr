const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const os = require('os');

async function main() {
    // 1. Create a minimal HTML with the exact CSS and table structure from invoice.html
    const templatePath = path.join(__dirname, '../src/templates/invoice.html');
    const htmlContent = fs.readFileSync(templatePath, 'utf8');

    // Launch Puppeteer exactly like test-pdf.js
    const chromePaths = process.platform === 'win32'
        ? [
            'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
            'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
            path.join(os.homedir(), 'AppData\\Local\\Google\\Chrome\\Application\\chrome.exe'),
          ]
        : ['/usr/bin/google-chrome', '/usr/bin/chromium-browser'];

    let executablePath;
    for (const p of chromePaths) {
        if (fs.existsSync(p)) {
            executablePath = p;
            break;
        }
    }

    const browser = await puppeteer.launch({
        headless: 'new',
        executablePath,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();
    
    // Set viewport or styles, load the full html content
    // We will inject a modified version where we can inspect the element widths
    // Under print emulation
    await page.emulateMediaType('print');
    
    // We replace the {{itemRows}} placeholder with a test row
    const testRow = `
        <tr style="height: 22px;">
            <td class="text-center">&nbsp;</td>
            <td class="text-left test-cell" style="padding-left: 20px;" id="cntr-cell">CNTR: TEMU4009700, MSKU9876543, TEMU4009701</td>
            <td class="text-center"></td>
            <td class="text-center"></td>
            <td class="text-right"></td>
            <td class="text-right"></td>
        </tr>
    `;
    
    const renderedHtml = htmlContent
        .replace(/{{logoBase64}}/g, '')
        .replace(/{{customer}}/g, '')
        .replace(/{{customerCompanyName}}/g, '')
        .replace(/{{customerAddr}}/g, '')
        .replace(/{{taxId}}/g, '')
        .replace(/{{customerBranch}}/g, '')
        .replace(/{{invoiceNo}}/g, '')
        .replace(/{{invoiceDate}}/g, '')
        .replace(/{{pageNumber}}/g, '')
        .replace(/{{itemRows}}/g, testRow)
        .replace(/{{subtotal}}/g, '')
        .replace(/{{discount}}/g, '')
        .replace(/{{afterDiscount}}/g, '')
        .replace(/{{deposit}}/g, '')
        .replace(/{{afterDeposit}}/g, '')
        .replace(/{{vat}}/g, '')
        .replace(/{{totalAmount}}/g, '')
        .replace(/{{bahtText}}/g, '');

    await page.setContent(renderedHtml, { waitUntil: 'domcontentloaded' });
    await new Promise(resolve => setTimeout(resolve, 1500)); // Wait for fonts
    
    // Evaluate geometry
    const geometry = await page.evaluate(() => {
        const cell = document.getElementById('cntr-cell');
        const table = document.querySelector('.items-table');
        const body = document.body;
        
        return {
            bodyWidth: body.clientWidth,
            tableWidth: table.clientWidth,
            cellWidth: cell.clientWidth,
            cellScrollWidth: cell.scrollWidth,
            cellHeight: cell.clientHeight,
            fontFamily: window.getComputedStyle(cell).fontFamily,
            fontSize: window.getComputedStyle(cell).fontSize,
            paddingLeft: window.getComputedStyle(cell).paddingLeft,
            paddingRight: window.getComputedStyle(cell).paddingRight,
        };
    });

    console.log('\n--- PDF Page Geometry ---');
    console.log('Body Width:', geometry.bodyWidth, 'px');
    console.log('Table Width:', geometry.tableWidth, 'px');
    console.log('Cell (Description Column) Width:', geometry.cellWidth, 'px');
    console.log('Cell Scroll Width:', geometry.cellScrollWidth, 'px');
    console.log('Cell Height:', geometry.cellHeight, 'px');
    console.log('Font Family:', geometry.fontFamily);
    console.log('Font Size:', geometry.fontSize);
    console.log('Padding Left:', geometry.paddingLeft);
    console.log('Padding Right:', geometry.paddingRight);

    await browser.close();
}

main().catch(console.error);
