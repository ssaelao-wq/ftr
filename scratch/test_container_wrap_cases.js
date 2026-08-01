const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const os = require('os');

async function main() {
    const templatePath = path.join(__dirname, '../src/templates/invoice.html');
    const htmlContent = fs.readFileSync(templatePath, 'utf8');

    // Sample data matching the real template items
    const items = [
        { index: 1, part_desc: 'FU FACILITIES USAGE FUEL FEE', unit_num: 1, price: 100.00, amount: 100.00 },
        { index: 2, part_desc: 'AF ADMISSION FEE', unit_num: 1, price: 238.32, amount: 238.32 },
        { index: 3, part_desc: 'SV-IN LIFT OFF CHARGE', unit_num: 1, price: 600.00, amount: 600.00 },
        { index: 4, part_desc: 'SV-OUT LIFT ON CHARGE', unit_num: 1, price: 600.00, amount: 600.00 },
    ];

    // We will generate different container strings
    const testCases = [];
    const baseContainers = [
        'TEMU4009700',
        'MSKU9876543',
        'TEMU4009701',
        'TEMU4009702',
        'TEMU4009703',
        'TEMU4009704',
        'TEMU4009705'
    ];

    // Case 1: Comma with Space (", ")
    for (let count = 1; count <= 6; count++) {
        const list = baseContainers.slice(0, count);
        testCases.push({
            name: `${count} Cntr (With Space)`,
            str: list.join(', '),
            count
        });
    }

    // Case 2: Comma no Space (",")
    for (let count = 1; count <= 6; count++) {
        const list = baseContainers.slice(0, count);
        testCases.push({
            name: `${count} Cntr (No Space)`,
            str: list.join(','),
            count
        });
    }

    let pagesHtml = '';
    testCases.forEach((tc, idx) => {
        // Render item rows + CNTR row
        let itemsHtml = '';
        items.forEach((item) => {
            itemsHtml += `
                <tr style="height: 22px;">
                    <td class="text-center">${item.index}</td>
                    <td class="text-left">${item.part_desc}</td>
                    <td class="text-center">${item.unit_num.toFixed(2)}</td>
                    <td class="text-center">UNIT</td>
                    <td class="text-right">${item.price.toFixed(2)}</td>
                    <td class="text-right">${item.amount.toFixed(2)}</td>
                </tr>
            `;
        });

        // CNTR row
        itemsHtml += `
            <tr style="height: 22px;">
                <td class="text-center">&nbsp;</td>
                <td class="text-left test-cell" id="cell-${idx}" style="padding-left: 20px;">CNTR: ${tc.str}</td>
                <td class="text-center"></td>
                <td class="text-center"></td>
                <td class="text-right"></td>
                <td class="text-right"></td>
            </tr>
        `;

        // We pad with empty rows to match MAX_ROWS_PER_PAGE (9 rows total including CNTR and items)
        let rowCount = items.length + 1;
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

        // Create page
        let pageHtml = htmlContent
            .substring(htmlContent.indexOf('<!-- START_PAGE_TEMPLATE -->') + '<!-- START_PAGE_TEMPLATE -->'.length, htmlContent.indexOf('<!-- END_PAGE_TEMPLATE -->'))
            .replace(/{{logoBase64}}/g, '')
            .replace(/{{customer}}/g, 'CUS-01262')
            .replace(/{{customerCompanyName}}/g, 'OPTIMAL TECH CO.,LTD.')
            .replace(/{{customerAddr}}/g, '5 SOI UDOMSUK 34, UDOMSUK RD.,BANGNA NUEA, BANGNA BANGKOK')
            .replace(/{{taxId}}/g, '0105534102275')
            .replace(/{{customerBranch}}/g, '00002')
            .replace(/{{invoiceNo}}/g, `TEST-CASE-${idx}`)
            .replace(/{{invoiceDate}}/g, '07/05/69')
            .replace(/{{pageNumber}}/g, '1 / 1')
            .replace(/{{itemRows}}/g, itemsHtml)
            .replace(/{{subtotal}}/g, '1538.32')
            .replace(/{{discount}}/g, '0.00')
            .replace(/{{afterDiscount}}/g, '1538.32')
            .replace(/{{deposit}}/g, '0.00')
            .replace(/{{afterDeposit}}/g, '1538.32')
            .replace(/{{vat}}/g, '107.68')
            .replace(/{{totalAmount}}/g, '1646.00')
            .replace(/{{bahtText}}/g, '( หนึ่งพันหกร้อยสี่สิบหกบาทถ้วน )');

        pagesHtml += `
            <div class="test-wrapper">
                <h2 style="page-break-before: always; margin-top: 30px;">Test Case ${idx}: ${tc.name}</h2>
                <p>String length: ${('CNTR: ' + tc.str).length} chars. Text: "CNTR: ${tc.str}"</p>
                ${pageHtml}
            </div>
        `;
    });

    const fullHtml = htmlContent.substring(0, htmlContent.indexOf('<!-- START_PAGE_TEMPLATE -->')) + 
                     pagesHtml + 
                     htmlContent.substring(htmlContent.indexOf('<!-- END_PAGE_TEMPLATE -->') + '<!-- END_PAGE_TEMPLATE -->'.length);

    const testHtmlPath = path.join(__dirname, 'test_container_wrap_cases.html');
    fs.writeFileSync(testHtmlPath, fullHtml);

    // Launch Puppeteer
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
    
    // Set to print media and set viewport to emulate PDF sizing
    await page.emulateMediaType('print');
    await page.goto('file://' + testHtmlPath, { waitUntil: 'domcontentloaded' });
    await new Promise(resolve => setTimeout(resolve, 2000)); // Wait for web fonts

    // Measure cell geometry
    const results = await page.evaluate((casesCount) => {
        const data = [];
        for (let i = 0; i < casesCount; i++) {
            const cell = document.getElementById(`cell-${i}`);
            const row = cell.parentElement;
            const table = row.closest('.items-table');
            
            // In auto table layout, column widths might adjust.
            // Let's measure:
            // 1. The rendered width of the cell
            // 2. The height of the cell
            // 3. The scrollWidth of the cell
            data.push({
                cellWidth: cell.clientWidth,
                cellHeight: cell.clientHeight,
                cellScrollWidth: cell.scrollWidth,
                tableWidth: table.clientWidth
            });
        }
        return data;
    }, testCases.length);

    console.log('\n--- Realistic Layout Wrap Results ---');
    testCases.forEach((tc, idx) => {
        const res = results[idx];
        const textWithLabel = 'CNTR: ' + tc.str;
        
        // A cell height of 22px is single line (based on tr style height 22px + padding).
        // If height > 24px, it wrapped (normally to 38px for 2 lines).
        const lines = res.cellHeight <= 24 ? 1 : Math.round((res.cellHeight - 6) / 16.2);
        
        console.log(`${tc.name}:`);
        console.log(`  Total string length: ${textWithLabel.length} characters`);
        console.log(`  Cell Width: ${res.cellWidth}px (Table total: ${res.tableWidth}px, columns ratio: ${(res.cellWidth / res.tableWidth * 100).toFixed(1)}%)`);
        console.log(`  Cell Height: ${res.cellHeight}px (${lines} line(s))`);
        console.log(`  Did it overflow horizontally?: ${res.cellScrollWidth > res.cellWidth ? 'YES' : 'NO'}`);
        console.log(`  Did it wrap?: ${lines > 1 ? 'YES' : 'NO'}`);
    });

    // Also let's print this HTML to PDF to verify it prints exactly like this.
    const pdfPath = path.join(__dirname, '../storage/pdfs/TEST_CONTAINER_CASES.pdf');
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
    console.log('\n✅ TEST_CONTAINER_CASES.pdf has been generated for visual inspection.');

    await browser.close();
}

main().catch(console.error);
