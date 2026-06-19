# Full Tax Request System (FTR) - System Specification

## 1. Executive Summary
This project automates the issuance of Full Tax Invoices via Line Official Account (OA). Customers transition from paper "Brief Tax Invoices" to digital Full Tax Invoices by providing supplemental tax details (Company Name, Address, Tax ID) and requesting the Full Tax Invoices through a LIFF form by inputting their Tax Record ID and Tax ID. The system then generates the invoice PDF on-the-fly and delivers it to the customer via email or LINE chat.

The system leverages daily data syncs (uploaded via a secure, authenticated admin webpage) from the Container Data Management System (CDMS) to validate requests and export additional tax data (downloadable as CSV via an authenticated admin webpage) back to the Accounting System. Requested PDFs are dispatched dynamically via email or LINE rather than being stored permanently. To ensure complete auditability, a comprehensive Activity Log records all critical customer requests, admin data syncs, automated batch jobs, email transmissions, and LINE dispatches.

## 2. Goals & Objectives
* **User Convenience:** 24/7 digital tax document requests via Line OA and LIFF, with automated delivery directly to the customer's specified email address.
* **Data Accuracy:** Capture missing `company_name`, `address`, and `tax_id` via a validated LIFF form.
* **Automation:** Nightly batch processing for completed records and "On-the-fly" generation for immediate user needs, followed by automated email dispatch.
* **Secure Admin Operations & Accounting Integration:** Provide secure, authenticated admin webpages (requiring username/password) for uploading daily CDMS CSV exports, downloading clean CSV exports of customer tax data for the Accounting System, searching/editing customer profiles, and viewing system activity logs.
* **Comprehensive Auditing:** Maintain an extensive Activity Log tracking all customer submissions, invoice requests, admin uploads/downloads, batch jobs, and email dispatches.

## 3. User Personas
* **The Customer (e.g., Truck Driver):** Needs a Full Tax Invoice for their company; uses Line LIFF forms to submit missing data and request invoices by providing their email address, receiving official PDF documents directly via email.
* **The Admin (Finance Team):** Accesses the secure admin portal via username/password authentication to manage the manual CSV upload from CDMS (after 18:00), download the consolidated CSV export for the Accounting System, search and edit customer profiles (company name, address, tax ID), and monitor system activity logs.

## 4. User Flow
1. **Service Completion:** Customer gets a physical "Brief Tax Invoice" with a **Tax Record ID** (e.g., RF2605-00589) and a verification code.
2. **Adding Customer Data & Generating PDF (LIFF — Combined Flow):** Customer clicks "กรอกข้อมูลลูกค้า" in Line OA to open the LIFF form. They enter their **Tax Record ID** and **Tax ID**, then click **Search** (🔍) to look up their company profile, or **Manual Input** (✏️) to enter data directly. After filling in all fields, they click **Save & Send** which generates the PDF on-the-fly and delivers it via the chosen channel.
   - *If Tax Record ID is not found:* Error message displayed — `"ไม่มีใบกำกับภาษีของหมายเลขนี้, ถ้าได้เข้ารับบริการแล้วโปรดรอครึ่งวันหรือติดต่อ Admin"`.
   - *If Tax ID matches a registered profile:* A customer selection sheet appears; customer selects their branch, fields are auto-populated (read-only). Only Container Number remains editable.
   - *If Tax ID is not registered:* Manual entry mode — Customer Branch, Name, and Address are editable; Customer Number is auto-generated with timestamp format `TMP-YYMMDDHHMMSS` (read-only).
3. **Validation & One-Time Restriction:** The system enforces that customer data can only be submitted **once** from the Rich Menu (tracked via `is_customer_data_updated` flag). The PDF can also only be generated and sent **once** from the Rich Menu (tracked via `is_pdf_sent_from_richmenu` flag). Admin portal has no such restrictions.
4. **PDF Delivery:** After clicking Save & Send and choosing a delivery method:
   - *Save Only:* Data is saved without generating PDF or sending any message. Customer sees: `"ได้บันทึกรายการแล้ว"`.
   - *Send Email:* PDF is generated on-the-fly and sent as an email attachment. Customer sees: `"โปรดตรวจสอบอีเมล์ของคุณในอีก 1-2 นาที"`.
   - *Send LINE:* PDF is generated on-the-fly and a LINE Flex Message with a PDF download link is pushed to the customer's LINE chat. Customer sees: `"โปรดตรวจสอบไลน์ของคุณในอีก 1-2 นาที เพื่อรับ Link ในการดาวโหลด"`.
5. **Request Full Tax Invoice Form (LIFF — Separate):** Customer can also use the separate Request Invoice form (submitting `tax_rec_id`, `tax_id`, and `email_sending`) to re-request delivery of an already-complete invoice to any email address. No frequency restriction on this form.

## 5. Functional Requirements

### 5.1 Front-End: Line OA & LIFF Integration

#### Rich Menu Functions:
1. **Adding Customer Data & Save & Send Form (LIFF) — `public/liff/missing-info.html`:**
   - **Fields:** `tax_rec_id` (Tax Record ID), `tax_id` (13-digit Tax ID), `customer_branch`, `customer_num` (read-only, auto-generated `TMP-YYMMDDHHMMSS` for manual entry), `customer_name` (read-only or editable), `address` (read-only or editable), `container_num` (always editable).
   - **UI Layout:** Tax Record ID and Tax ID fields are active on load. All customer fields are greyed out. Two buttons sit beside the Tax ID field: **Search** (🔍) and **Manual Input** (✏️).
   - **State Machine:** The page operates as a 7-state machine:
     - `INITIAL` — Tax Record ID & Tax ID editable; all customer fields locked.
     - `SEARCHING` — Spinner shown; inputs temporarily disabled while API call is in progress.
     - `NO_RECORD` — Tax Rec ID not found in DB; error banner shown; return to `INITIAL`.
     - `PROFILE_FOUND` — Branches returned from `customer_profile`; customer selection bottom sheet shown.
     - `PROFILE_SELECTED` — Customer selected; all fields populated and read-only; only Container Number editable.
     - `MANUAL_ENTRY` — Tax ID not in `customer_profile` or customer clicked ✏️ Input button; Branch, Name, Address editable; Customer Num = auto-generated `TMP-YYMMDDHHMMSS` (read-only).
     - `READONLY_LOCKED` — Invoice already has `tax_id` (customer data was previously saved) OR `status = 'ready'`; entire form disabled including ✏️ Input button; warning banner: `"⚠️ ถ้าต้องการแก้ไขข้อมูลลูกค้า โปรดติดต่อ admin"`.
     - `LOCKED` — `is_customer_data_updated = TRUE`; entire form disabled; error banner shown.
   - **Search Button (🔍):** Validates both fields, calls `GET /api/customer/lookup-branches?tax_rec_id=...&tax_id=...`. Handles `NO_RECORD`, `LOCKED`, branches-found, and no-branches (manual) responses.
   - **Manual Input Button (✏️):** Calls the same API to verify the Tax Rec ID is valid and not locked, then enters `MANUAL_ENTRY` state regardless of Tax ID result.
   - **Customer Selection Bottom Sheet:** Slide-up modal displaying a compact table of customer records (Customer Name, Address truncated to 2 lines, Branch badge). Compact font (0.74–0.85rem). Customer taps a row to select, then taps **ตกลง (OK)** to confirm or **ยกเลิก (Cancel)** to dismiss.
   - **Save & Send Button:** Opens a delivery popup modal with:
     - An email input field + **📨 Send Email** button (grouped together).
     - A **💚 Send via LINE** button.
     - A **Cancel** button.
   - **Save Only:** Calls `POST /api/customer/save-and-send` with `send_method: 'save'`. Only saves data, no PDF generation or dispatch. Confirmation message: `"ได้บันทึกรายการแล้ว"`.
   - **Email Delivery:** Calls `POST /api/customer/save-and-send` with `send_method: 'email'`. Confirmation message shown: `"โปรดตรวจสอบอีเมล์ของคุณในอีก 1-2 นาที"`.
   - **LINE Delivery:** Calls `POST /api/customer/save-and-send` with `send_method: 'line'`. Confirmation message shown: `"โปรดตรวจสอบไลน์ของคุณในอีก 1-2 นาที เพื่อรับ Link ในการดาวโหลด"`. The LINE delivery sends a **Flex Message** card with a tap-to-open PDF download link (LINE Messaging API does not support direct binary file attachments).
   - **One-Time Constraints (Rich Menu only):**
     - Customer data can only be submitted **once**: `is_customer_data_updated` flag in `invoices` table. If already set, show: `"ไม่สามารถแก้ไขข้อมูลลูกค้าได้มากกว่า 1 ครั้ง โปรดติดต่อ admin"`.
     - PDF can only be generated & sent **once**: `is_pdf_sent_from_richmenu` flag. If already set, show: `"ไม่สามารถสร้างใบกำกับภาษีในรูปแบบ PDF ได้มากกว่า 1 ครั้ง โปรดติดต่อ admin"`.
     - Admin portal is **not** subject to these restrictions.
   - **Activity Logging:** Records `REQ_MISS_DATA` (`company_name:address:tax_rec_id`) and `ONTHEFLY_GEN_PDF` (`tax_rec_id:tax_id:send_method:pdf_path`).
 2. **Request Full Tax Invoice Form (LIFF) — `public/liff/request-invoice.html`:**
    - **Inputs:** `tax_id` (with Search button 🔍) and `tax_rec_id` (supports comma-separated list of IDs).
    - **Search & Pre-selection**: The customer enters their Tax ID and clicks Search (🔍). A popup checklist is shown containing only invoices that link to the Tax ID from the last 14 days. The customer selects the invoices, which populates the `tax_rec_id` field as a comma-separated list.
    - **Verification (Step 1)**: Customer clicks **ตกลง (OK)**. The LIFF page calls `GET /api/customer/check-invoice` to verify invoice status and customer profile link status for all entered IDs. If any ID is invalid (e.g. doesn't exist, doesn't match Tax ID), it is excluded and a warning is shown. If at least one valid ID remains, the Delivery selection bottom sheet is opened.
    - **Delivery Selection (Step 2)**: Customer selects either:
      - **Email Delivery**: Inputs email address, clicks ส่ง. Calls `POST /api/customer/request-invoice` with `send_method: 'email'` and `email_sending`. For multi-invoice requests, all PDFs are attached to a single email where the subject contains the `tax_id` and the body lists the `tax_rec_id`s.
      - **LINE Delivery**: Clicks ส่งทาง LINE. Calls `POST /api/customer/request-invoice` with `send_method: 'line'` and `line_user_id`. For multi-invoice requests, the LINE Flex Message header shows the `tax_id` and the body lists the `tax_rec_id` links line-by-line.
    - **Exception Handling**:
      - *No Invoice:* Display `"ไม่มีใบกำกับภาษีของหมายเลขนี้, ถ้าได้เข้ารับบริการแล้วโปรดรอครึ่งวันหรือติดต่อ Admin"`.
      - *Scenario 1 (Unlinked existing profile):* Display `"กรุณาเพิ่มข้อมูลลูกค้าใน invoice จากเมนู 'เพิ่มข้อมูลลูกค้า'"`.
      - *Scenario 2 (Unlinked new profile):* Display `"กรุณาสร้างลูกค้าใหม่ และ เพิ่มข้อมูลลูกค้าใน invoice จากเมนู 'เพิ่มข้อมูลลูกค้า'"`.
      - *Tax ID Mismatch:* Display `"หมายเลขประจำตัวผู้เสียภาษีไม่ตรงกับใบกำกับภาษีนี้"`.
    - **Activity Logging:** Records `REQ_FULL_TAX` (`tax_rec_id:tax_id:email_sending` or `tax_rec_id:tax_id:LINE`).

