# **Project Memory & Handover Log (MEMORY.md)**

This document serves as the persistent memory and active log for the Full Tax Request (FTR) project. As mandated by **Rule #12 (Memory Persistence)**, every completed task, feature implementation, or significant architectural decision must be logged here to maintain absolute continuity across AI assistance sessions.

## **1. Project Overview**
* **Project Name:** Full Tax Request System (FTR)
* **Core Goal:** Automate the transition from physical "Brief Tax Invoices" to digital Full Tax Invoices via Line Official Account (OA) and LIFF forms.
* **Key Architecture:** Consolidated `invoices` table combining daily CDMS transaction imports with customer LIFF tax profiles (`company_name`, `address`, `tax_id`), alongside `generated_documents` tracking.

## 2. Active Context & Current State
* **Current Status:** All requested phases and adjustments—including pagination (50 records limit with navigators), search clearing, status staging (splitting pending into Incomplete/Pending), branch popup column realignment, save-only confirmation, dynamic client URL resolution, and side-by-side LINE Flex message company names—have been fully implemented, verified via integration test suites, and pushed to GitHub.

## 3. Session & Task History

### **[2026-06-19] Remove Horizontal Borders on PDF Template Summary Section**
* **Task Summary:** Removed horizontal borders under the "รวมเป็นเงิน", "หักส่วนลด", "ยอดหลังหักส่วนลด", "หักเงินมัดจำ", and "ยอดหลังหักส่วนลด" fields in the HTML invoice template to match visual styling guidelines.
  - **CSS Adjustments**: Added utility classes `.no-border-top` and `.no-border-bottom` to targets `calc-label` and `calc-value` to toggle borders.
  - **HTML Adjustments**: Applied classes to the corresponding `tr` elements. Because `border-collapse: collapse` merges adjacent cell borders, removing the borders required setting `border-bottom: none` on the top row and `border-top: none` on the bottom row.
  - **Verification**: Executed `node src/test-pdf.js` to compile the template and verify visual output rendering inside Puppeteer.
* **Key Decisions:** Used helper CSS classes directly in the template `<style>` block to maintain clean, manageable HTML markup rather than messy inline styling.

### **[2026-06-19] ZIM Customer Invoice PartName Prefixing**
* **Task Summary:** Implemented automated prefix formatting for ZIM (Thailand) Co., Ltd. invoice records during CDMS CSV file imports.
  - **Prefix logic**: Created `src/config.js` to store a configurable list of ZIM PartNames (e.g. Glue Stain Cleaning, Oil Stain Cleaning, Remove DG Sticker). If the row's CustomerCode starts with "ZIM" (case-insensitive) and its trimmed PartName matches the list (case-insensitively), we prefix the PartName with "ZIM - 02 " when saving to `invoices_rec.part_desc` (e.g., `"ZIM - 02 Glue Stain Cleaning"`), ignoring `PartNumber`.
  - **Trim & Normalization**: Leading and trailing spaces are automatically removed from `PartName`.
  - **Verification**: Created `scratch/verify_zim_prefix.js` verifying the logic across multiple matching and non-matching scenarios.
* **Key Decisions:** Used a centralized `config.js` file to ensure the list of ZIM PartNames is easily editable for future modifications. Monkey-patched authentication middleware in verification tests to allow simple, clean programmatic API calls without authentication redirect loops.

