const { parse } = require('csv-parse/sync');

// Mock data simulation of CSV rows
const mockGateInCsv = `Liner Name|Customer Name|No.|Container No.|Size|Type|Receipt No.|Receipt Date|Gate In Date|Doc Type
ZIM|NONGNUCH|1|AXIU2198545|20'|GP|RF2606-01882|16/06/2026 12:09|16/06/2026 12:08|Gate-In`;

const mockGateOutCsv = `Liner Name|Customer Name|BKG#|Req Amount|No.|Container No.|Size|Type|Receipt No.|Receipt Date|Gate In Date|Doc Type
WAN HAI|SIAM|035GA15204|10|1|TEMU0581493|20'|GP|RF2606-01827|16/06/2026 09:28|16/06/2026 09:50|Gate-Out`;

function testParseGateIn(csvContent) {
    const rawRecords = parse(csvContent, {
        delimiter: '|',
        skip_empty_lines: true,
        trim: true
    });
    const headers = rawRecords[0].map(h => h.trim());
    const receiptNoIdx = headers.indexOf('Receipt No.');
    const containerNoIdx = headers.indexOf('Container No.');
    console.log('Gate-In Header Matches:');
    console.log(`Receipt No Index: ${receiptNoIdx} (Expected: 6)`);
    console.log(`Container No Index: ${containerNoIdx} (Expected: 3)`);
    
    const row = rawRecords[1];
    console.log(`Receipt No Value: "${row[receiptNoIdx]}" (Expected: "RF2606-01882")`);
    console.log(`Container No Value: "${row[containerNoIdx]}" (Expected: "AXIU2198545")`);
}

function testParseGateOut(csvContent) {
    const rawRecords = parse(csvContent, {
        delimiter: '|',
        skip_empty_lines: true,
        trim: true
    });
    const headers = rawRecords[0].map(h => h.trim());
    const receiptNoIdx = headers.indexOf('Receipt No.');
    const bookingNoIdx = headers.indexOf('BKG#');
    const containerNoIdx = headers.indexOf('Container No.');
    console.log('\nGate-Out Header Matches:');
    console.log(`Receipt No Index: ${receiptNoIdx} (Expected: 8)`);
    console.log(`Booking No Index: ${bookingNoIdx} (Expected: 2)`);
    console.log(`Container No Index: ${containerNoIdx} (Expected: 5)`);
    
    const row = rawRecords[1];
    console.log(`Receipt No Value: "${row[receiptNoIdx]}" (Expected: "RF2606-01827")`);
    console.log(`Booking No Value: "${row[bookingNoIdx]}" (Expected: "035GA15204")`);
    console.log(`Container No Value: "${row[containerNoIdx]}" (Expected: "TEMU0581493")`);
}

testParseGateIn(mockGateInCsv);
testParseGateOut(mockGateOutCsv);