#### LIFF Performance Optimization:
To ensure the webpages load instantly when tapped from the LINE OA Rich Menu, the following frontend speed optimizations are applied:
* **Preconnect Connections:** Active `<link rel="preconnect">` tags for LINE CDN (`https://static.line-scdn.net`), Google Fonts (`https://fonts.googleapis.com`), and Google Static Assets (`https://fonts.gstatic.com`) established in the HTML headers. This eliminates DNS, TCP, and TLS negotiation overhead before resources are requested.
* **Inlined CSS Stylesheets:** Critical CSS styles from `style.css` are embedded directly inside the HTML page `<style>` block. This removes the render-blocking HTTP request for external CSS, enabling the browser to perform instantaneous paint operations on page load.
* **Native LINE LIFF URL Integration:** The Rich Menu triggers the forms via official LINE LIFF URLs (`https://liff.line.me/...`) rather than standard external browser links. This permits pre-authenticated access inside the LINE in-app web container, eliminating OAuth login redirect delays.

#### Messaging API, Email & LINE Dispatch:
- **Email Dispatch:** The Email Engine (Nodemailer + Gmail OAuth2) dispatches the PDF as an attachment to the customer's specified email address.
- **LINE Push Dispatch:** The LINE Messaging API (`POST https://api.line.me/v2/bot/message/push`) is used to push a branded **Flex Message** card to the customer's LINE chat.
  - **Single Invoice Request:** Sends a Flex card with the invoice details and a **"📄 เปิด/ดาวโหลด ใบกำกับภาษี (PDF)"** button.
  - **Multi-Invoice Request:** Sends a Flex card that removes the top-level global company header and instead places the corresponding company name next to each `tax_rec_id` download link in a side-by-side, column-based layout.
  - **Dynamic Link Resolution:** PDF links are constructed dynamically using the base URL of the client request (`Referer` or `Origin` headers parsed on the fly). This ensures the links match the exact domain/port (e.g. `http://localhost:3000` or `https://ftr.uniconwebapp.com`) accessed by the phone/PC, bypassing placeholder configurations like `your-domain.com`.
- **`line_user_id` Handling:** The customer's LINE User ID is captured in real-time via `liff.getProfile()` when the LIFF page loads. It is passed in the API request body for LINE push delivery and is **never stored in the database**.

### 5.2 Back-End: Node.js, Data Management & Admin Web Portal

#### Admin Web Portal:
* **Admin Authentication:** Secure login mechanism requiring valid username and password credentials to access any admin functionalities (stored in the `admin_users` table). There is no admin user management interface or webpage (no admin control UI); any addition or deletion of administrator accounts must be executed directly in the database.
* **Dashboard:** Displays overall system statistics (Invoice Pending Input, Invoice Ready to Export, New Customer Data, Invoice Pending PDF) fetched live from the backend database. "New Customer Data" counts profiles with `customer_num LIKE 'TMP-%'`.
* **CSV Upload Webpage (Inbound):** An authenticated webpage for Admin users to upload the daily transaction CSV export from CDMS (Post-18:00) and Customer Profile CSV files into the MySQL database.
  - **Auto-Detect Delimiter:** The file import automatically determines whether it is pipe-delimited (`|`) or comma-delimited (`,`) by analyzing delimiter counts on the first line.
  - **Auto-Detect Encoding:** To prevent Thai character corruption (such as when uploading legacy Excel CSV files), the parser automatically detects `Windows-874 / TIS-620` vs `UTF-8` formats and decodes the file accordingly.
  - **Flexible Column & Header Matching:** Columns are identified by dynamic header searching rather than fixed positions, supporting variations in header names (e.g. `E-mail` matches `email`).
  - **CDMS Validation & Checks:** The system validates columns, checks for duplicates, and rejects duplicate CDMS `tax_rec_id` values with the error message: `"Some Invoices already exist, cancel uploading. Duplicate record: [list of duplicate IDs]"`.
  - **ZIM PartName Prefix Rule:** If the uploaded record's `CustomerCode` starts with `"ZIM"` (case-insensitive) and its `PartName` matches a configured list of ZIM cleaning and sticker tasks (case-insensitively, after trimming), the system prepends `"ZIM - 02 "` to the `PartName` when saving to `invoices_rec.part_desc` (e.g. `"ZIM - 02 Glue Stain Cleaning"`), ignoring the `PartNumber`. This list is easily configurable in `src/config.js`.
  - **Customer Profile Import Validation:** Checks for required columns and **safely skips rows with missing Tax IDs** to prevent database constraint errors.
  - **Activity Logging:** Records `REQ_UPLOAD_CDMS` (`username:no_of_upload_rec`) or `REQ_UPLOAD_CUSTOMER` (`username:no_of_customer_profiles`).
* **Invoice Data Webpage (Outbound & Edit):** An authenticated webpage for Admin users to manage invoice records and download consolidated CSV exports.
  - **Search:** Search invoices by `tax_rec_id` (partial match), customer name/number, address, tax_id, service date range, and accounting export status. Results are paginated (50 records per page) with Prev/Next buttons and a middle page select dropdown.
  - **Edit:** Inline editing modal allows updating `company_name`, `address`, and `tax_id` directly in the `invoices` table.
  - **CSV Download:** Downloads additional customer tax data (`company_name`, `address`, `tax_id` linked to `tax_rec_id`) for the Accounting System, marking them as exported.
  - **Activity Logging:** Records `REQ_DOWNLOAD_MISS` (`username:no_of_download_rec`).
* **Customer Profile Database Webpage:**
  - **Search:** Allows searching the master `customer_profile` table by `tax_id`, `customer_num`, `customer_name`, and the new **Accounting Export Status** filter (options: All Records, Pending Export Only [default], Exported Only). Results are paginated (50 records per page) utilizing Prev/Next buttons and a middle page select dropdown.
  - **Edit:** Admins can edit fields including Customer Name, Address, Email, Phone, and Branch code. Editing a profile propagates changes to the `invoices` table (updates branch links, resets PDF status to `pending`, and resets `is_accounting_exported = FALSE` on matching invoices).
  - **Export:** Includes an **Export Results to CSV** button to download filtered profiles (where `is_accounting_exported = FALSE` by default) as a pipe-delimited (`|`) CSV, automatically marking them as exported in the database.
* **Manage PDF Webpage:**
  - **Search:** Search invoices by ID, date, completion status, Tax ID, or Customer (by customer name or customer number). Supports server-side status filtering and server-side pagination (50 records per page) with Prev/Next buttons and a middle page select dropdown.
  - **Actions:** Icon buttons with CSS tooltips and dynamic disabled states for:
    1. *Generate PDF* (`POST /api/admin/customers/:tax_rec_id/generate-pdf`): Generates PDF on-the-fly if profile is complete and PDF is not already generated.
    2. *Download PDF* (`GET /api/admin/customers/:tax_rec_id/download-pdf`): Downloads generated PDF. Enabled only if PDF status is 'ready'.
    3. *Send Email* (`POST /api/admin/customers/:tax_rec_id/send-email`): Dispatches generated PDF invoices to specified recipient emails natively using standard OAuth2 (Option A) or Gmail App Passwords (Option C) fallback.
* **Activity Logs Viewer Webpage:** UI for admins to view the audit trail from the `activity_logs` table. Displays up to 500 recent records across 10 pages (50 records/page) using Prev/Next buttons and a middle page select dropdown.

#### Activity Logging System:
Auditing mechanism recording **9** distinct types of system events (format: `action|datetime|values`):
1. `REQ_MISS_DATA`: Customer submitted data via LIFF Rich Menu form (`company_name:address:tax_rec_id`)
2. `REQ_FULL_TAX`: Customer requested invoice via the Request Invoice LIFF form (`tax_rec_id:tax_id:email_sending`)
3. `REQ_UPLOAD_CDMS`: Admin uploaded CDMS data (`username:no_of_upload_rec`)
4. `REQ_DOWNLOAD_MISS`: Admin downloaded accounting export CSV (`username:no_of_download_rec`)
5. `CRON_GEN_PDF`: PDFs generated by nightly cron batch (`no_of_generated_rec`)
6. `ONTHEFLY_GEN_PDF`: PDF generated on-the-fly via Save & Send or Request Invoice (`tax_rec_id:tax_id:send_method:pdf_path`)
7. `SENDING_EMAIL`: Email dispatched with PDF attachment (`email_address:pdf_path`)
8. `SENDING_LINE`: LINE Flex Message dispatched with PDF download link (`tax_rec_id:pdf_url`)
9. `REQ_DOWNLOAD_CUSTOMER`: Admin downloaded customer profile CSV export (`username:no_of_download_rec`)

### 5.3 Data Synchronization & PDF Generation
* **Nightly Batch:** Runs via node-cron. Scans for records with complete tax info but no PDF, then generates them in bulk. Records `CRON_GEN_PDF`.
* **On-the-Fly:** Triggered when a user requests a Full Tax Invoice where data is complete but PDF has not been generated yet. Records `ONTHEFLY_GEN_PDF`.
* **Email Dispatch:** After PDF generation/retrieval, creates an email with the PDF attached and sends it to `email_sending`. Records `SENDING_EMAIL`.
* **Verification Criteria:** To generate a PDF, `company_name`, `address`, and `tax_id` must contain valid data.

#### 5.3.1 PDF Pagination and Address Clamping Logic

To ensure the generated Full Tax Invoice PDFs strictly comply with the A4 single-page layout (under normal circumstances) and format multi-page invoices properly without layout breaks or horizontal line mismatches, the following constraints and algorithms are implemented:

