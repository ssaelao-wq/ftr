// Scratch script to test the partitioning and messaging logic of LIFF validations.

const today = new Date('2026-06-29');
today.setHours(0,0,0,0);

// Helper to simulate handleLookupResult logic
function testLookupResult(invoices) {
    const taxIdVal = ''; // Assume taxIdVal is empty during initial input
    const hasSomeNoTaxId = invoices.some(inv => !inv.existing_tax_id);

    if (invoices.length === 1) {
        const inv = invoices[0];
        const sDate = new Date(inv.service_date);
        sDate.setHours(0,0,0,0);
        const diffDays = Math.floor((today - sDate) / (1000 * 60 * 60 * 24));
        if (diffDays > 7) {
            return {
                action: 'ABORT',
                message: `${inv.tax_rec_id} ใบกำกับภาษีนี้ขอเกินกำหนด 7 วัน กรุณาติดต่อแอดมิน`
            };
        }
        if (!inv.existing_tax_id) {
            return {
                action: 'MANUAL_ENTRY_OR_BRANCH_SELECT',
                message: 'No message (toast only)'
            };
        } else {
            return {
                action: 'SEND_ONLY',
                message: 'No message (populates UI)'
            };
        }
    }

    const baseDate = invoices[0].service_date;

    if (hasSomeNoTaxId) {
        const unlinkedInvoices = invoices.filter(inv => !inv.existing_tax_id);
        const unlinkedDates = new Set(unlinkedInvoices.map(inv => inv.service_date));
        const hasMismatchedDates = unlinkedDates.size > 1;

        const tax_rec_id_7days = [];
        const tax_rec_id_diffdate = [];
        const tax_rec_id_proceed = [];
        const tax_rec_id_hastaxid = [];

        invoices.forEach(inv => {
            const sDate = new Date(inv.service_date);
            sDate.setHours(0,0,0,0);
            const diffDays = Math.floor((today - sDate) / (1000 * 60 * 60 * 24));
            if (diffDays > 7) {
                tax_rec_id_7days.push(inv);
            } else if (!inv.existing_tax_id) {
                if (hasMismatchedDates) {
                    tax_rec_id_diffdate.push(inv);
                } else {
                    tax_rec_id_proceed.push(inv);
                }
            } else {
                tax_rec_id_hastaxid.push(inv);
            }
        });

        const proceedList = tax_rec_id_proceed.map(inv => inv.tax_rec_id).join(', ');
        const over7DaysList = tax_rec_id_7days.map(inv => inv.tax_rec_id).join(', ');
        const diffDateList = tax_rec_id_diffdate.map(inv => inv.tax_rec_id).join(', ');

        const msgLines = [];
        if (tax_rec_id_7days.length > 0) {
            msgLines.push(`${over7DaysList} ใบกำกับภาษีนี้ขอเกินกำหนด 7 วัน กรุณาติดต่อแอดมิน`);
        }
        if (tax_rec_id_diffdate.length > 0) {
            msgLines.push(`${diffDateList} ใบกำกับภาษีนี้มีวันที่ให้บริการต่างกัน โปรดใส่เฉพาะหมายเลขที่มีวันที่ให้บริการเดียวกันเท่านั้น`);
        }
        if (tax_rec_id_proceed.length > 0) {
            msgLines.push(`${proceedList} สามารถเพิ่มข้อมูลได้`);
        }
        if (tax_rec_id_hastaxid.length > 0) {
            msgLines.push(`ใบกำกับภาษีที่เหลือมีข้อมูลแล้ว`);
        }
        const msg = msgLines.join('\n');

        const shouldAbort = tax_rec_id_proceed.length === 0 || tax_rec_id_diffdate.length > 0;

        return {
            action: shouldAbort ? 'ABORT' : 'PROCEED',
            message: msg,
            proceedList: proceedList
        };
    } else {
        // All have tax_id
        const over7Days = [];
        const diffDate = [];
        const customerNums = new Set();

        invoices.forEach(inv => {
            const sDate = new Date(inv.service_date);
            sDate.setHours(0,0,0,0);
            const diffDays = Math.floor((today - sDate) / (1000 * 60 * 60 * 24));
            if (diffDays > 7) {
                over7Days.push(inv.tax_rec_id);
            } else if (inv.service_date !== baseDate) {
                diffDate.push(inv.tax_rec_id);
            }
            if (inv.customer_num) {
                customerNums.add(inv.customer_num);
            }
        });

        let msg = '';
        if (over7Days.length > 0) {
            msg += `${over7Days.join(', ')} ใบกำกับภาษีนี้ขอเกินกำหนด 7 วัน กรุณาติดต่อแอดมิน\n`;
        }
        if (diffDate.length > 0) {
            msg += `${diffDate.join(', ')} ใบกำกับภาษีนี้มีวันที่ให้บริการต่างกัน โปรดใส่เฉพาะหมายเลขที่มีวันที่ให้บริการเดียวกันเท่านั้น\n`;
        }
        if (customerNums.size > 1) {
            msg += `ใบกำกับภาษีบางหมายเลขเป็นคนละลูกค้า โปรดใส่เฉพาะหมายเลขที่มาจากลูกค้าเดียวกันเท่านั้น\n`;
        }

        return {
            action: msg ? 'ABORT' : 'PROCEED_SEND_ONLY',
            message: msg.trim()
        };
    }
}

