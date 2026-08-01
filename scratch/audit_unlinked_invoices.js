const db = require('../src/db');

async function auditUnlinkedInvoices() {
    console.log("==================================================================");
    console.log("🔍 AUDIT REPORT: INVOICES WITH UNLINKED / ORPHANED CUSTOMER NUMBERS");
    console.log("==================================================================\n");

    try {
        // 1. Find all invoices where customer_num is set but does not exist in customer_profile
        const [orphanedInvoices] = await db.query(`
            SELECT i.tax_rec_id, i.customer_num AS orphaned_customer_num, i.service_date, i.status, i.created_at
            FROM invoices i
            WHERE i.customer_num IS NOT NULL 
              AND i.customer_num != ''
              AND i.customer_num NOT IN (SELECT customer_num FROM customer_profile WHERE customer_num IS NOT NULL AND customer_num != '')
            ORDER BY i.tax_rec_id ASC
        `);

        console.log(`Found ${orphanedInvoices.length} orphaned invoice records in total.\n`);

        if (orphanedInvoices.length === 0) {
            console.log("✅ No orphaned invoice records found in the database!");
            return;
        }

        const reportResults = [];

        // 2. Cross-reference each orphaned invoice against activity_logs and customer_profile
        for (const inv of orphanedInvoices) {
            const taxRecId = inv.tax_rec_id;

            // Search activity logs for any entries referencing this tax_rec_id
            const [logs] = await db.query(`
                SELECT log_id, log_action, log_datetime, username, log_values
                FROM activity_logs
                WHERE log_values LIKE ?
                ORDER BY log_id DESC
            `, [`%${taxRecId}%`]);

            let matchedTaxId = null;
            let matchedCustomerName = null;
            let matchedAddress = null;
            let logEvidence = [];

            for (const log of logs) {
                logEvidence.push(`[${log.log_action} @ ${log.log_datetime}] ${log.log_values}`);
                
                // Parse log_values patterns
                // e.g. ONTHEFLY_GEN_PDF: 'RF2607-01566:0105535006083:line:/storage/pdfs/...'
                // e.g. REQ_MISS_DATA: 'Customer Name:Address:RF2607-01566'
                const parts = (log.log_values || '').split(':');
                
                if (log.log_action === 'ONTHEFLY_GEN_PDF' || log.log_action === 'REQ_INVOICE') {
                    if (parts.length >= 2 && parts[0] === taxRecId) {
                        matchedTaxId = parts[1].trim(); // tax_id
                    }
                } else if (log.log_action === 'REQ_MISS_DATA') {
                    if (parts.length >= 3 && parts[2] === taxRecId) {
                        matchedCustomerName = parts[0].trim();
                        matchedAddress = parts[1].trim();
                    }
                }
            }

            // Search customer_profile for candidate profiles matching matchedTaxId or matchedCustomerName
            let recommendedProfile = null;
            if (matchedTaxId) {
                const [profByTaxId] = await db.query(`
                    SELECT customer_num, customer_name, customer_branch, tax_id 
                    FROM customer_profile 
                    WHERE tax_id = ?
                    LIMIT 1
                `, [matchedTaxId]);
                if (profByTaxId.length > 0) {
                    recommendedProfile = profByTaxId[0];
                }
            }

            if (!recommendedProfile && matchedCustomerName) {
                const [profByName] = await db.query(`
                    SELECT customer_num, customer_name, customer_branch, tax_id 
                    FROM customer_profile 
                    WHERE customer_name LIKE ?
                    LIMIT 1
                `, [`%${matchedCustomerName}%`]);
                if (profByName.length > 0) {
                    recommendedProfile = profByName[0];
                }
            }

            reportResults.push({
                tax_rec_id: inv.tax_rec_id,
                orphaned_customer_num: inv.orphaned_customer_num,
                service_date: inv.service_date ? inv.service_date.toISOString().split('T')[0] : '',
                log_tax_id: matchedTaxId || 'N/A',
                log_customer_name: matchedCustomerName || 'N/A',
                recommended_customer_num: recommendedProfile ? recommendedProfile.customer_num : 'NOT FOUND',
                recommended_customer_name: recommendedProfile ? recommendedProfile.customer_name : 'N/A',
                logs_count: logs.length
            });
        }

        console.table(reportResults);

        console.log("\n==================================================================");
        console.log("💡 SUMMARY & SUGGESTED FIX SQL");
        console.log("==================================================================");
        reportResults.forEach(r => {
            if (r.recommended_customer_num !== 'NOT FOUND') {
                console.log(`-- Fix for ${r.tax_rec_id}:`);
                console.log(`UPDATE invoices SET customer_num = '${r.recommended_customer_num}' WHERE tax_rec_id = '${r.tax_rec_id}';`);
            } else {
                console.log(`-- No matching profile found in customer_profile for ${r.tax_rec_id} (Orphaned Code: ${r.orphaned_customer_num})`);
            }
        });

    } catch (err) {
        console.error("❌ Error during audit:", err);
    } finally {
        process.exit(0);
    }
}

auditUnlinkedInvoices();
