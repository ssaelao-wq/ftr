const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '../customer_data-11Jul-02.csv');
const buffer = fs.readFileSync(filePath);

console.log('File size:', buffer.length, 'bytes');

let isUtf8Fatal = true;
try {
    new TextDecoder('utf-8', { fatal: true }).decode(buffer);
} catch (e) {
    isUtf8Fatal = false;
    console.log('UTF-8 fatal check FAILED:', e.message);
}

if (isUtf8Fatal) {
    console.log('UTF-8 fatal check PASSED');
}

// Check with non-fatal UTF-8 (which replaces invalid chars with replacement character)
const utf8NonFatalStr = new TextDecoder('utf-8').decode(buffer);
const win874Str = new TextDecoder('windows-874').decode(buffer);

console.log('\n--- Searching headers in UTF-8 (Non-fatal) ---');
let foundUtf8 = false;
const linesUtf8 = utf8NonFatalStr.split('\n');
for (let i = 0; i < Math.min(20, linesUtf8.length); i++) {
    if (linesUtf8[i].includes('รหัสลูกค้า') && linesUtf8[i].includes('เลขประจำตัวผู้เสียภาษี')) {
        console.log(`Found on line ${i + 1}:`, linesUtf8[i].substring(0, 100));
        foundUtf8 = true;
    }
}

console.log('\n--- Searching headers in Windows-874 ---');
let foundWin = false;
const linesWin = win874Str.split('\n');
for (let i = 0; i < Math.min(20, linesWin.length); i++) {
    if (linesWin[i].includes('รหัสลูกค้า') && linesWin[i].includes('เลขประจำตัวผู้เสียภาษี')) {
        console.log(`Found on line ${i + 1}:`, linesWin[i].substring(0, 100));
        foundWin = true;
    }
}