// Service Date Mocks
const dateX = '2026-06-25'; // Valid (4 days diff)
const dateY = '2026-06-20'; // Expired or diff (9 days diff)
const dateZ = '2026-06-26'; // Valid mismatch

const scenarios = [
    // 1. ใส่ RF เดียว
    {
        name: '1.1 ที่มีข้อมูลลูกค้า + เกิน 7 วัน',
        invoices: [{ tax_rec_id: 'RF2606-0001', existing_tax_id: '1234567890123', service_date: dateY }]
    },
    {
        name: '1.2 ที่มีข้อมูลลูกค้า + ไม่เกิน 7 วัน',
        invoices: [{ tax_rec_id: 'RF2606-0002', existing_tax_id: '1234567890123', service_date: dateX }]
    },
    {
        name: '1.3 ที่ไม่มีข้อมูลลูกค้า + เกิน 7 วัน',
        invoices: [{ tax_rec_id: 'RF2606-0003', existing_tax_id: null, service_date: dateY }]
    },
    {
        name: '1.4 ที่ไม่มีข้อมูลลูกค้า + ไม่เกิน 7 วัน',
        invoices: [{ tax_rec_id: 'RF2606-0004', existing_tax_id: null, service_date: dateX }]
    },

    // 2. ใส่หลาย RF ทั้งหมดมีข้อมูล
    {
        name: '2.1 มีข้อมูล A + ไม่เกิน 7 วัน + วัน X + มีข้อมูล A + ไม่เกิน 7 วัน + วัน X',
        invoices: [
            { tax_rec_id: 'RF01', existing_tax_id: 'TAX-A', customer_num: 'C01', service_date: dateX },
            { tax_rec_id: 'RF02', existing_tax_id: 'TAX-A', customer_num: 'C01', service_date: dateX }
        ]
    },
    {
        name: '2.2 มีข้อมูล A + ไม่เกิน 7 วัน + วัน X + มีข้อมูล A + ไม่เกิน 7 วัน + วัน Z (Diff date)',
        invoices: [
            { tax_rec_id: 'RF01', existing_tax_id: 'TAX-A', customer_num: 'C01', service_date: dateX },
            { tax_rec_id: 'RF02', existing_tax_id: 'TAX-A', customer_num: 'C01', service_date: dateZ }
        ]
    },
    {
        name: '2.3 มีข้อมูล A + ไม่เกิน 7 วัน + วัน X + มีข้อมูล B + ไม่เกิน 7 วัน + วัน X (Diff customer)',
        invoices: [
            { tax_rec_id: 'RF01', existing_tax_id: 'TAX-A', customer_num: 'C01', service_date: dateX },
            { tax_rec_id: 'RF02', existing_tax_id: 'TAX-B', customer_num: 'C02', service_date: dateX }
        ]
    },
    {
        name: '2.4 มีข้อมูล A + วัน X + มีข้อมูล B + วัน Z (Diff customer & date)',
        invoices: [
            { tax_rec_id: 'RF01', existing_tax_id: 'TAX-A', customer_num: 'C01', service_date: dateX },
            { tax_rec_id: 'RF02', existing_tax_id: 'TAX-B', customer_num: 'C02', service_date: dateZ }
        ]
    },
    {
        name: '2.5 มีข้อมูล A + วัน X + มีข้อมูล A + เกิน 7 วัน',
        invoices: [
            { tax_rec_id: 'RF01', existing_tax_id: 'TAX-A', customer_num: 'C01', service_date: dateX },
            { tax_rec_id: 'RF02', existing_tax_id: 'TAX-A', customer_num: 'C01', service_date: dateY }
        ]
    },
    {
        name: '2.7 มีข้อมูล A + วัน X + มีข้อมูล B + เกิน 7 วัน',
        invoices: [
            { tax_rec_id: 'RF01', existing_tax_id: 'TAX-A', customer_num: 'C01', service_date: dateX },
            { tax_rec_id: 'RF02', existing_tax_id: 'TAX-B', customer_num: 'C02', service_date: dateY }
        ]
    },

    // 3. ใส่หลาย RF บางอันไม่มีข้อมูล
    {
        name: '3.1 ไม่มีข้อมูล+ไม่เกิน7วัน+วันX + มีข้อมูลA+ไม่เกิน7วัน+วันX + มีข้อมูลA+ไม่เกิน7วัน+วันX',
        invoices: [
            { tax_rec_id: 'RF01', existing_tax_id: null, service_date: dateX },
            { tax_rec_id: 'RF02', existing_tax_id: 'TAX-A', customer_num: 'C01', service_date: dateX },
            { tax_rec_id: 'RF03', existing_tax_id: 'TAX-A', customer_num: 'C01', service_date: dateX }
        ]
    },
    {
        name: '3.2 ไม่มีข้อมูล+เกิน7วัน + มีข้อมูลA+ไม่เกิน7วัน + มีข้อมูลA+ไม่เกิน7วัน',
        invoices: [
            { tax_rec_id: 'RF01', existing_tax_id: null, service_date: dateY },
            { tax_rec_id: 'RF02', existing_tax_id: 'TAX-A', customer_num: 'C01', service_date: dateX },
            { tax_rec_id: 'RF03', existing_tax_id: 'TAX-A', customer_num: 'C01', service_date: dateX }
        ]
    },
    {
        name: '3.7 ไม่มีข้อมูล+ไม่เกิน7วัน+วันX (01941) + ไม่มีข้อมูล+ไม่เกิน7วัน+วันX (01945) + มีข้อมูลA+ไม่เกิน7วัน+วันX (01944) + มีข้อมูลA+ไม่เกิน7วัน+วันX (01943)',
        invoices: [
            { tax_rec_id: 'RF2606-01941', existing_tax_id: null, service_date: dateX },
            { tax_rec_id: 'RF2606-01945', existing_tax_id: null, service_date: dateX },
            { tax_rec_id: 'RF2606-01944', existing_tax_id: 'TAX-A', customer_num: 'C01', service_date: dateX },
            { tax_rec_id: 'RF2606-01943', existing_tax_id: 'TAX-A', customer_num: 'C01', service_date: dateX }
        ]
    },
    {
        name: '3.8 ไม่มีข้อมูล+ไม่เกิน7วัน+วันX (01941) + ไม่มีข้อมูล+ไม่เกิน7วัน+วันY (01942) + มีข้อมูลA+ไม่เกิน7วัน+วันX (01944) + มีข้อมูลA+ไม่เกิน7วัน+วันX (01943)',
        invoices: [
            { tax_rec_id: 'RF2606-01941', existing_tax_id: null, service_date: dateX },
            { tax_rec_id: 'RF2606-01942', existing_tax_id: null, service_date: dateZ }, // dateZ is Z !== X
            { tax_rec_id: 'RF2606-01944', existing_tax_id: 'TAX-A', customer_num: 'C01', service_date: dateX },
            { tax_rec_id: 'RF2606-01943', existing_tax_id: 'TAX-A', customer_num: 'C01', service_date: dateX }
        ]
    },
    {
        name: '3.9 ไม่มีข้อมูล+ไม่เกิน7วัน+วันX (01941) + ไม่มีข้อมูล+เกิน7วัน+วันY (01940) + มีข้อมูลA+ไม่เกิน7วัน (01944) + มีข้อมูลA+ไม่เกิน7วัน (01943)',
        invoices: [
            { tax_rec_id: 'RF2606-01941', existing_tax_id: null, service_date: dateX },
            { tax_rec_id: 'RF2606-01940', existing_tax_id: null, service_date: dateY }, // dateY is Y (> 7 days)
            { tax_rec_id: 'RF2606-01944', existing_tax_id: 'TAX-A', customer_num: 'C01', service_date: dateX },
            { tax_rec_id: 'RF2606-01943', existing_tax_id: 'TAX-A', customer_num: 'C01', service_date: dateX }
        ]
    }
];

console.log('=== TEST SCENARIO RESULTS ===\n');
scenarios.forEach(sc => {
    const res = testLookupResult(sc.invoices);
    console.log(`[Scenario]: ${sc.name}`);
    console.log(`Action:     ${res.action}`);
    if (res.message) {
        console.log(`Message:\n${res.message.split('\n').map(l => '  ' + l).join('\n')}`);
    }
    if (res.proceedList) {
        console.log(`Proceedable IDs: ${res.proceedList}`);
    }
    console.log('--------------------------------------------------\n');
});
