# **Project Memory & Handover Log (MEMORY.md)**

This document serves as the persistent memory and active log for the Full Tax Request (FTR) project. As mandated by **Rule #12 (Memory Persistence)**, every completed task, feature implementation, or significant architectural decision must be logged here to maintain absolute continuity across AI assistance sessions.

## **1. Project Overview**
* **Project Name:** Full Tax Request System (FTR)
* **Core Goal:** Automate the transition from physical "Brief Tax Invoices" to digital Full Tax Invoices via Line Official Account (OA) and LIFF forms.
* **Key Architecture:** Consolidated `invoices` table combining daily CDMS transaction imports with customer LIFF tax profiles (`company_name`, `address`, `tax_id`), alongside `generated_documents` tracking.

## **2. Active Context & Current State**
* **Current Status:** Phase 5 (Cron Batch Script), Phase 6 (Admin Auth), Phase 7 (CDMS CSV Ingest), Phase 8 (Customer Search & Edit), and Phase 9 (Activity Logs Viewer) have been fully implemented. The admin portal and standalone cron script are ready for testing. The database schema is fully aligned and ready.

## **3. Session & Task History**

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
