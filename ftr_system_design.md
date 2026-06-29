# System Design Document: FTR Invoice System Changes (REQ#01 - REQ#04)

This document specifies the system architecture, design decisions, and implementation details for the updates made to the FTR full tax invoice LIFF apps, email dispatch system, admin portals, and backend APIs.

---

## 1. Database Schema & Reversions (REQ#01 & REQ#02)

### 1.1 `invoices.created_at` Timestamp
* **Requirement:** Revert insertion query adjustments to keep the record creation datetime automatically controlled by the database.
* **Specification:** All SQL `INSERT INTO invoices` queries omit setting `created_at` explicitly, allowing it to default to `CURRENT_TIMESTAMP` at the MySQL database level.

### 1.2 `invoices.service_date`
* **Requirement:** Parse the service date from the 4th column of imported invoice data and show it on the screens.
* **Specification:** 
  * Format: `DD/MM/YYYY`.
  * Saved to the `service_date` field in the database during invoice imports.
  * Rendered as the "Service Date" column on the admin web portal grids instead of record creation datetime.

---

## 2. Adding Customer Data Rich Menu (REQ#03)

### 2.1 Multi-Invoice Input & Validation Flow
* **Page:** `public/liff/missing-info.html`
* **Inputs:** Accepts multiple `tax_rec_id`s separated by commas (e.g. `RF2606-0001, RF2606-0002`).
* **Validation Partition Rules:**
  * When looking up invoices, the system queries the database and partitions the entered IDs into four categories using priority conditions (1. Expiration > 7 days, 2. Date diff among unlinked ones, 3. Tax ID link status):
    1. **`tax_rec_id_7days` (Expired):** Any invoice older than 7 days (based on `service_date`), whether linked or unlinked (Condition 1).
    2. **`tax_rec_id_diffdate` (Mismatched Service Date):** Unlinked unexpired invoices if there is a date mismatch among the unlinked invoices (Condition 2).
    3. **`tax_rec_id_proceed` (Valid & Unlinked):** Invoices that have no `tax_id` linked, are <= 7 days, and share the same service date (Condition 3).
    4. **`tax_rec_id_hastaxid` (Valid & Linked):** Invoices that already have a `tax_id` linked, are <= 7 days.
  * **Split Confirmation Dialog:** If at least one unlinked invoice is entered:
    * Displays a custom confirmation modal window with line-separated status updates:
      * `<tax_rec_id_7days> ใบกำกับภาษีนี้ขอเกินกำหนด 7 วัน กรุณาติดต่อแอดมิน` (only if any expired)
      * `<tax_rec_id_diffdate> ใบกำกับภาษีนี้มีวันที่ให้บริการต่างกัน โปรดใส่เฉพาะหมายเลขที่มีวันที่ให้บริการเดียวกันเท่านั้น` (only if any service date mismatch among unlinked ones)
      * `<tax_rec_id_proceed> สามารถเพิ่มข้อมูลได้` (only if any proceedable)
      * `ใบกำกับภาษีที่เหลือมีข้อมูลแล้ว` (only if any already linked)
    * If cancelled, or if `tax_rec_id_proceed` is empty, or if `tax_rec_id_diffdate.length > 0`, the operation is aborted and values are cleared.
    * If OK, updates the `taxRecId` field value to contain only `tax_rec_id_proceed`, enables the Tax ID and customer profile entry, activates **Save**, **Save & Send**, and **Cancel** buttons, and disables **Send**.
  * **All-Linked Expiration Dialog:** If all entered invoices already have a Tax ID, but some are older than 7 days, alerts the user with:
    * `"<tax_rec_id_7days> ใบกำกับภาษีนี้ขอเกินกำหนด 7 วัน กรุณาติดต่อแอดมิน"`
    * Resets the screen and places focus back.
  * **Different Customer Validation:** If unexpired linked invoices belong to different client profiles (mismatched `customer_num`), alerts:
    * `"ใบกำกับภาษีบางหมายเลขเป็นคนละลูกค้า โปรดใส่เฉพาะหมายเลขที่มาจากลูกค้าเดียวกันเท่านั้น"`
    * Resets the form.

