const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const os = require('os');

async function main() {
    // Read the template to get the exact CSS
    const templatePath = path.join(__dirname, '../src/templates/invoice.html');
    const htmlContent = fs.readFileSync(templatePath, 'utf8');

    // Extract the style block
    const styleStart = htmlContent.indexOf('<style>');
    const styleEnd = htmlContent.indexOf('</style>');
    const css = htmlContent.substring(styleStart, styleEnd + 8);

    // Create the test HTML
    const testCases = [
        // No spaces
        { name: '1 Cntr (No Space)', str: 'TEMU4009700' },
        { name: '2 Cntr (No Space)', str: 'TEMU4009700,MSKU9876543' },
        { name: '3 Cntr (No Space)', str: 'TEMU4009700,MSKU9876543,TEMU4009701' },
        { name: '4 Cntr (No Space)', str: 'TEMU4009700,MSKU9876543,TEMU4009701,TEMU4009702' },
        { name: '5 Cntr (No Space)', str: 'TEMU4009700,MSKU9876543,TEMU4009701,TEMU4009702,TEMU4009703' },
        
        // With spaces
        { name: '1 Cntr (With Space)', str: 'TEMU4009700' },
        { name: '2 Cntr (With Space)', str: 'TEMU4009700, MSKU9876543' },
        { name: '3 Cntr (With Space)', str: 'TEMU4009700, MSKU9876543, TEMU4009701' },
        { name: '4 Cntr (With Space)', str: 'TEMU4009700, MSKU9876543, TEMU4009701, TEMU4009702' },
        { name: '5 Cntr (With Space)', str: 'TEMU4009700, MSKU9876543, TEMU4009701, TEMU4009702, TEMU4009703' },
    ];

    let casesHtml = '';
    testCases.forEach((tc, idx) => {
        casesHtml += `
            <div class="test-container" id="test-${idx}">
                <h3>${tc.name}</h3>
                <p>Input: "${tc.str}"</p>
                <div class="page-container">
                    <table class="items-table">
                        <thead>
                            <tr>
                                <th class="col-no">No.</th>
                                <th class="col-desc">Code/Descriptions</th>
                                <th class="col-qty" colspan="2">Quantity</th>
                                <th class="col-price">unit Price</th>
                                <th class="col-amount">Amount</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr style="height: 22px;">
                                <td class="text-center">&nbsp;</td>
                                <td class="text-left test-cell" style="padding-left: 20px;">CNTR: ${tc.str}</td>
                                <td class="text-center"></td>
                                <td class="text-center"></td>
                                <td class="text-right"></td>
                                <td class="text-right"></td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>
            <hr/>
        `;
    });

    const fullHtml = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            ${css}
            <style>
                body {
                    padding: 20px;
                    background: #f0f0f0;
                }
                .test-container {
                    background: white;
                    padding: 15px;
                    margin-bottom: 20px;
                    border: 1px solid #ccc;
                    width: 800px;
                }
                /* Override page-container for screen view so it matches A4 layout */
                .page-container {
                    width: 703px !important; /* A4 printable width: 186mm * 96 / 25.4 */
                    margin: 0;
                    background: white;
                }
                .test-cell {
                    background-color: #e6f7ff;
                }
            </style>
        </head>
        <body>
            <h2>Container Width Test</h2>
            ${casesHtml}
        </body>
        </html>
    `;

    const htmlPath = path.join(__dirname, 'test_container_fit.html');
    fs.writeFileSync(htmlPath, fullHtml);

    // Launch puppeteer
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
        args: ['--no-sandbox']
    });

    const page = await browser.newPage();
    await page.goto('file://' + htmlPath, { waitUntil: 'domcontentloaded' });
    await new Promise(resolve => setTimeout(resolve, 1500)); // Wait for fonts

    // Measure each case
    const results = await page.evaluate((casesCount) => {
        const data = [];
        for (let i = 0; i < casesCount; i++) {
            const container = document.getElementById(`test-${i}`);
            const cell = container.querySelector('.test-cell');
            
            // Measure clientHeight of the cell.
            // Row height is styled at height: 22px, but in CSS table row height is a minimum height.
            // If text is 1 line: height is ~22px.
            // If text wraps to 2 lines, clientHeight will increase significantly.
            const cellHeight = cell.clientHeight;
            const scrollWidth = cell.scrollWidth;
            const clientWidth = cell.clientWidth;
            const overflow = scrollWidth > clientWidth;
            
            data.push({
                cellHeight,
                clientWidth,
                scrollWidth,
                overflow
            });
        }
        return data;
    }, testCases.length);

    console.log('\n--- Test Results ---');
    testCases.forEach((tc, idx) => {
        const res = results[idx];
        const approxLines = Math.round((res.cellHeight - 6) / 16.2) || 1;
        const lineText = res.cellHeight <= 24 ? '1 line' : `${approxLines} lines`;
        console.log(`${tc.name}:`);
        console.log(`  Text: "${tc.str}"`);
        console.log(`  Cell Height: ${res.cellHeight}px (${lineText})`);
        console.log(`  Cell Width: ${res.clientWidth}px`);
        console.log(`  Scroll Width: ${res.scrollWidth}px`);
        console.log(`  Overflows?: ${res.overflow ? 'YES' : 'NO'}`);
    });

    await browser.close();
}

main().catch(console.error);