##### 1. A4 Page Height & Table Capacity Constraints
- The printable area height of an A4 page with 10mm top and 8mm bottom margins is **279mm** (approx. `1054px` at 96 DPI).
- To accommodate long, wrapped customer company names and addresses, the maximum number of table rows allowed per page is **9 rows**.
- If the table size is kept at exactly 9 rows (including items, BKG/CNTR, and empty padding rows), the content is guaranteed to fit on exactly one page without overflowing or creating trailing blank pages.

##### 2. Customer Address Clamping (Max 5 Lines)
- Customer addresses can occasionally wrap to multiple lines, expanding the customer info box and pushing the items table down.
- To prevent address wrapping from causing unexpected layout overflows, a CSS line clamp is applied to the address container:
  ```css
  .customer-addr {
      font-size: 12px;
      margin: 0;
      display: -webkit-box;
      -webkit-line-clamp: 5;
      -webkit-box-orient: vertical;
      overflow: hidden;
      text-overflow: ellipsis;
  }
  ```
- Addresses exceeding **5 lines** are automatically truncated with an ellipsis (`...`), ensuring the customer box never grows beyond `82.5px` and fits within the page height safety margin.

##### 3. Booking & Container Paired Rows
- If **either** Booking No. or Container No. exists, **both** lines are rendered as a pair (`BKG: <value>` and `CNTR: <value>`) and kept together on the same page.
- Because this pair occupies 2 table rows, they are placed at the end of the last page.
- Single-page invoices containing BKG/CNTR can therefore fit **at most 7 items** (`9 - 2 = 7`).
- If an invoice has 8 or more items, the items are dynamically partitioned across multiple pages.

##### 4. Dynamic Page Partitioning Algorithm
- Let `items` be the list of invoice items.
- If `hasBkgCntr` is true (either booking_num or container_num has value):
  - If `items.length <= 7`: A single page is generated containing all items and the BKG + CNTR rows.
  - If `items.length > 7`: 
    - The first page(s) are packed with exactly **9 items** per page (no BKG/CNTR lines).
    - This slicing repeats until the remaining items can fit on the last page along with the BKG/CNTR block (i.e. remaining items $\le 7$).
    - The last page is rendered with the remaining items (between 0 and 7 items) followed by the BKG and CNTR rows.
- If `hasBkgCntr` is false:
  - Items are sliced in chunks of exactly **9 items** per page for all pages.

##### 5. Multi-Page Layout Formatting
- **Page Isolation**: In `invoice.html`, each page is wrapped in `<div class="page-container">`. The CSS handles A4 page breaks:
  ```css
  .page-container {
      width: 100%;
      padding: 0;
      overflow: hidden;
      box-sizing: border-box;
  }
  @media print {
      .page-container {
          page-break-after: always;
          box-sizing: border-box;
      }
      .page-container:last-child {
          page-break-after: avoid;
      }
  }
  ```
- **Page Counters**: The metadata block on every page displays `{{pageNumber}}` populated as `CurrentPage / TotalPages` (e.g. `1 / 2`, `2 / 2`).
- **Summary Section Rules**:
  - **Non-final pages**: The subtotal, discount, vat, and totalAmount cells are rendered blank. The Baht text cell displays `( อ่านต่อหน้าถัดไป / Continued on Next Page )`.
  - **Final page**: Displays the actual computed totals and the final Baht text.


## 6. Technical Stack
* **Backend:** Node.js (Express.js for API, Admin Web Portal with Authentication)
* **Frontend (Admin):** HTML5, CSS3, JavaScript (for Login, CSV Upload/Download, Customer Search & Edit, and Activity Log Viewer webpages)
* **Frontend (Customer):** LIFF (Line Frontend Framework) — Thai Sarabun font, mobile-first design
* **Database:** MySQL
* **PDF Engine:** Puppeteer (HTML-to-PDF)
* **Scheduler:** Node-cron
* **Email Engine:** Nodemailer with Gmail OAuth2
* **HTTP Client:** Axios (used for LINE Messaging API push calls from Node.js backend)
* **LINE Messaging:** LINE Messaging API v2 — Push Message with Flex Message type for PDF link delivery

## 7. Database Schema

### 7.1 Table and Column Descriptions
```sql
DROP DATABASE IF EXISTS ftr_db;

-- Create the database
CREATE DATABASE ftr_db;

-- Use the newly created database
USE ftr_db;


-- 1. Invoice Header (Parent Table - One record per Invoice)
CREATE TABLE `invoices` (
    `tax_rec_id`                VARCHAR(50)  NOT NULL,            -- e.g. RF2605-01109 (Single source of truth)
    `customer_num`              VARCHAR(50)  DEFAULT NULL,         -- Link to customer_profile (unique key for join)
    `container_num`             TEXT         DEFAULT NULL,         -- Container number filled in by customer
    `service_date`              DATE         DEFAULT NULL,         -- format: YYYY-MM-DD
    `status`                    ENUM('pending','ready','failed') DEFAULT 'pending', -- Tracks PDF generation status
    `is_accounting_exported`    BOOLEAN      DEFAULT TRUE,         -- TRUE once accounting CSV has been downloaded (defaults to TRUE, becomes FALSE when customer data is filled)
    `is_customer_data_updated`  BOOLEAN      DEFAULT FALSE,        -- [CR#2] 1-time lock: customer submitted data via Rich Menu LIFF
    `is_pdf_sent_from_richmenu` BOOLEAN      DEFAULT FALSE,        -- [CR#2] 1-time lock: PDF generated & sent via Rich Menu LIFF
    `created_at`                TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
    `updated_at`                TIMESTAMP    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`tax_rec_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- Mapping CDMS data in excel file
-- CDMS file column = DB column = PDF field
-- InvoiceNo = tac_rec_id = เลขที่
-- InvoiceDate = service_date = วันที่
-- customer name (update from Line) = customer = ลูกค้า
-- customer address (update from Line) = customer_addr = (ที่อยู่)
-- tax id, update from Line = tax_id = เลขประจำตัวผู้เสียภาษี
-- PartNumber + PartName = part_desc = รหัสสินค้า/รายละเอียด
-- Price = price = หน่วยละ
-- Qty = unit_num = จำนวน
-- Amount = amount = จำนวนเงิน

