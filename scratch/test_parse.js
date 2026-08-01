const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');

const filePath = path.join(__dirname, '../customer_data-11Jul-02.csv');
const csvContent = fs.readFileSync(filePath, 'utf8');

// Pre-process raw text lines to skip non-column header rows
const lines = csvContent.split('\n');
let headerLineIndex = -1;
for (let i = 0; i < Math.min(20, lines.length); i++) {
    if (lines[i].includes('รหัสลูกค้า') && lines[i].includes('เลขประจำตัวผู้เสียภาษี')) {
        headerLineIndex = i;
        break;
    }
}
console.log('Preprocess - Found header at line index:', headerLineIndex);

let cleanCsvContent = csvContent;
if (headerLineIndex > 0) {
    cleanCsvContent = lines.slice(headerLineIndex).join('\n');
}

const delimiter = '|';
const rawRecords = parse(cleanCsvContent, {
    delimiter: delimiter,
    skip_empty_lines: true,
    trim: true
});

console.log('Total rawRecords parsed after cleaning:', rawRecords.length);

let headerRowIndex = -1;
for (let i = 0; i < Math.min(20, rawRecords.length); i++) {
    const rowStr = JSON.stringify(rawRecords[i]);
    if (rowStr.includes('รหัสลูกค้า') && rowStr.includes('เลขประจำตัวผู้เสียภาษี')) {
        headerRowIndex = i;
        break;
    }
}
console.log('Detected headerRowIndex inside parsed records:', headerRowIndex);

if (headerRowIndex !== -1) {
    const headers = rawRecords[headerRowIndex].map(h => h.trim());
    console.log('Parsed headers array:', headers);

    const requiredMappings = {
        'เลขประจำตัวผู้เสียภาษี': 'tax_id',
        'รหัสลูกค้า': 'customer_num',
        'ชื่อลูกค้า': 'customer_name',
        'ที่อยู่': 'customer_addr',
        'email': 'customer_email',
        'โทรศัพท์': 'customer_phone',
        'ประเภทสาขา': 'branch_type',
        'สาขา': 'branch_code'
    };

    const indexes = {};
    const missing = [];

    for (const [colName, key] of Object.entries(requiredMappings)) {
        let idx = -1;
        if (colName === 'email') {
            idx = headers.findIndex(h => h.toLowerCase().replace('-', '') === 'email');
        } else {
            idx = headers.indexOf(colName);
        }

        if (idx === -1) {
            missing.push(colName);
        } else {
            indexes[key] = idx;
        }
    }

    console.log('Missing columns:', missing);
    console.log('Mapped indexes:', indexes);
}