### **[2026-06-19] LINE Links Redirect, Flex Message Company Name Layout, Save-Only Fix, Pagination, and Search UX Enhancements**
* **Task Summary:** 
  - **Dynamic Link Resolution**: Fixed the game website redirect issue by implementing dynamic base URL resolution based on request `Referer`/`Origin` headers (or proxy/host fallback), bypassing the placeholder `your-domain.com` in both single and multi-invoice endpoints.
  - **LINE Flex Layout**: Redesigned the multi-pdf LINE Flex message to display the associated company name next to each document download link in side-by-side columns, complete with professional headers for "เลขที่เอกสาร" and "ชื่อบริษัท", and removed the global company name header.
  - **Save-Only Response**: Corrected the save-only behavior in `/save-and-send`. It now returns the toast message `'ได้บันทึกรายการแล้ว'` and skips background PDF generation/sending.
  - **Pagination**: Implemented server-side pagination (50 records per page) and navigational controls (Prev/Next buttons with a page selection dropdown) across all admin portal tables (Invoice Data, Customer Data, Manage PDF, Activity Logs).
  - **PDF Status Stages**: Split the `pending` PDF status into `Incomplete` (missing customer details) and `Pending` (has customer details, awaiting PDF generation), with updated badge visualizations.
  - **Search & UI Adjustments**: Added "Clear Search" buttons to all admin search pages. Moved the "Select" button to the first column in the customer profile branch selector popup. Changed the email modal's background from transparent to solid.
  - **Multi-Profile Fix**: Fixed erroneous `TMP-` customer profile creation during invoice editing by submitting the selected `customer_num` to the backend to compare against the correct profile.
* **Key Decisions:**
  - Used request origin dynamically so that development (localhost:3000) and production (ftr.uniconwebapp.com) environments do not require manual env updates for links.
  - Avoided premature locking of PDF generation/sending by skipping background tasks when the user only clicked "Save".
  - Maintained complete backward compatibility in DB lookups and email engines.

### **[2026-06-04] Admin Manage PDF Webpage and API Endpoints**
* **Task Summary:** Created a new "Manage PDF Invoices" portal page (`pdf-management.html`) in the Admin UI with identical filters to the customer search page. Added endpoints to manually trigger PDF generation (`POST /api/admin/customers/:tax_rec_id/generate-pdf`) and download generated PDFs (`GET /api/admin/customers/:tax_rec_id/download-pdf`). Structured action buttons with custom SVG icons, a CSS-only tooltip system, and dynamic disabled states depending on profile completeness and PDF readiness.
* **Key Decisions:**
  - Integrated the new page sidebar link across all existing admin panel files.
  - Placed a mock placeholder on the Send Email button for this step, alerting the admin on click.
  - Documented new pages and endpoints in `ftr_system_design.md`.

### **[2026-06-04] Manual Customer Modification & PDF Regeneration (Logic Gap Resolution)**
* **Task Summary:** Resolved a logic gap where manual updates by the Admin to customer details (`customer`, `customer_addr`, `tax_id`) did not trigger PDF regeneration. Now, modifying customer details sets the invoice `status = 'pending'`, which forces on-the-fly regeneration when the customer requests it next, or automatic nightly regeneration via the cron job.
* **Key Decisions:**
  - Modified the Admin Customer Update route `PUT /api/admin/customers/:tax_rec_id` to set `status = 'pending'`.
  - Updated the Customer Request route `POST /api/customer/request-invoice` to check if `record.status === 'ready'` before sending an existing PDF.
  - Updated `generatePdf` to update the `generated_at` timestamp of the existing `generated_documents` record using `CURRENT_TIMESTAMP` on regeneration.

### **[2026-06-02] FTR Admin Suite: Auth, CSV Ingest/Export, Logs Viewer & Cron Batch (Phase 5, 6, 7, 8 & 9)**
* **Task Summary:** Implemented the secure session-based authentication middleware for all static admin pages and API endpoints. Created the inbound CDMS CSV parser (with headers checking, date formatting, duplicate validation, and transaction handling) and the outbound accounting export CSV stream. Developed a unified, responsive admin dashboard, login page, customer profile editor (with preview), and a paginated/filterable activity logs viewer page. Created the standalone `src/cron_batch.js` script to generate PDFs in bulk and release DB pool on exit (integrates with aaPanel). Realigned the database schema DDL script.
* **Key Decisions:** Implemented Phase 5 cron batch as a standalone shell execution script (Option A) to run as an independent, ephemeral OS process scheduled by aaPanel, preventing memory leaks in the primary Express web server. Combined the customer search/edit panel and the accounting export download button into a single workspace. Capped the logs pool at 500 recent events. Enforced responsive horizontal scrolling across all table grids on mobile screens.




