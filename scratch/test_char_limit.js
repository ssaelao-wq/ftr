const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const os = require('os');

async function main() {
    const templatePath = path.join(__dirname, '../src/templates/invoice.html');
    const htmlContent = fs.readFileSync(templatePath, 'utf8');

    const baseHeader = "CNTR: ";
    // We will generate test strings from length 35 to 55 by appending characters
    const testCases = [];
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    
    // We'll construct strings of format "CNTR: AAAAAA BBBBBB CCCCC" with spaces to allow normal wrapping
    for (let len = 35; len <= 55; len++) {
        // Construct a string of length `len` that has spaces every 5-6 characters
        let str = "";
        while ((baseHeader.length + str.length) < len) {
            const remaining = len - baseHeader.length - str.length;
            if (remaining > 6) {
                // Add a word of 5 letters plus a space
                str += "AAAAA ";
            } else {
                str += "A".repeat(remaining);
            }
        }
        testCases.push({
            len,
            text: baseHeader + str
        });
    }

    let pagesHtml = '';
    testCases.forEach((tc, idx) => {
        let itemsHtml = `
            <tr style="height: 22px;">
                <td class="text-center">&nbsp;</td>
                <td class="text-left" style="padding-left: 20px;">FU FACILITIES USAGE FUEL FEE</td>
                <td class="text-center">1.00</td>
                <td class="text-center">UNIT</td>
                <td class="text-right">100.00</td>
                <td class="text-right">100.00</td>
            </tr>
            <tr style="height: 22px;">
                <td class="text-center">&nbsp;</td>
                <td class="text-left test-cell" id="cell-${idx}" style="padding-left: 20px;">${tc.text}</td>
                <td class="text-center"></td>
                <td class="text-center"></td>
                <td class="text-right"></td>
                <td class="text-right"></td>
            </tr>
        `;

        let rowCount = 2;
        while (rowCount < 9) {
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

        let pageHtml = htmlContent
            .substring(htmlContent.indexOf('<!-- START_PAGE_TEMPLATE -->') + '<!-- START_PAGE_TEMPLATE -->'.length, htmlContent.indexOf('<!-- END_PAGE_TEMPLATE -->'))
            .replace(/{{logoBase64}}/g, '')
            .replace(/{{customer}}/g, 'CUS-01262')
            .replace(/{{customerCompanyName}}/g, 'OPTIMAL TECH CO.,LTD.')
            .replace(/{{customerAddr}}/g, '5 SOI UDOMSUK 34, UDOMSUK RD.')
            .replace(/{{taxId}}/g, '0105534102275')
            .replace(/{{customerBranch}}/g, '00002')
            .replace(/{{invoiceNo}}/g, `TEST-LEN-${tc.len}`)
            .replace(/{{invoiceDate}}/g, '07/05/69')
            .replace(/{{pageNumber}}/g, '1 / 1')
            .replace(/{{itemRows}}/g, itemsHtml)
            .replace(/{{subtotal}}/g, '100.00')
            .replace(/{{discount}}/g, '0.00')
            .replace(/{{afterDiscount}}/g, '100.00')
            .replace(/{{deposit}}/g, '0.00')
            .replace(/{{afterDeposit}}/g, '100.00')
            .replace(/{{vat}}/g, '7.00')
            .replace(/{{totalAmount}}/g, '107.00')
            .replace(/{{bahtText}}/g, '( หนึ่งร้อยเจ็ดบาทถ้วน )');

        pagesHtml += `
            <div class="test-wrapper">
                ${pageHtml}
            </div>
        `;
    });

    const fullHtml = htmlContent.substring(0, htmlContent.indexOf('<!-- START_PAGE_TEMPLATE -->')) + 
                     pagesHtml + 
                     htmlContent.substring(htmlContent.indexOf('<!-- END_PAGE_TEMPLATE -->') + '<!-- END_PAGE_TEMPLATE -->'.length);

    const testHtmlPath = path.join(__dirname, 'test_char_limit.html');
    fs.writeFileSync(testHtmlPath, fullHtml);

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
    await page.emulateMediaType('print');
    await page.goto('file://' + testHtmlPath, { waitUntil: 'domcontentloaded' });
    await new Promise(resolve => setTimeout(resolve, 2000));

    const results = await page.evaluate((casesCount) => {
        const data = [];
        for (let i = 0; i < casesCount; i++) {
            const cell = document.getElementById(`cell-${i}`);
            data.push({
                cellHeight: cell.clientHeight
            });
        }
        return data;
    }, testCases.length);

    console.log('\n--- Character Limit Search ---');
    testCases.forEach((tc, idx) => {
        const res = results[idx];
        const wrapped = res.cellHeight > 24;
        console.log(`Length ${tc.len} chars: Height = ${res.cellHeight}px -> ${wrapped ? 'WRAPPED' : '1 LINE'}`);
    });

    await browser.close();
}

main().catch(console.error);
