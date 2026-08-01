/**
 * FTR Utility Script: Audit and Reconstruct Unlinked Invoice Customer Numbers
 * 
 * Part 1: Retrieves all invoice records from `invoices` table that refer to a non-existing customer_num in `customer_profile`.
 * Part 2: Cross-references `activity_logs` for historical event evidence to identify the correct customer profile,
 *         and outputs recommended target customer_num values and fix SQL statements.
 * 
 * Usage:
 *   node src/utils/audit_unlinked.js
 *   node src/utils/audit_unlinked.js --apply-fix   (optional flag to automatically apply recommended fixes)
 */

const db = require('../db');
const { logActivity } = require('../logger');

async function runAuditAndFix() {
    const applyFix = process.argv.includes('--apply-fix');

    console.log("==================================================================");
    console.log("🔍 FTR SYSTEM AUDIT: UNLINKED INVOICE CUSTOMER NUMBERS");
    console.log("==================================================================\n");

    try {
        // Step 1: Retrieve invoice records with non-existing customer_num
        const [orphanedInvoices] = await db.query(`
            SELECT i.tax_rec_id, i.customer_num AS orphaned_customer_num, i.service_date, i.status, i.created_at
            FROM invoices i
            WHERE i.customer_num IS NOT NULL 
              AND i.customer_num != ''
              AND i.customer_num NOT IN (SELECT customer_num FROM customer_profile WHERE customer_num IS NOT NULL AND customer_num != '')
            ORDER BY i.tax_rec_id ASC
        `);

        console.log(`📊 Found ${orphanedInvoices.length} unlinked/orphaned invoice record(s) in database.\n`);

        if (orphanedInvoices.length === 0) {
            console.log("✅ All invoice customer_num references are valid and exist in customer_profile!");
            return;
        }

        const reportTable = [];
        const fixStatements = [];

        // Step 2: Cross-reference activity_logs to find historical tax_id / customer data
        for (const inv of orphanedInvoices) {
            const taxRecId = inv.tax_rec_id;

            // Search activity logs for log entries containing this invoice number
            const [logs] = await db.query(`
                SELECT log_id, log_action, log_datetime, username, log_values
                FROM activity_logs
                WHERE log_values LIKE ?
                ORDER BY log_id DESC
            `, [`%${taxRecId}%`]);

            let matchedTaxId = null;
            let matchedCustomerName = null;
            let matchedAddress = null;

            for (const log of logs) {
                const valuesStr = log.log_values || '';
                const parts = valuesStr.split(':');

                // Parse logged activity values
                if (log.log_action === 'ONTHEFLY_GEN_PDF' || log.log_action === 'REQ_INVOICE' || log.log_action === 'SENDING_EMAIL') {
                    // Pattern: 'RF2607-002371:0105535006083:...'
                    if (parts.length >= 2 && parts[0] === taxRecId) {
                        if (/^\d{13}$/.test(parts[1].trim())) {
                            matchedTaxId = parts[1].trim();
                        }
                    }
                } else if (log.log_action === 'REQ_MISS_DATA') {
                    // Pattern: 'Customer Name:Address:RF2607-002371'
                    if (parts.length >= 3 && parts[2] === taxRecId) {
                        matchedCustomerName = parts[0].trim();
                        matchedAddress = parts[1].trim();
                    }
                }
            }

            // Find matching customer profile in database by Tax ID or Name
            let recommendedProfile = null;

            if (matchedTaxId) {
                const [profByTax] = await db.query(
                    'SELECT customer_num, customer_name, tax_id, customer_branch FROM customer_profile WHERE tax_id = ? LIMIT 1',
                    [matchedTaxId]
                );
                if (profByTax.length > 0) {
                    recommendedProfile = profByTax[0];
                }
            }

            if (!recommendedProfile && matchedCustomerName) {
                const [profByName] = await db.query(
                    'SELECT customer_num, customer_name, tax_id, customer_branch FROM customer_profile WHERE customer_name LIKE ? LIMIT 1',
                    [`%${matchedCustomerName}%`]
                );
                if (profByName.length > 0) {
                    recommendedProfile = profByName[0];
                }
            }

            const targetNum = recommendedProfile ? recommendedProfile.customer_num : 'NOT_FOUND';

            reportTable.push({
                "Invoice No": inv.tax_rec_id,
                "Orphaned Code": inv.orphaned_customer_num,
                "Log Tax ID": matchedTaxId || 'N/A',
                "Log Customer Name": matchedCustomerName || 'N/A',
                "Recommended Code": targetNum,
                "Matched Profile Name": recommendedProfile ? recommendedProfile.customer_name : 'N/A',
                "Logs Found": logs.length
            });

            if (recommendedProfile) {
                fixStatements.push({
                    tax_rec_id: inv.tax_rec_id,
                    oldCustomerNum: inv.orphaned_customer_num,
                    targetCustomerNum: recommendedProfile.customer_num
                });
            }
        }

        console.table(reportTable);

        console.log("\n==================================================================");
        console.log("🛠️ RECOMMENDED SQL RECOVERY COMMANDS");
        console.log("==================================================================");

        if (fixStatements.length === 0) {
            console.log("⚠️ No candidate profiles could be matched automatically from activity logs.");
        } else {
            fixStatements.forEach(f => {
                console.log(`UPDATE invoices SET customer_num = '${f.targetCustomerNum}' WHERE tax_rec_id = '${f.tax_rec_id}';`);
            });

            if (applyFix) {
                console.log("\n⚡ Applying recommended fixes to database...");
                for (const f of fixStatements) {
                    await db.query('UPDATE invoices SET customer_num = ? WHERE tax_rec_id = ?', [f.targetCustomerNum, f.tax_rec_id]);
                    await logActivity('EDIT_CUSTOMER', `Code: ${f.oldCustomerNum || '(none)'} -> ${f.targetCustomerNum} | Invoice ${f.tax_rec_id} relinked via audit_unlinked.js --apply-fix`, 'system');
                    console.log(`✅ Updated invoice ${f.tax_rec_id} -> customer_num = ${f.targetCustomerNum}`);
                }
                console.log("\n🎉 All candidate fixes applied successfully!");
            } else {
                console.log("\n💡 Tip: To apply these recommended fixes automatically, run:");
                console.log("   node src/utils/audit_unlinked.js --apply-fix");
            }
        }

    } catch (error) {
        console.error("❌ Audit script failed:", error);
    } finally {
        try { await db.end(); } catch (e) {}
        process.exit(0);
    }
}

runCronBatch = runAuditAndFix;
runCronBatch();