### **[2026-05-25] System Design Specification Format Conversion & Integration**
* **Task Summary:** Converted `ftr_system_design.html` to a clean Markdown format in `ftr_system_design.md` and deleted the original HTML file. Integrated the LINE OA Rich Menu/LIFF step-by-step connection guide (`Rich_Menus_to_Webpages.md`) into `ftr_system_design.md` as Section 9, then deleted the standalone guide.
* **Key Decisions:** Consolidated and streamlined all documentation into a single, unified Markdown file. Corrected escaped HTML entities inside the template code block within the integrated guide to improve readability.

### **[2026-05-21] Security, CSV Validation & Admin Portal Requirements Update**
* **Task Summary:** Updated `FTR_REQ.md` and `FTR_Proposal.md` to incorporate stakeholder feedback: specified database-only provisioning for admin credentials without a management UI; added column validation and duplicate transaction checks for CSV upload/download operations; designed a Customer Profile Search & Edit tool for admins; and introduced a logs viewer webpage to display the 7 logged activities.
* **Key Decisions:** Opted for database-only admin user management to save scope and focus on security. Integrated strict CSV upload validations (duplicate `tax_rec_id` and missing columns) to ensure data sanity prior to DB writes.

### **[2026-05-18] Requirements Cleanup, Action Renaming & Activity Log Schema Simplification**
* **Task Summary:** Removed empty "Data Requirements" section from `FTR_REQ.md` and renumbered remaining sections. Shortened the 7 core activity log action names (e.g., `request_add_missing_data` -> `REQ_MISS_DATA`). Simplified the `activity_logs` database table schema by replacing individual data columns with a single placeholder `values` TEXT column storing colon-delimited event data, and setting `datetime` to a formatted VARCHAR string (`<dd>-<mm>-<yyyy> <HH>:<MM>`). Updated `FTR_Proposal.md` to ensure complete alignment with these architectural and naming enhancements.
* **Key Decisions:** Adopted a flexible `action|datetime|values` logging pattern to avoid sparse/null columns in the audit table and improve schema maintainability across all project documentation.

### **[2026-05-18] Admin Authentication, Activity Logging & Dynamic Email Dispatch Updates**
* **Task Summary:** Updated `FTR_REQ.md` and `FTR_Proposal.md` to incorporate new stakeholder requirements: 1) Admin user/password authentication for the CDMS CSV upload and Accounting CSV download web portals. 2) A comprehensive Activity Logging system tracking 7 distinct event types across customer requests, admin actions, cron jobs, and email deliveries. 3) Dynamic email delivery of requested Full Tax Invoice PDFs, capturing `email_sending` during the LIFF request without storing it permanently in the `invoices` table.
* **Key Decisions:** Introduced `admin_users` table for secure credential management and `activity_logs` table for granular auditability. Shifted document delivery mechanism from Line chat push to dynamic Email attachment dispatch via Nodemailer/SMTP.

### **[2026-05-16] FTR Requirements Refinement, Rules Establishment & Client Proposal**
* **Task Summary:** Audited and updated `FTR_REQ.md` to incorporate LIFF-centric workflows, one-to-one consolidated database schema (`invoices`), explicit exception handling ("Data not ready yet", incomplete profile prompt), and Admin CSV upload/download portals. Created `RULES.md` and `MEMORY.md` to establish strict engineering guidelines and persistent session handover. Created `FTR_Proposal.md` as a highly polished, executive-ready client proposal document.
* **Key Decisions:** Consolidated `user_profiles` and `invoices` into a single table; replaced brief document verification code checks with a 3-column tax profile completeness check (`company_name`, `address`, `tax_id`).