### 2.2 Action Bar & Save Warnings
* **Send (ส่ง) Button:** A new button added to the LIFF action bar.
  * **Enabled:** Only when all entered invoices already have a linked Tax ID, are within the 7-day limit, and belong to the same customer profile. (Used to dispatch PDFs without modifying database profile links).
  * **Disabled/Greyed-out:** When manual entry is activated or when editing profile details.
* **3-Day manual limit warning:** When saving multiple invoices, clicking Save or Save & Send triggers:
  * `"โปรดตรวจสอบความถูกต้องก่อนกดบันทึกข้อมูล สามารถขอแก้ไขได้ภายใน 3 วันโดยมีค่าใช้จ่ายกรุณาติดต่อแอดมิน"`
* **Card Footer Warning:** Displays the static text:
  * `"สามารถขอใบกำกับภาษีได้ภายใน 7 วัน จากวันเข้ารับบริการ"`

### 2.3 Backend Batch Processing & Multi-PDF Generation
* **Endpoint:** `/api/customer/save-and-send`
* **Specification:**
  * Bulk updates the company profile metadata on all unlinked invoices.
  * Triggers background PDF generation for all matched records.
  * **LINE Delivery:** Generates a Flex Message containing download links for all PDFs.
  * **Email Delivery:** Automatically compiles and attaches all generated PDFs inside a single email message.

---

## 3. Request Full Tax Invoice Rich Menu (REQ#04)

### 3.1 Layout & Input Adjustments
* **Page:** `public/liff/request-invoice.html`
* **Field Reordering:** `TAX RECORD ID` input is shifted to the top field, followed by `TAX ID` below it.
* **Invisible Search Button:** The lookup search button (`btnSearch`) is hidden.
* **Disabled TAX ID Field:** The `TAX ID` input is greyed-out and disabled by default.
* **Lookup Trigger:** Lookup is triggered on `TAX RECORD ID` field `blur` or when the `Enter` key is pressed.

### 3.2 Search & Verification Logic
* **Endpoint:** `/api/customer/search-record`
* **Validations:**
  * **No Customer Data / Not Found:** If the invoice record does not exist or lacks an `existing_tax_id` link in the database, shows popup alert:
    * `"ใบกำกับภาษีนี้ยังไม่มีข้อมูลลูกค้า โปรดเพิ่มข้อมูลจากเมนู 'กรอกข้อมูลขอใบกำกับภาษี' "`
  * **Age Check (> 7 Days):** If `service_date` is older than 7 days:
    * `"ใบกำกับภาษี <tax_rec_id> ขอเกินกำหนด 7 วัน กรุณาติดต่อแอดมิน"`
    * Clears all inputs and resets focus.
  * **Success:** Populates the read-only customer details form on screen, shows the linked Tax ID inside the greyed-out field, and activates the **OK (ตกลง)** button to launch the LINE/Email delivery modal sheet.

---

## 4. Email Layout & Portal Adjustments

### 4.1 Email Signature Layout
* **Service:** `src/services/emailService.js`
* **Specification:**
  * Resized company logo, signature image, and QR code to a clean width of `250px`.
  * Bolded the footer notes section.

### 4.2 Web Portal Column Layouts
* **Pages:** `customers.html`, `customer-profiles.html`, `pdf-management.html`
* **Specification:** Moved all Action and Accounting-specific columns (edit, delete, view PDF, regenerate PDF) to the leftmost positions (Indices 0, 1, 2) for better screen visibility on desktop monitors.

---

## 5. Custom Dialog UI Overlays (UX Improvement)

### 5.1 Prevention of Server URL Prefix Header
* **Specification:**
  * Browser native `alert()` and `confirm()` windows show the server's domain/URL (e.g. `localhost:3000 says:` or `liff.line.me says:`) in webviews and mobile devices.
  * Replaced all native dialog boxes with custom-styled, absolute-positioned HTML/CSS modal overlays (`#customModalOverlay`) inside both LIFF files (`missing-info.html` and `request-invoice.html`).
  * Utilizes asynchronous Javascript Promise wrappers (`showCustomAlert` and `showCustomConfirm`) to pause code execution until the user clicks **ตกลง (OK)** or **ยกเลิก (Cancel)** without rendering any URL prefix.