-- 2. Invoice Items/Records (Child Table - Many records per Invoice)
CREATE TABLE `invoices_rec` (
    `rec_id` INT AUTO_INCREMENT NOT NULL,
    `tax_rec_id` VARCHAR(50) NOT NULL,
    `part_desc` VARCHAR(255) DEFAULT NULL,
    `price` DECIMAL(10, 2) DEFAULT NULL,
    `unit_num` DECIMAL(10,0) DEFAULT NULL,
    `amount` DECIMAL(10, 2) DEFAULT NULL,
    `verification_code` VARCHAR(20) DEFAULT NULL,
    PRIMARY KEY (`rec_id`),
    CONSTRAINT `fk_rec_invoice` FOREIGN KEY (`tax_rec_id`) REFERENCES `invoices` (`tax_rec_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `customer_profile` (
    `id`                      INT          AUTO_INCREMENT NOT NULL,
    `tax_id`                  VARCHAR(50)  NOT NULL,             -- e.g. 0107547001032
    `customer_num`            VARCHAR(50)  DEFAULT NULL,         -- e.g. CUS-00098, TMP-YYMMDDHHMMSS for manual entry (UNIQUE, used as join key with invoices)
    `customer_name`           TEXT         DEFAULT NULL,
    `customer_addr`           TEXT         DEFAULT NULL,
    `customer_email`          VARCHAR(50)  DEFAULT NULL,
    `customer_phone`          VARCHAR(20)  DEFAULT NULL,
    `customer_branch`         VARCHAR(50)  DEFAULT NULL,         -- e.g. สำนักงานใหญ่, 00004, 00009
    `is_accounting_exported`  BOOLEAN      DEFAULT FALSE,        -- TRUE once this customer's profile data has been downloaded by accounting
    `created_at`              TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
    `updated_at`              TIMESTAMP    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `idx_customer_num` (`customer_num`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Generated Documents (Child Table - One PDF per consolidated Invoice)
CREATE TABLE generated_documents (
    id INT AUTO_INCREMENT NOT NULL,
    tax_rec_id VARCHAR(50) NOT NULL,            -- Links to the Header
    pdf_folder VARCHAR(500) NOT NULL,
    generated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),    -- Relational constraint: link document to the header
    CONSTRAINT fk_doc_invoice FOREIGN KEY (tax_rec_id) REFERENCES invoices (tax_rec_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Create Admin Users Table 
CREATE TABLE admin_users ( 
    id INT AUTO_INCREMENT NOT NULL, 
    username VARCHAR(50) NOT NULL UNIQUE, 
    password_hash VARCHAR(255) NOT NULL, 
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, 
    PRIMARY KEY (id) 
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `activity_logs` (
    `log_id`       INT AUTO_INCREMENT NOT NULL,
    `log_action`   VARCHAR(100) NOT NULL,
    `log_datetime` VARCHAR(20) NOT NULL,
    `username`     VARCHAR(50) DEFAULT NULL,
    `log_values`   TEXT DEFAULT NULL,
    PRIMARY KEY (`log_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Insert Admin User: admin/admin123
INSERT INTO `admin_users` (`username`, `password_hash`) 
VALUES ('admin', '$2b$10$X.zBWTh4BdxYakAmTTm.HumGGz31N7ZRJ5vSgV2/VIfmbLU6Oxpv6');

```

## 8. Detailed Module Logic & Workflow Rules
To ensure a robust implementation, the detailed technical logic for each module is defined below.

#### Module 0 & 1: Foundation & Logging
* **Timezone:** All activity logs will format the `datetime` column strictly using the local timezone (e.g., Asia/Bangkok +07:00) to ensure accurate auditing.
* **Log Constraint:** The logging function executes asynchronously but must not block the main API response. If logging fails, the error is written to system logs but the user request still succeeds.

#### Module 2 & 3: LIFF Front-End — Adding Customer Data (`missing-info.html`)
* **State Machine:** The page uses a 7-state machine (INITIAL → SEARCHING → NO_RECORD / PROFILE_FOUND / MANUAL_ENTRY → PROFILE_SELECTED → LOCKED). State is managed in JavaScript; no page reload occurs between transitions.
* **Locked State on Load:** The page checks the `is_customer_data_updated` flag via the `/lookup-branches` API (which returns `code: 'LOCKED'` if already submitted). If locked, the entire form is disabled and an error banner is displayed immediately.
* **Line User ID:** `line_user_id` is captured via `liff.getProfile()` on page load, stored in a JS variable, and passed in the request body when the customer chooses LINE delivery. It is **never stored in the database**.
* **Customer Selection Bottom Sheet:** A slide-up modal rendered from API data. Rows display: Customer Name (bold), Address (2-line clamp, 0.74rem), Branch badge. Radio selection pattern; OK/Cancel buttons.
* **Manual Entry Mode:** Activated when Tax ID is not found in `customer_profile` OR when the customer explicitly clicks the ✏️ Input button (only available when invoice has no `tax_id` yet). Customer Number is auto-generated with timestamp format `TMP-YYMMDDHHMMSS` (read-only). Branch, Name, Address are freely editable. Save & Send button activates when all three are non-empty.
* **Lock Rule:** Once an invoice has a `tax_id` in the `invoices` table (customer data was saved), the form is permanently locked. The ✏️ Input button is disabled. The customer must contact Admin for any changes.
* **Save & Send Modal:** Bottom-sheet popup with email input + Send Email button grouped together, followed by a separate Send LINE button, and a Cancel button.
* **Font:** Thai **Sarabun** (Google Fonts) replaces Inter for better Thai character rendering on mobile.

#### Module 4: Customer-Facing APIs
* **`GET /lookup-branches` Logic (updated):**
  - **Required params:** `tax_rec_id` AND `tax_id` (both required).
  - **Check 1 — Tax Rec ID existence:** Queries `invoices` table. If `tax_rec_id` not found → `{ success: false, code: 'NO_RECORD', message: 'ไม่มีใบกำกับภาษีของหมายเลขนี้, ถ้าได้เข้ารับบริการแล้วโปรดรอครึ่งวันหรือติดต่อ Admin' }`.
  - **Check 2 — One-time lock:** If `is_customer_data_updated = TRUE` → `{ success: false, code: 'LOCKED', message: 'ไม่สามารถแก้ไขข้อมูลลูกค้าได้มากกว่า 1 ครั้ง โปรดติดต่อ admin' }`.
  - **Check 3 — Existing data check:** If invoice already has `tax_id` and `customer_num`, queries `customer_profile` by `customer_num` and returns existing profile data (form locked, ✏️ Input disabled).
  - **Check 4 — Branch lookup:** If invoice has no `tax_id`, queries `customer_profile` by `tax_id`. Returns branches array (may be empty — frontend treats empty array as trigger for manual entry mode).
* **`POST /update-profile` Logic (updated):**
  - **Lock check:** If `is_customer_data_updated = TRUE` → reject with Thai 1-time message.
  - **Profile validation:** Validates `tax_id` + `customer_branch` combo exists in `customer_profile`. Rejects if not found.
  - **On success:** Sets `is_customer_data_updated = TRUE` and `is_accounting_exported = FALSE` in `invoices` (invoice re-queued for accounting export). Also resets `is_accounting_exported = FALSE` on the matching `customer_profile` row (customer master data re-queued for export).
  - **Accepts additional fields:** `customer_name`, `customer_num` (for manual entry case).
* **`POST /save-and-send` Logic (new):**
  - **Combined endpoint** that handles: save customer data + optionally generate PDF on-the-fly + dispatch via email or LINE — in a single request.
  - **Lock check 1:** `is_customer_data_updated = TRUE` → reject (`DATA_LOCKED`).
  - **Lock check 2:** `status = 'ready'` → reject (`DATA_LOCKED`).
  - **Lock check 3:** `is_pdf_sent_from_richmenu = TRUE` → reject (`PDF_LOCKED`).
  - **TMP Number Generation:** If `customer_num` starts with `TMP-` (or is empty), the backend generates a timestamp-based unique number: `TMP-YYMMDDHHMMSS` (e.g., `TMP-260615182730`).
  - **Save to `invoices`:** Updates `tax_id`, `customer_branch`, `customer_num`, `container_num`, sets `is_customer_data_updated = TRUE` and `is_accounting_exported = FALSE`.
  - **Save to `customer_profile`:** Uses `INSERT ... ON DUPLICATE KEY UPDATE` to gracefully handle profiles. If the frontend sends an existing profile (e.g. `CUS-12345`) without edits, the backend simply re-links it and leaves its `is_accounting_exported` flag unchanged. If the frontend sends edited data (e.g., `TMP-260615182730`), it inserts a brand new profile record (with `is_accounting_exported = FALSE` as it is new). The `invoices.customer_num` column links to the exact profile used.
  - **Dual-flag meaning:** `invoices.is_accounting_exported` tracks invoice-level data export. `customer_profile.is_accounting_exported` tracks customer master data export. Both are reset independently and consumed independently.
  - **Immediate response:** Returns success + Thai confirmation message:
    - `send_method = 'save'`: `"ได้บันทึกรายการแล้ว"` — no PDF generation or dispatch.
    - `send_method = 'email'`: `"โปรดตรวจสอบอีเมล์ของคุณในอีก 1-2 นาที"`
    - `send_method = 'line'`: `"โปรดตรวจสอบไลน์ของคุณในอีก 1-2 นาที เพื่อรับ Link ในการดาวโหลด"`
  - **Background (async, skipped for `send_method = 'save'`):** Generates PDF via `pdfService`, sets `is_pdf_sent_from_richmenu = TRUE`, then dispatches via email (`sendInvoiceEmail`) or LINE push (`axios POST` to LINE Messaging API).
  - **LINE Flex Message:** Sends a branded card containing invoice number, company name, and a `"📄 เปิด/ดาวโหลด ใบกำกับภาษี (PDF)"` button. PDF URLs are dynamically resolved using request headers (`Referer` or `Origin` to capture the client's actual entry point), bypassing the hardcoded placeholder `BASE_URL` if it contains `your-domain.com`.
  - **Admin bypass:** These lock flags are only set/checked in customer-facing endpoints. Admin portal endpoints are unaffected.
  - **Join Key:** All queries joining `invoices` and `customer_profile` use `ON i.customer_num = p.customer_num` (not `tax_id + customer_branch`).
* **`GET /search-invoices` Logic (new):**
  - **Required params:** `tax_id`.
  - Queries `invoices` joined with `customer_profile` where `tax_id` matches and `created_at` is in the last 14 days. Returns list of eligible invoices.
* **`GET /check-invoice` Logic (new):**
  - **Required params:** `tax_rec_id` (supports comma-separated list) and `tax_id`.
  - Supports comma-separated `tax_rec_id`s. Queries all specified IDs, validates that each matches the `tax_id` and has customer data, splits them into `valid` and `excluded` arrays, and returns them.
  - **Invoice existence:** Checks if `tax_rec_id` exists. If not found, returns `404` with code `NO_RECORD` and message `"ไม่มีใบกำกับภาษีของหมายเลขนี้, ถ้าได้เข้ารับบริการแล้วโปรดรอครึ่งวันหรือติดต่อ Admin"`.
  - **Unlinked Invoice checks (Scenario 1 & 2):** If `invoices.tax_id` is empty:
    - If typed `tax_id` exists in `customer_profile`, returns `400` with code `UNLINKED_CUSTOMER_EXISTS` and message `"กรุณาเพิ่มข้อมูลลูกค้าใน invoice จากเมนู 'เพิ่มข้อมูลลูกค้า'"`.
    - If typed `tax_id` does NOT exist in `customer_profile`, returns `400` with code `UNLINKED_CUSTOMER_NEW` and message `"กรุณาสร้างลูกค้าใหม่ และ เพิ่มข้อมูลลูกค้าใน invoice จากเมนู 'เพิ่มข้อมูลลูกค้า'"`.
  - **Tax ID Match check:** If `invoices.tax_id` is set but does not match typed `tax_id`, returns `400` with code `TAX_ID_MISMATCH` and message `"หมายเลขประจำตัวผู้เสียภาษีไม่ตรงกับใบกำกับภาษีนี้"`.
  - **Profile completeness:** Checks that customer profile name/address are not empty. If they are, returns `400` with code `UNLINKED_CUSTOMER_EXISTS`.
  - **PDF state check:** Returns `200` with `pdf_state: 'ready'` if PDF exists (invoice status is 'ready' and has a row in `generated_documents`), otherwise returns `pdf_state: 'no_pdf'`.
* **`POST /request-invoice` Logic (updated):**
  - **Verification:** Runs the same validation logic as `/check-invoice`. Supports comma-separated `tax_rec_id`s.
  - **Delivery selection:** Accepts `send_method` (`'email'` or `'line'`) and `line_user_id` / `email_sending`.
  - **Immediate response & Background execution:**
    - If PDF already exists:
      - Returns success immediately with message `"โปรดตรวจสอบอีเมล์ของคุณในอีก 1-2 นาที"` (for email) or `"โปรดรอสักครู่ กำลังส่ง Link ให้คุณทางไลน์เพื่อดาวโหลด"` (for LINE).
      - Triggers email or LINE push dispatch in the background.
    - If PDF does NOT exist yet:
      - Returns success immediately with message `"โปรดตรวจสอบอีเมล์ของคุณในอีก 1-2 นาที"` (for email) or `"โปรดรอ 1-2 นาที เพื่อสร้างใบกำกับภาษีในรูปแบบ PDF และส่ง Link ให้คุณทางไลน์เพื่อดาวโหลด"` (for LINE).
      - Generates PDF on-the-fly, updates status/documents tables, and triggers email or LINE push dispatch in the background.

#### Module 5 & 6: PDF & Email Engine
* **PDF Storage:** Generated PDFs will be saved to `/storage/pdfs/FTR_[tax_rec_id].pdf`.
* **Email Content:** The system will dispatch the PDF with the following Thai content:
  - **Subject:** `ใบกำกับภาษีแบบเต็ม สำหรับเลขประจำตัวผู้เสียภาษี: <tax_id>`
  - **Body:** Lists all requested `tax_rec_id`s line-by-line. All PDFs are attached in a single email.

#### Module 7: Cron Batch Processing
* **Nightly Scan:** At 01:00 AM, the cron job selects all invoices where `status = 'pending'` (meaning PDF URL is blank) AND checks the completeness of `company_name`, `address`, and `tax_id` (ensure no blank fields).
* **Cron Email Dispatch:** The nightly cron job *only* generates the PDF and stores it. It does *not* send an email. Emails are strictly dispatched only when a customer actively requests it via the LIFF form (since they may use a different email address each time).

#### Module 8 & 9: Admin Web Portal
* **Access & Routing:** The root URL (e.g., `http://localhost:3000` or the live domain) redirects standard browser traffic directly to the Admin Dashboard (`/admin/dashboard.html`), which triggers a login check and redirects to `/admin/login.html` if the user is unauthenticated. Users do not need to manually type `/admin` or `/admin/login.html` to access the portal. For LINE OA users, the root router handles incoming LIFF queries (`?target=...`) and redirects them to the customer LIFF forms.
* **Auth-Ready Architecture:** The admin backend routes and UI endpoints will be cleanly grouped (e.g., under a `/admin/*` prefix). This guarantees that adding username/password authentication later will only require wrapping the prefix with a security middleware, completely avoiding any redesign of the internal logic.
* **Mobile-Responsive UI:** The entire admin web portal (CSV Upload/Download, Search & Edit, Activity Logs) is built with a responsive layout. Sizing boundaries on desktop (`max-width: calc(100% - 260px)` and `min-width: 0`) and mobile ensure content scales fluidly to fit the screen, with horizontal scrollbars (`overflow-x: auto`) automatically provided on tabular containers (`.table-responsive`) to navigate overflowing columns cleanly.
* **Activity Logs Viewer:** Displays a maximum of 500 recent records across 10 pages (50 records/page), ordered by newest first. Includes Search Filters for `Activity Name` (Dropdown) and `Date Range` (Calendar). Displays the `Username` of the administrator who performed each logged action. Uses backward (Prev) and forward (Next) navigation buttons and a middle dropdown page number selector. Includes an **Export Logs (CSV)** button which downloads the last N records (configurable via `EXPORT_LOGS_LIMIT` in `.env`, defaults to 200) as a pipe-delimited (`|`) CSV file.
* **CDMS CSV Upload & Customer Profile Preview:** After selecting a file, the UI provides a preview. For Customer Profiles, the UI filters and displays only target schema columns (`Tax ID`, `Customer Num`, `Customer Name`, `Customer Addr`, `Customer Email`, `Customer Phone`, `Customer Branch`), automatically filters out records without a Tax ID from the preview, and displays statistics of valid vs. skipped records so the admin knows exactly what will be imported before clicking confirm.
* **Accounting CSV Download:** The system strictly downloads records where `invoices.is_accounting_exported = FALSE`. Once downloaded, `invoices.is_accounting_exported` is set to `TRUE` for those invoice records. **Separately, `customer_profile.is_accounting_exported`** tracks whether the customer master profile has been exported — this flag is reset to `FALSE` whenever customer data is created or updated (via LIFF or Admin portal), ensuring that updated customer master data is always captured in the next export cycle. If a customer or Admin subsequently edits a profile, **both** flags reset to `FALSE` so the changes are captured in the next accounting export. Output includes: `tax_rec_id`, `customer_code`, `company_name`, `address`, `tax_id`.
* **Customer Profile CSV Exporter:** In the Customer Profile database webpage, admins can click the **Export Results to CSV** button to download all customer profiles matching the filter criteria that have not been exported yet (where `customer_profile.is_accounting_exported = FALSE` by default). Once exported, `is_accounting_exported` is set to `TRUE` for those profile records inside a database transaction. The exported CSV file utilizes the pipe-delimited (`|`) format, with a UTF-8 BOM prepended.
* **Customer Profile Database Webpage:** Allows searching the master `customer_profile` table by `tax_id`, `customer_num`, `customer_name`, and the new **Accounting Export Status** filter. Supports server-side pagination limited to 50 records per page, utilizing backward (Prev) and forward (Next) buttons and a middle dropdown page selector for navigation. Admins can edit fields, propagating changes to the `invoices` table.
* **Customer Search & Edit (Invoice Data):** Includes Search Filters for `tax_rec_id` (partial match, e.g., 'RF'), Customer Name, Address, Tax ID, Date Range, and Accounting Export Status. Includes a **Clear Search** button next to the search button to reset all filters and reload page 1 results. Supports server-side pagination limited to 50 records per page, utilizing backward (Prev) and forward (Next) buttons and a middle dropdown page selector for navigation. When the admin edits an invoice:
  - The edit requires that the specified `tax_id` and `customer_branch` already exist in the database (it does **not** auto-create customer profiles).
  - Saving the changes updates the matching profile's `company_name` and `address` in `customer_profile`, and resets `is_accounting_exported = FALSE` on the profile.
  - To prevent duplicate `TMP-` customer profile creation when multiple profiles exist for the same Tax ID + Branch combo (e.g. English vs Thai profiles), the PUT payload includes the selected `customer_num`. The backend prioritizes lookup by this specific `customer_num` so that comparison checks are performed against the user-selected profile rather than a random matching profile.
  - It also updates the invoice's `tax_id`, `customer_branch`, and `container_num`, resets the PDF status to `'pending'`, and resets `is_accounting_exported = FALSE` on the invoice.
  - When searching for multiple matching customer profiles/branches in the branch selector popup modal, the **Select** button is placed in the first column of the rows (front of the row) for enhanced UX.
  - PDF statuses are mapped to three visual stages:
    - **Incomplete** (red badge): Invoice status is `pending` and customer details (`customer_name`, `customer_addr`, `tax_id`) are missing.
    - **Pending** (yellow badge): Invoice status is `pending` and all customer details are populated.
    - **Ready** (green badge): Invoice status is `ready` (PDF is generated).
    - **Failed** (red badge): Invoice status is `failed` (generation failed).
* **Manage PDF:** Search filters matching Customer Search page. Includes a **Clear Search** button next to the search button to reset all filters and reload page 1. Supports server-side PDF status filtering and server-side pagination limited to 50 records per page, utilizing backward (Prev) and forward (Next) buttons and a middle dropdown page selector for navigation. Action buttons are styled with modern hover colors, custom SVG icons, CSS tooltips (`[data-tooltip]`), and dynamic disabled states depending on profile completeness and PDF readiness.
  - *PDF Status Dropdown:* Allows filtering specifically by `All PDF Statuses`, `Incomplete (no customer data)`, `Pending (pending gen.)`, `Ready (send/download)`, and `Failed Only`.
  - *Status Badge Mapping:* Dynamically displays `Incomplete`, `Pending`, `Ready`, or `Failed` status badges using the same completion criteria as the Invoice Data page.
  - *Generate PDF* (`POST /api/admin/customers/:tax_rec_id/generate-pdf`): Regenerates/overwrites PDF on-the-fly, updates `generated_at = CURRENT_TIMESTAMP`, and sets invoice status to `'ready'` in database. Disabled if profile is incomplete or PDF is already generated.
  - *Download PDF* (`GET /api/admin/customers/:tax_rec_id/download-pdf`): Streams file from local relative path using `res.download()`. Disabled if PDF is not ready.
  - *Send Email* (`POST /api/admin/customers/:tax_rec_id/send-email`): Dispatches generated PDF invoices to specified recipient emails natively using standard OAuth2 (Option A) or Gmail App Passwords (Option C) fallback. When clicked, the send email popup modal window is displayed with a solid dark background (`var(--bg-secondary)`) to match the portal dashboard style.
* **Customer Profile CSV Import Rules:**
  - **Duplicate Handling:** If a record with the same `tax_id` and `customer_branch` already exists, it is skipped (the existing database record is not updated/overwritten).
  - **Export Flag Default:** When customer profiles are uploaded via the CSV upload interface, their export status is set to `is_accounting_exported = TRUE` (do not export) since they represent already-existing system profiles.
  - **Result Messaging & Feedback:**
    - If zero new records are saved (i.e. all uploaded records are duplicates or invalid), the API responds with a `400` status and the message `"All records fail to save"`, along with the `skippedCount` and a `skippedTaxIds` list indicating why each was skipped.
    - If only some records are successfully saved and others are skipped as duplicates or invalid, the API responds with a `200` status and the message `"Can be saved some records"`, along with the `skippedCount` and `skippedTaxIds` list.
    - If all records are successfully saved, the API responds with a success status and the total import count.
    - The admin UI will display a multi-line alert listing the skipped Tax IDs and the reasons (e.g., "Duplicate", "Invalid Tax ID format").
  - **Branch Mapping:** Translates the branch type fields `ประเภทสาขา` and `สาขา` into the database representation:
    - If `ประเภทสาขา` is `"สำนักงานใหญ่"`, store `"สำนักงานใหญ่"`.
    - If `ประเภทสาขา` is `"สาขาย่อย"`, store the branch code from the `สาขา` column.
  - **Tax ID Validation & Skip Rules:**
    - Any row where `เลขประจำตัวผู้เสียภาษี` (Tax ID) is empty is automatically skipped from insertion.
    - The `tax_id` must be exactly 13 digits and numeric. Any row that does not meet this requirement (e.g., more or less than 13 digits, contains letters) is ignored and the import process continues to the next row without throwing a database error.
  - **Dynamic Delimiter & Encoding Detection:** Auto-detects `,` or `|` delimiter based on frequency counts. Checks UTF-8 validity using a strict decoder and falls back to `windows-874` decoding to guarantee uncorrupted Thai text rendering.


## 9. Appendix: Connecting a Webpage to LINE OA Rich Menus (Step-by-Step Guide)

This guide walks through the process of connecting a custom webpage to a LINE Official Account (OA) using Rich Menus and the LINE Front-end Framework (LIFF).

Because your webpage needs a LIFF ID, but the LIFF console needs your webpage URL, we use a standard 5-step workflow to solve this "chicken-and-egg" problem.

### Step 1: Gather Required Information
Before you begin, you need to set up your LINE developer environment.

#### Where to get this information:
1. **Go to the LINE Developers Console:** https://developers.line.biz/  
2. **Log in:** Use your LINE account credentials.  
3. **Create a Provider:** If you don't have one, create a "Provider" (think of this as your company or development team name).  
4. **Create Channels:** You will need two types of channels under your Provider:  
   * **Messaging API Channel:** This is your actual LINE Official Account.  
   * **LINE Login Channel:** This is required to use LIFF.

#### Information Checklist & Actions:
From your **Messaging API Channel** (Only needed if you build a backend server later):
* \[ \] **Channel Secret:**  
  * **Action:** Go to the "Basic settings" tab of your channel. Scroll down to find the "Channel secret" section.  
  * **Action:** Click the copy icon.  
  * **Important:** Keep this safe. **Never** put this directly into your frontend HTML/JS code.  
* \[ \] **Channel Access Token (Long-lived):**  
  * **Action:** Go to the "Messaging API" tab of your channel. Scroll to the bottom to the "Channel access token" section.  
  * **Action:** Click the **"Issue"** button, then copy it.  
  * **Important:** Like the secret, keep this secure. **Never** put this directly into your frontend HTML/JS code.

### Step 2: Initial LIFF Setup (Getting your IDs)
We need to create the LIFF app first to generate the LIFF ID (needed for your webpage code) and the LIFF URL (needed for your Rich Menu).

1. **Go to the LINE Developers Console:** https://developers.line.biz/  
2. **Select your Provider and your LINE Login Channel.**  
3. **Navigate to the "LIFF" tab.**  
4. **Click "Add" to create a new LIFF app.**  
5. **Configure LIFF App Settings:**  
   * **LIFF app name:** Name your app.  
   * **Size:** Choose how much of the screen the webpage should cover (Full, Tall, or Compact).  
   * **Endpoint URL:** **(Crucial Step)** Since your webpage isn't hosted yet, type in a placeholder URL like https://example.com. *We will change this in Step 4.*  
   * **Scopes:** Select profile (to get the user's name/picture) and openid (if you need user ID).  
   * **Bot link feature:** Choose "On (Normal)".  
6. **Save:** Click "Add".  
7. **Get your Keys:**  
   * Copy the **LIFF ID** (e.g., 1234567890-AbCdEfGh). You need this for Step 3.  
   * Copy the **LIFF URL** (e.g., https://liff.line.me/1234567890-AbCdEfGh). You need this for Step 5.

### Step 3: Create & Host the Webpage
Now you build the HTML/JS webpage using the LIFF ID you just generated.

1. **Copy this basic template:**

```html
<!DOCTYPE html>  
<html lang="en">  
<head>  
    <meta charset="UTF-8">  
    <meta name="viewport" content="width=device-width, initial-scale=1.0">  
    <title>My LIFF App</title>  
    <!-- Include the LIFF SDK -->  
    <script charset="utf-8" src="https://static.line-scdn.net/liff/edge/2/sdk.js"></script>  
    <style>  
        body { font-family: sans-serif; padding: 20px; text-align: center; }  
        #profile-pic { border-radius: 50%; width: 100px; height: 100px; display: none; margin: 0 auto; }  
    </style>  
</head>  
<body>  
    <h1>Welcome to Full Tax Request System</h1>

    <div id="loading">Loading...</div>  
      
    <div id="user-info" style="display:none;">  
        <img id="profile-pic" src="" alt="Profile Picture">  
        <h2 id="display-name"></h2>  
        <p>User ID: <span id="user-id"></span></p>  
    </div>

    <script>  
        // REPLACE THIS WITH YOUR LIFF ID FROM STEP 2  
        const myLiffId = "YOUR_LIFF_ID_HERE";

        async function initializeLiff() {  
            try {  
                await liff.init({ liffId: myLiffId });  
                if (liff.isLoggedIn()) {  
                    getUserProfile();  
                } else {  
                    liff.login();   
                }  
            } catch (err) {  
                console.error("LIFF Initialization failed:", err);  
                document.getElementById("loading").innerText = "Error loading app.";  
            }  
        }  
        async function getUserProfile() {  
            try {  
                const profile = await liff.getProfile();  
                  
                document.getElementById("loading").style.display = "none";  
                document.getElementById("user-info").style.display = "block";  
                document.getElementById("display-name").innerText = profile.displayName;  
                document.getElementById("user-id").innerText = profile.userId;  
                  
                if(profile.pictureUrl) {  
                     const pic = document.getElementById("profile-pic");  
                     pic.src = profile.pictureUrl;  
                     pic.style.display = "block";  
                }  
            } catch (err) {  
                console.error("Error getting profile:", err);  
            }  
        }

        window.onload = function() {  
            initializeLiff();  
        };  
    </script>  
</body>  
</html>
```

2. **Paste your LIFF ID:** Find `const myLiffId = "YOUR_LIFF_ID_HERE";` in the code and replace it with the ID from Step 2.  
3. **Host your webpage:** Upload this HTML file to a secure hosting service (it **must** be an HTTPS server, like GitHub Pages, Vercel, Netlify, or your own server).  
4. **Copy the real URL:** Once hosted, copy the actual web address of your page (e.g., https://my-cool-project.vercel.app/index.html).

### Step 4: Update LIFF Endpoint URL
Now that your webpage is live, we need to tell LINE where it actually is.

1. Go back to the **LINE Developers Console** > Your Provider > LINE Login Channel > **LIFF tab**.  
2. Click on your LIFF app to edit it.  
3. Find the **Endpoint URL** (where you put https://example.com earlier).  
4. Replace it with the **real, hosted URL** from Step 3.  
5. Save your changes.

### Step 5: Create the LINE Rich Menu
Finally, you connect the Rich Menu button to the LIFF App.

1. **Log in to the LINE Official Account Manager:** https://manager.line.biz/  
2. **Select your account.**  
3. **Navigate to "Rich menus":** Under "Home" > "Chat room menus" on the left sidebar.  
4. **Click "Create a rich menu".**  
5. **Configure Settings:** Set Title, Display period, and Menu bar text.  
6. **Design the Menu:** Select a layout template and upload a matching image.  
7. **Define Actions (Crucial Step):**  
   * Click on the "Action" area (A, B, C) where you want your webpage button to be.  
   * Set the **Type** to **"Link"** (or URI).  
   * **URL:** *Paste the **LIFF URL** you copied in Step 2 here (it should look like https://liff.line.me/...). Do NOT paste your actual website URL here.*  
8. **Save and Publish:** Click "Save".

Open your LINE app, go to your Official Account, tap the Rich Menu, and watch your webpage load perfectly!

---

## 10. Implementation Plan

### Current State (Baseline Audit)
The following components are already scaffolded and partially implemented:

| Component | Status | Notes |
|---|---|---|
| `src/db.js` | ✅ Done | MySQL connection pool with dotenv |
| `src/logger.js` | ✅ Done | `logActivity()` with local-timezone formatting |
| `src/index.js` | ✅ Done | Express server, CORS, static file serving |
| `src/api/customer.js` | ✅ Done | `/update-profile` and `/request-invoice` routes with full business logic |
| `public/liff/missing-info.html` | ✅ Done | LIFF form for adding missing info |
| `public/liff/request-invoice.html` | ✅ Done | LIFF form for requesting full tax invoice |
| `public/liff/style.css` | ✅ Done | Base LIFF stylesheet |
| Database DDL | ✅ Done | Schema defined in §7.2 |
| PDF Engine | ❌ TODO | Puppeteer integration stubbed (Module 5) |
| Email Engine | ❌ TODO | Nodemailer integration stubbed (Module 6) |
| Cron Job | ❌ TODO | Nightly batch not yet built (Module 7) |
| Admin Portal | ❌ TODO | All 4 admin pages not yet built (Modules 8–9) |
| Admin Authentication | ❌ TODO | Session/JWT middleware not yet built |

---

### Phase 1 — Install Dependencies & Database Setup
**Goal:** Get the full stack running locally with the correct database schema.

**Tasks:**
1. **Install missing npm packages:**
   - `puppeteer` — PDF generation engine
   - `nodemailer` — Email dispatch
   - `node-cron` — Nightly scheduler
   - `multer` — CSV file upload handling
   - `csv-parse` — CSV parsing
   - `bcrypt` — Admin password hashing
   - `express-session` — Admin session management
   - Add a `start` script to `package.json`

2. **Create storage directory:**
   - Create `/storage/pdfs/` directory (gitignored) for generated PDF files

3. **Run DDL scripts:**
   - Execute the SQL from §7.2 against the target MySQL database
   - Seed at least one admin user (hashed password) into `admin_users`

4. **Update `.env`:**
   - Add `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SESSION_SECRET` variables
   - Update `.env.example` to match

**Deliverables:** `npm start` runs without errors; DB tables exist; health check endpoint responds.

---

### Phase 2 — Line and Webpages Connection Testing
**Goal:** Verify the end-to-end connection between the Line Rich Menu, LIFF application, and the web forms before building complex backend features.

**Tasks:**
1. **Host LIFF Pages Temporarily:**
   - Use a tunneling service (like `ngrok`) to expose the local development server (port 3000) to the internet with an HTTPS URL.
2. **Configure LINE Developers Console:**
   - Create two LIFF apps (one for Missing Info, one for Request Invoice).
   - Set the Endpoint URLs to the `ngrok` HTTPS URL + `/liff/missing-info.html` and `/liff/request-invoice.html`.
3. **Update HTML Files:**
   - Update `public/liff/missing-info.html` and `public/liff/request-invoice.html` with their respective LIFF IDs from the LINE console.
4. **Configure LINE Official Account:**
   - Create a Rich Menu in the LINE Official Account Manager.
   - Link the Rich Menu buttons to the LIFF URLs.
5. **End-to-End Test:**
   - Open the LINE app, tap the Rich Menu, and verify both LIFF forms open correctly, fetch the user profile (displayName/userId), and display them on the page.

**Deliverables:** Both LIFF forms can be opened from the LINE Official Account Rich Menu, and the LINE user profile is successfully loaded in the forms.

---

### Phase 3 — PDF Engine (Module 5)
**Goal:** Replace the mock PDF stub in `customer.js` with real Puppeteer-based PDF generation.

**Tasks:**
1. **Create `src/services/pdfService.js`:**
   - `generatePdf(taxRecId)` function — fetches the invoice header and line items.
   - **Dynamic Pagination**: Splitting items list and BKG/CNTR lines to guarantee page compliance (maximum 9 rows per page).
     - If both Booking No. and Container No. exist, they are treated as a paired block (takes exactly 2 rows) and are kept together on the last page.
     - Single-page invoices with BKG/CNTR can fit at most 7 items.
     - Multi-page invoices can fit up to 9 items on non-last pages (no BKG/CNTR), and up to 7 items + BKG & CNTR lines on the last page.
     - Non-final pages leave summary total fields blank and display `( อ่านต่อหน้าถัดไป / Continued on Next Page )` in the Baht text cell.
     - Final page displays the actual sum calculations and Baht text.
   - Extracts the page structure from `invoice.html` and renders pages sequentially, adding page number metadata (`{{pageNumber}}` e.g., `1 / 2`).
   - Uses Puppeteer (with `waitUntil: 'domcontentloaded'` to prevent font timeouts) to render the HTML invoice template to PDF.
   - Saves output to `/storage/pdfs/FTR_[tax_rec_id].pdf`.
   - Returns the saved file path.

2. **Create `src/templates/invoice.html`:**
   - Full Tax Invoice HTML template matching the `full_tax_invoice.jpg` reference image.
   - Page containers styled with `@media print { page-break-after: always; }` to support clean page rendering.
   - **Customer Address Clamping**: CSS webkit-line-clamp applied to `.customer-addr` to truncate addresses to exactly 5 lines (with ellipsis `...`) to guarantee layout height stability.
   - Specific summary row borders (under Gross, Discount, After Discount, Deposit, After Deposit) are removed from both text and value columns to match client aesthetic guidelines.

3. **Wire up `pdfService` in `src/api/customer.js`:**
   - Replace the `// TODO: Call PDF Generation service (Module 5)` stubs
   - After generation, insert a row into `generated_documents` and update `invoices.status = 'ready'`

**Deliverables:** Calling `/api/customer/request-invoice` for a complete record with no PDF produces a real PDF file on disk and logs `ONTHEFLY_GEN_PDF`.

---

### Phase 4 — Email Engine (Module 6)
**Goal:** Replace the email stub with real Nodemailer dispatch.

**Tasks:**
1. **Create `src/services/emailService.js`:**
   - `sendInvoiceEmail(emailSending, taxRecId, taxId, pdfPath)` function
   - Connects via SMTP (credentials from `.env`)
   - Email subject/body as defined in §8 (Module 5 & 6) — Thai language
   - Attaches PDF from local path
   - Returns success/failure boolean

2. **Wire up `emailService` in `src/api/customer.js`:**
   - Replace both `// TODO: Call email service (Module 6)` stubs (on-the-fly path and existing-PDF path)
   - Ensure `SENDING_EMAIL` is logged only after successful dispatch

**Deliverables:** End-to-end flow — customer submits LIFF form → PDF generated (or retrieved) → email arrives at the specified address with PDF attached.

---

### Phase 5 — Cron Batch Job (Module 7)
**Goal:** Implement the nightly 01:00 AM PDF generation batch.

**Tasks:**
1. **Create `src/services/cronService.js`:**
   - Uses `node-cron` to schedule a job at `0 1 * * *` (01:00 AM)
   - Queries `invoices` for records where `status = 'pending'` AND `company_name IS NOT NULL` AND `address IS NOT NULL` AND `tax_id IS NOT NULL`
   - Iterates each record, calls `pdfService.generatePdf(record)`
   - Inserts into `generated_documents`, updates `invoices.status = 'ready'`
   - After all records, logs `CRON_GEN_PDF` with the count
   - Does **not** send emails (as per §8 Module 7)

2. **Register cron in `src/index.js`:**
   - `require('./services/cronService')` so the cron starts with the server

**Deliverables:** At 01:00 AM, all eligible pending records are converted to PDFs; a single `CRON_GEN_PDF` log entry records the count.

**Run script from cronjob:** cd /www/wwwroot/your-project-folder && node src/cron_batch.js
---

### Phase 6 — Admin Authentication Middleware (Module 8)
**Goal:** Implement secure username/password login for the admin portal.

**Tasks:**
1. **Create `src/middleware/authMiddleware.js`:**
   - `requireAuth` middleware — checks `req.session.adminUser`; returns 401 if not authenticated
   - Applied to all `/admin/*` routes except `/admin/login`

2. **Create `src/api/admin/auth.js`:**
   - `POST /admin/login` — validates credentials against `admin_users` table using `bcrypt.compare()`; sets `req.session.adminUser` on success
   - `POST /admin/logout` — destroys session

3. **Create `public/admin/login.html`:**
   - Clean login page (username + password form)
   - On success, redirects to admin dashboard
   - Handles invalid credential error display

4. **Register session middleware in `src/index.js`:**
   - `express-session` with `SESSION_SECRET` from `.env`
   - Mount admin auth routes under `/admin`

**Deliverables:** All `/admin/*` routes redirect to `/admin/login.html` when unauthenticated. Valid credentials create a session and grant access.

---

### Phase 7 — Admin Portal: CSV Upload & Download (Module 8)
**Goal:** Build the CDMS inbound CSV upload and accounting outbound CSV download pages.

**Tasks:**
1. **Create `src/api/admin/upload.js`:**
   - `POST /admin/upload-cdms` (protected) — accepts multipart file via `multer`
   - Validates required CSV columns (reject + descriptive error if missing)
   - Checks for internal duplicates within the file and against existing DB records (reject on duplicates)
   - Inserts valid rows into `invoices` table
   - Logs `REQ_UPLOAD_CDMS` with `username:no_of_upload_rec`

2. **Create `public/admin/upload.html`:**
   - File picker (CSV only)
   - After file selected, show a preview table of parsed CSV rows before submission
   - Submit button finalises the upload
   - Displays success/error messages inline

3. **Create `src/api/admin/download.js`:**
   - `GET /admin/download-missing` (protected) — queries records where `is_accounting_exported = FALSE`
   - Validates dataset structure before streaming
   - Streams CSV response with columns: `tax_rec_id`, `customer_code`, `company_name`, `address`, `tax_id`
   - After streaming, updates `is_accounting_exported = TRUE` for all exported rows
   - Logs `REQ_DOWNLOAD_MISS` with `username:no_of_download_rec`

4. **Create `public/admin/download.html`:**
   - Simple button to trigger download
   - Shows record count available for export before download

**Deliverables:** Admin can upload a CDMS CSV (with preview and validation) and download the accounting CSV (marking records as exported).

**Delimeter:** The CSV delimeter is "|" character.

**Mapping CDMS data in CSV file**
CDMS file column = DB column
InvoiceNo = tac_rec_id
InvoiceDate = service_date
customer name (update from Line) = customer
customer address (update from Line) = customer_addr 
tax id (update from Line) = tax_id 
PartNumber + PartName = part_desc 
Price = price
Qty = unit_num
Amount = amount

---

### Phase 8 — Admin Portal: Customer Search & Edit (Module 8)
**Goal:** Build the customer profile search and edit interface.

**Tasks:**
1. **Create `src/api/admin/customers.js`:**
   - `GET /admin/customers/search` (protected) — accepts query params: `tax_rec_id` (partial match), `customer_code`, `company_name`, `tax_id`, `date_from`, `date_to`
   - `PUT /admin/customers/:tax_rec_id` (protected) — updates only `company_name`, `address`, `tax_id` and resets `is_accounting_exported = FALSE`

2. **Create `public/admin/customers.html`:**
   - Search filters: `tax_rec_id` (partial/prefix), Date Range
   - Results table showing key invoice fields
   - Click-to-edit row — opens an edit modal/inline form for `company_name`, `address`, `tax_id` only
   - Save triggers the `PUT` endpoint; success refreshes the row

**Deliverables:** Admin can search for any customer record and correct their `company_name`, `address`, or `tax_id`.

---

### Phase 9 — Admin Portal: Activity Logs Viewer (Module 8)
**Goal:** Build the activity log viewer with pagination, filtering, auditing, and export features.

**Tasks:**
1. **Create `src/api/admin/logs.js`:**
   - `GET /api/admin/logs` (protected) — accepts query params: `action` (filter), `date_from`, `date_to`, `page` (default 1).
   - Returns paginated results: 50 records/page, max 500 total, ordered by `log_id DESC`. Includes the login administrator's `username` for each log row.
   - `GET /api/admin/logs/export` (protected) — exports the last N activity logs (where N is configurable via the `EXPORT_LOGS_LIMIT` environment variable, defaulting to 200) as a pipe-delimited (`|`) CSV format, prepended with a UTF-8 BOM for Excel compatibility.

2. **Create `public/admin/logs.html`:**
   - Filter controls: `Activity Name` dropdown (the 8 action types) + Date Range calendar.
   - Table displaying: `log_id`, `action`, `datetime`, `username` (new), `values`.
   - Export button: An "Export Logs (CSV)" button that triggers the export API endpoint.
   - Pagination controls (previous/next, page indicator).

**Deliverables:** Admin can browse, filter, and export all system activity logs with pagination and admin username auditing.

---

### Phase 10 — Admin Portal: Layout & Navigation Shell
**Goal:** Unify all admin pages under a shared navigation layout.

**Tasks:**
1. **Create `public/admin/admin.css`:**
   - Responsive layout (Flexbox sidebar + main content)
   - Mobile-friendly (CSS Media Queries for screens < 768px)
   - Consistent typography, color palette, button/input styles

2. **Create `public/admin/admin.js`:**
   - Shared JS: session check on page load (redirect to login if 401), logout handler, active nav link highlight

3. **Update all admin HTML pages** (`upload.html`, `download.html`, `customers.html`, `logs.html`):
   - Include the shared navigation sidebar/header
   - Link `admin.css` and `admin.js`

4. **Create `public/admin/dashboard.html`:**
   - Landing page after login with quick-action cards linking to each section

**Deliverables:** A cohesive, mobile-responsive admin portal with consistent navigation across all pages.

---

### Phase 11 — LIFF Polish & E2E Testing (System Tests)
**Goal:** Harden the LIFF forms and validate the complete customer journey, including backend services.

**Tasks:**
1. **Polish `public/liff/missing-info.html`:**
   - Verify profile-check-on-load logic (disable form if data already exists)
   - Improve UX: loading spinner, clear success/error states, disable submit button during request
   - Thai-language UI copy

2. **Polish `public/liff/request-invoice.html`:**
   - Handle all 4 response states with appropriate UI messages (Thai language)
   - Email field validation (basic format check)
   - Loading/submission state handling

3. **End-to-end test scenarios:**
   - New customer (no CDMS data) → "Data not ready" message
   - Customer with CDMS data but no profile → prompted to fill missing info
   - Customer completes profile → on-the-fly PDF → email received
   - Customer re-requests existing invoice → immediate email dispatch
   - Nightly cron fires → pending records become PDFs
   - Admin upload flow (valid CSV, duplicate rejection, missing column rejection)
   - Admin download flow (correct records, flag resets on edit)
   - Admin search, edit, and log viewer

**Deliverables:** All user flows validated; LIFF forms are polished and production-ready.

---

### Phase 12 — Production Hardening
**Goal:** Prepare the system for deployment.

**Tasks:**
1. **Security:**
   - Set `httpOnly: true`, `secure: true`, `sameSite: 'strict'` on session cookie
   - Rate-limit `/api/customer/*` endpoints (e.g., 10 req/min per IP via `express-rate-limit`)
   - Validate and sanitize all inputs (prevent SQL injection via parameterized queries — already done; review for XSS in admin pages)

2. **Error handling:**
   - Global Express error handler middleware
   - Graceful handling of Puppeteer crashes (mark `invoices.status = 'failed'`, log error)
   - SMTP failure handling (retry once; log failure)

3. **Process management:**
   - Add `pm2` or equivalent process manager config
   - Add `start` script to `package.json`: `"start": "node src/index.js"`
   - Add `dev` script: `"dev": "nodemon src/index.js"`

4. **Documentation:**
   - Update `README.txt` with setup instructions, env variables reference, and how to seed the first admin user

**Deliverables:** System is stable, secure, and documented for handover/deployment.

---

### Phase Summary Table

| Phase | Focus | Key Output |
|---|---|---|
| **1** | Dependencies & DB Setup | Server runs; DB tables created |
| **2** | Line and Webpages Connection Testing | End-to-end connection verified |
| **3** | PDF Engine | Real PDFs generated on-the-fly |
| **4** | Email Engine | Invoices delivered to customer email |
| **5** | Cron Batch Job | Nightly PDF pre-generation |
| **6** | Admin Authentication | Secure login/logout session |
| **7** | Admin CSV Upload & Download | CDMS ingest + accounting export |
| **8** | Admin Customer Search & Edit | Profile correction by admin |
| **9** | Admin Activity Logs Viewer | Full audit trail visible |
| **10** | Admin Layout & Navigation | Unified, responsive admin portal |
| **11** | LIFF Polish & E2E Testing (System Tests) | Production-ready customer flows |
| **12** | Production Hardening | Secure, stable, documented deployment |


---

## 11. Testing LINE LIFF & Rich Menus Safely on a Live LINE OA

This guide outlines how to expose your local development environment using **LocalTunnel** or **ngrok.com** and safely test a custom Rich Menu on a live LINE Official Account (OA) without displaying it to actual customers. This is achieved by creating and assigning the menu exclusively to your test User ID(s) via the **LINE Messaging API**.

### 

### **Architecture Overview**

graph TD  
    LocalHost\[Local Web Application \- Port 3000\]   
            	\<--\>|1. Expose| LT\[LocalTunnel HTTPS URL\]  
    LT 	\<--\>|2. Register| LIFF\[LINE LIFF App\]  
    LIFF 	\<--\>|3. Call| RichMenu\[Hidden Rich Menu\]  
    RichMenu 	\<--\>|4. Assign via API| Tester\[Your Specific LINE User ID Only\]

### 

### **Phase 1: Expose Your Local Server with LocalTunnel**

Since LINE requires secure HTTPS endpoints, you need to tunnel your local port to a public HTTPS URL.

#### **1\. Run your local app**

Make sure your web server is running on your machine (e.g., http://localhost:3000).

#### 

#### **2\. Create Tunnel**

##### **2.1 Start LocalTunnel**

Install LocalTunnel globally and start a tunnel to your port:

\## Install globally (if you haven't already)  
npm install \-g localtunnel

\## Start tunnel (replace 3000 with your local port)  
lt \--port 3000

* Save the generated HTTPS URL (e.g., https://xxxx.localtunnel.me). This is your **Endpoint URL**.

##### **2.2 Using ngrok**

1. Create ngrok account from ngrok.com
2. Download a standalone executable with zero run time dependencies from ngrok.com and run
	ngrok.exe

3. From ngrok command line, run the following command to add your authtoken to the default ngrok.yml. from website
	ngrok config add-authtoken 33oCWicsmMSTRlHFfMq1GeOWBU6_81rcA4SqNydBBRmStriPM

4. Deploy our web application from port 3000
5. Start the ngrok agent with port 3000
	ngrok http 3000

6. Click link: "https://cythia-nonformal-undefeatedly.ngrok-free.dev", it will redirect to our web application from port 3000


#### 

#### **3\. Setup LIFF in LINE Developers Console**

1. Go to your [LINE Developers Console](https://developers.line.biz/).

2. Navigate to your **LINE Login Channel** ![][image1] **LIFF** tab.

3. Edit or Add a LIFF app.

4. Set the **Endpoint URL** to your LocalTunnel URL (e.g., https://xxxx.localtunnel.me).

    https://cythia-nonformal-undefeatedly.ngrok-free.dev/liff/missing-info.html
    https://cythia-nonformal-undefeatedly.ngrok-free.dev/liff/request-invoice.html
    https://nondeluding-kaiden-epenthetic.ngrok-free.dev

    https://ftr.uniconwebapp.com/

5. Copy the generated **LIFF URL** (https://liff.line.me/YOUR-LIFF-ID).

### 

### **Phase 2: Create and Limit the Rich Menu via Messaging API**

Instead of publishing the Rich Menu to the public via the LINE OA Manager UI, you will create it via API and bind it *only* to yourself.

#### **Prerequisites**

You need the following credentials from the **LINE Developers Console**:

* CHANNEL\_ACCESS\_TOKEN (Found in **Messaging API** tab)

* YOUR\_USER\_ID (Your personal LINE User ID, found at the bottom of the **Messaging API** or **LINE Login** tab)

#### **Step 1: Create the Rich Menu (Draft State)**

Submit the structure of your Rich Menu to LINE. This creates the menu in their database, but does not display it to anyone yet.

* **HTTP Method:** POST

* **Endpoint:** https://api.line.me/v2/bot/richmenu

* **Headers:**  
  Authorization: Bearer \<CHANNEL\_ACCESS\_TOKEN\>  
  Content-Type: application/json

##### **Request Payload (JSON)**

Replace the template with your configuration. Set your LIFF URL as the action for your active area.

{  
  "size": {  
    "width": 2500,  
    "height": 1686  
  },  
  "selected": false,  
  "name": "Local Test Rich Menu",  
  "chatBarText": "Tap to Open",  
  "areas": \[  
    {  
      "bounds": {  
        "x": 0,  
        "y": 0,  
        "width": 2500,  
        "height": 1686  
      },  
      "action": {  
        "type": "uri",  
        "label": "Open Local LIFF App",  
        "uri": "https://liff.line.me/YOUR-LIFF-ID"  
      }  
    }  
  \]  
}

* **Response:** You will receive a JSON payload containing the richMenuId:  
  {  
    "richMenuId": "richmenu-xxxxxxxxxxxxxxxxxxxxxxxx"  
  }

  *Keep this richMenuId handy for the next steps.*

#### **Step 2: Upload the Rich Menu Background Image**

You must upload a JPG or PNG background matching the dimensions defined in your JSON configuration (e.g., ![][image2] pixels).

* **HTTP Method:** POST

* **Endpoint:** https://api-data.line.me/v2/bot/richmenu/{richMenuId}/content

* **Headers:**  
  	Authorization: Bearer \<CHANNEL\_ACCESS\_TOKEN\>  
  	Content-Type: image/png  \# Or image/jpeg

* **Body:** Select binary inside your API client (like Postman or Insomnia) and choose your image file.

##### 

##### **Curl Example:**

curl \-v \-X POST https://api-data.line.me/v2/bot/richmenu/YOUR\_RICH\_MENU\_ID/content \\  
\-H "Authorization: Bearer YOUR\_CHANNEL\_ACCESS\_TOKEN" \\  
\-H "Content-Type: image/png" \\  
\--data-binary @/path/to/your/image.png

#### **Step 3: Link the Rich Menu Exclusively to You**

Now, map the hidden menu to your personal User ID. Once linked, you will see it immediately on your phone, while public customers will still see your default production menu.

* **HTTP Method:** POST

* **Endpoint:** https://api.line.me/v2/bot/user/{userId}/richmenu/{richMenuId}

* **Headers:**  
  	Authorization: Bearer \<CHANNEL\_ACCESS\_TOKEN\>  
  	Content-Length: 0

##### **Curl Example:**

curl \-v \-X POST https://api.line.me/v2/bot/user/YOUR\_USER\_ID/richmenu/YOUR\_RICH\_MENU\_ID \\  
\-H "Authorization: Bearer YOUR\_CHANNEL\_ACCESS\_TOKEN" \\  
\-H "Content-Length: 0"

**Success:** Open your LINE app and go to your OA chat. Your test Rich Menu will instantly load for you.

### **Phase 3: Promoting Your Rich Menu to All Customers (Go-Live)**

When your local tests are complete and the server goes live, you can promote this identical Rich Menu asset (using the same {richMenuId}) to **all** of your customers.

#### **Step 1: Point your LIFF App to your Production Domain**

Before releasing to the public, switch the **Endpoint URL** in your LINE Developers Console (under your LIFF configuration) from your LocalTunnel URL (e.g., https://xxxx.localtunnel.me) to your **live production HTTPS server URL** (e.g., https://yourdomain.com).

* *Note: Because your Rich Menu targets your LIFF ID (https://liff.line.me/YOUR-LIFF-ID), you do NOT need to create a new Rich Menu. LINE will dynamically point users to your production domain\!*

#### 

#### **Step 2: Set the Rich Menu as the Default for Everyone**

Make this specific Rich Menu live as the global default for your LINE OA.

* **HTTP Method:** POST

* **Endpoint:** https://api.line.me/v2/bot/user/all/richmenu/{richMenuId}

* **Headers:**  
  Authorization: Bearer \<CHANNEL\_ACCESS\_TOKEN\>  
  Content-Length: 0

##### **Curl Example:**

curl \-v \-X POST https://api.line.me/v2/bot/user/all/richmenu/YOUR\_RICH\_MENU\_ID \\  
\-H "Authorization: Bearer YOUR\_CHANNEL\_ACCESS\_TOKEN" \\  
\-H "Content-Length: 0"

Once executed successfully, **all followers** will see this menu when they open the chat.

### 

### **Phase 4: Cleaning Up / Resetting Your Account**

Because LINE assigns display priorities, it is critical to unlink your custom personal link after promoting the menu.

#### **Why you MUST Unlink your Personal ID:**

LINE uses this priority system:

1. **Per-user Rich Menu** (Your explicit test link) — *Highest Priority*

2. **Default Rich Menu** (All users)

3. **LINE OA Manager Default** — *Lowest Priority*

If you do not perform **Option A** below, you will remain locked to your original test link. If you ever update the default global menu in the future, you will **not** see the updates because your per-user test link is overriding them.

#### 

#### **Option A: Unlink the Rich Menu from Your User ID (Highly Recommended)**

Removes your personal override, matching your view to what your customers see (the global default).

* **HTTP Method:** DELETE

* **Endpoint:** https://api.line.me/v2/bot/user/{userId}/richmenu

* **Curl Example:**  
  curl \-v \-X DELETE https://api.line.me/v2/bot/user/YOUR\_USER\_ID/richmenu \\  
  \-H "Authorization: Bearer YOUR\_CHANNEL\_ACCESS\_TOKEN"

#### 

#### **Option B: Delete the Test Rich Menu Completely (Only if abandoning the menu)**

Only do this if you decide to build a completely new menu from scratch and want to destroy the current draft.

* **HTTP Method:** DELETE

* **Endpoint:** https://api.line.me/v2/bot/richmenu/{richMenuId}

* **Curl Example:**  
  curl \-v \-X DELETE https://api.line.me/v2/bot/richmenu/YOUR\_RICH\_MENU\_ID \\  
  \-H "Authorization: Bearer YOUR\_CHANNEL\_ACCESS\_TOKEN"  


