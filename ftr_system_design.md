# Full Tax Request System (FTR) - System Specification

## 1. Executive Summary
This project automates the issuance of Full Tax Invoices via Line Official Account (OA). Customers transition from paper "Brief Tax Invoices" to digital Full Tax Invoices by providing supplemental tax details (Company Name, Address, Tax ID) and requesting the Full Tax Invoices through a LIFF form by inputting their Tax Record ID, Tax ID, and recipient email address.

The system leverages daily data syncs (uploaded via a secure, authenticated admin webpage) from the Container Data Management System (CDMS) to validate requests and export additional tax data (downloadable as CSV via an authenticated admin webpage) back to the Accounting System. Requested PDFs are dispatched dynamically via email rather than being stored permanently with the email address in the invoices table. To ensure complete auditability, a comprehensive Activity Log records all critical customer requests, admin data syncs, automated batch jobs, and email transmissions.

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
2. **Adding Missing Info (LIFF):** Customer clicks "Update Info" in Line OA to open a LIFF form. They enter their **Tax ID**, **Company Name**, and **Address** along with the **Tax Record ID**. The system logs this activity.
3. **Validation & Restriction:** System confirms these missing data fields can only be set once by the user. Any subsequent corrections require Admin intervention.
4. **Request Full Tax Invoice (LIFF):** Customer opens the Request Full Tax Invoice LIFF form and submits their `tax_rec_id`, `tax_id`, and `email_sending` (the recipient email address for this specific request).
5. **Delivery & Exception Handling:**
   - *If CDMS data has not been uploaded yet:* The LIFF app displays the message "The Data is not ready yet".
   - *If data is complete but PDF is missing:* Generated instantly on-the-fly, an email is created attaching the PDF, and sent to `email_sending`.
   - *If PDF already exists:* An email is immediately created attaching the existing PDF and sent to `email_sending`. There is no restriction on the number of times a customer can request an existing Full Tax Invoice, and they can specify a different email address each time.
   - *If data is incomplete:* User is prompted to complete their missing tax information.

## 5. Functional Requirements

### 5.1 Front-End: Line OA & LIFF Integration

#### Rich Menu Functions:
1. **Adding Missing Info Form (LIFF):**
   - **Inputs:** `tax_rec_id` (Tax Record ID), `tax_id` (13-digit Tax ID), `customer_branch` (dropdown selection), `customer_num` (read-only), `company_name` (read-only), `address` (editable textarea), and `container_num` (optional).
   - **Dynamic Profile Lookup:** Once a valid 13-digit Tax ID is entered, the LIFF app calls a backend lookup API to retrieve registered branches. If profiles are found, the branch dropdown is populated and enabled. Selecting a branch auto-fills the Customer Number, Company Name, and default Address. If no profile exists for the Tax ID, the user receives an error instructing them to contact staff.
   - **Constraint:** One-time submission only. Admin assistance is required for any subsequent corrections.
   - **Activity Logging:** Records action `REQ_MISS_DATA` with `action|datetime|values` where `values` is `company_name:address:tax_rec_id`.
2. **Request Full Tax Invoice Form (LIFF):**
   - **Inputs:** `tax_rec_id`, `tax_id`, and `email_sending` (new field).
   - **Output:** Program retrieves or generates the PDF file, creates an email, and sends the PDF attachment to `email_sending`. `email_sending` is used dynamically and is NOT stored in the `invoices` table since the customer may change the destination email on every request. No restriction on request frequency.
   - **Exception Handling:**
     - *CDMS Data Missing:* If transaction data from CDMS has not been uploaded to the database yet, the LIFF app displays the message: "The Data is not ready yet".
     - *Incomplete Profile:* If CDMS data exists but the customer's tax profile (`company_name`, `address`, `tax_id`) is incomplete, the LIFF app displays the message: "Some missing data: company name, address, tax id". Then the user has to "Adding missing Info Form (LIFF)" before back to request full tax invoice, this case the pdf file has to generate on-the-fly.
   - **Activity Logging:** Records action `REQ_FULL_TAX` with `action|datetime|values` where `values` is `tax_rec_id:tax_id:email_sending`.

#### LIFF Performance Optimization:
To ensure the webpages load instantly when tapped from the LINE OA Rich Menu, the following frontend speed optimizations are applied:
* **Preconnect Connections:** Active `<link rel="preconnect">` tags for LINE CDN (`https://static.line-scdn.net`), Google Fonts (`https://fonts.googleapis.com`), and Google Static Assets (`https://fonts.gstatic.com`) established in the HTML headers. This eliminates DNS, TCP, and TLS negotiation overhead before resources are requested.
* **Inlined CSS Stylesheets:** Critical CSS styles from `style.css` are embedded directly inside the HTML page `<style>` block. This removes the render-blocking HTTP request for external CSS, enabling the browser to perform instantaneous paint operations on page load.
* **Native LINE LIFF URL Integration:** The Rich Menu triggers the forms via official LINE LIFF URLs (`https://liff.line.me/...`) rather than standard external browser links. This permits pre-authenticated access inside the LINE in-app web container, eliminating OAuth login redirect delays.

#### Messaging API & Email Dispatch:
Handles push/reply messaging in Line chat for status notifications, while the dedicated Email Engine dispatches the actual PDF documents to the requested email address.

### 5.2 Back-End: Node.js, Data Management & Admin Web Portal

#### Admin Web Portal:
* **Admin Authentication:** Secure login mechanism requiring valid username and password credentials to access any admin functionalities (stored in the `admin_users` table). There is no admin user management interface or webpage (no admin control UI); any addition or deletion of administrator accounts must be executed directly in the database.
* **Dashboard:** Displays overall system statistics (Total Invoices, Pending Profiles, Ready for Export, Exported Profiles) fetched live from the backend database.
* **CSV Upload Webpage (Inbound):** An authenticated webpage for Admin users to upload the daily transaction CSV export from CDMS (Post-18:00) and Customer Profile CSV files into the MySQL database.
  - **Auto-Detect Delimiter:** The file import automatically determines whether it is pipe-delimited (`|`) or comma-delimited (`,`) by analyzing delimiter counts on the first line.
  - **Auto-Detect Encoding:** To prevent Thai character corruption (such as when uploading legacy Excel CSV files), the parser automatically detects `Windows-874 / TIS-620` vs `UTF-8` formats and decodes the file accordingly.
  - **Flexible Column & Header Matching:** Columns are identified by dynamic header searching rather than fixed positions, supporting variations in header names (e.g. `E-mail` matches `email`).
  - **CDMS Validation & Checks:** The system validates columns, checks for duplicates, and rejects duplicate CDMS `tax_rec_id` values with the error message: `"Some Invoices already exist, cancel uploading. Duplicate record: [list of duplicate IDs]"`.
  - **Customer Profile Import Validation:** Checks for required columns and **safely skips rows with missing Tax IDs** to prevent database constraint errors.
  - **Activity Logging:** Records `REQ_UPLOAD_CDMS` (`username:no_of_upload_rec`) or `REQ_UPLOAD_CUSTOMER` (`username:no_of_customer_profiles`).
* **Invoice Data Webpage (Outbound & Edit):** An authenticated webpage for Admin users to manage invoice records and download consolidated CSV exports.
  - **Search:** Search invoices by `tax_rec_id` or service date range.
  - **Edit:** Inline editing modal allows updating `company_name`, `address`, and `tax_id` directly in the `invoices` table.
  - **CSV Download:** Downloads additional customer tax data (`company_name`, `address`, `tax_id` linked to `tax_rec_id`) for the Accounting System, marking them as exported.
  - **Activity Logging:** Records `REQ_DOWNLOAD_MISS` (`username:no_of_download_rec`).
* **Customer Profile Database Webpage:**
  - **Search:** Allows searching the master `customer_profile` table by `tax_id`, `customer_num`, or `customer_name`.
  - **Edit:** Admins can edit fields including Customer Name, Address, Email, Phone, and Branch code.
* **Manage PDF Webpage:**
  - **Search:** Search invoices by ID, date, completion status, Tax ID, or Customer (by customer name or customer number).
  - **Actions:** Icon buttons with CSS tooltips and dynamic disabled states for:
    1. *Generate PDF* (`POST /api/admin/customers/:tax_rec_id/generate-pdf`): Generates PDF on-the-fly if profile is complete and PDF is not already generated.
    2. *Download PDF* (`GET /api/admin/customers/:tax_rec_id/download-pdf`): Downloads generated PDF. Enabled only if PDF status is 'ready'.
    3. *Send Email* (`POST /api/admin/customers/:tax_rec_id/send-email`): Dispatches generated PDF invoices to specified recipient emails natively using standard OAuth2 (Option A) or Gmail App Passwords (Option C) fallback.
* **Activity Logs Viewer Webpage:** UI for admins to view the audit trail from the `activity_logs` table.

#### Activity Logging System:
Auditing mechanism recording 7 distinct types of system events (format: `action|datetime|values`):
1. `REQ_MISS_DATA`: Request to add missing data (`company_name:address:tax_rec_id`)
2. `REQ_FULL_TAX`: Request full tax invoice (`tax_rec_id:tax_id:email_sending`)
3. `REQ_UPLOAD_CDMS`: Upload CDMS data (`username:no_of_upload_rec`)
4. `REQ_DOWNLOAD_MISS`: Download missing data (`username:no_of_download_rec`)
5. `CRON_GEN_PDF`: PDFs generated by cron (`no_of_generated_rec`)
6. `ONTHEFLY_GEN_PDF`: PDFs generated on-the-fly (`tax_rec_id:tax_id:email_sending:pdf_url`)
7. `SENDING_EMAIL`: Sending email (`email_sending:pdf_url`)

### 5.3 Data Synchronization & PDF Generation
* **Nightly Batch:** Runs via node-cron. Scans for records with complete tax info but no PDF, then generates them in bulk. Records `CRON_GEN_PDF`.
* **On-the-Fly:** Triggered when a user requests a Full Tax Invoice where data is complete but PDF has not been generated yet. Records `ONTHEFLY_GEN_PDF`.
* **Email Dispatch:** After PDF generation/retrieval, creates an email with the PDF attached and sends it to `email_sending`. Records `SENDING_EMAIL`.
* **Verification Criteria:** To generate a PDF, `company_name`, `address`, and `tax_id` must contain valid data.

![Figure 1: Full Tax Request (FTR) System Architecture](file:///c:/Users/Somboon/LocalData/1-SSL/Dev/ftr/ftr_diagram.png)

## 6. Technical Stack
* **Backend:** Node.js (Express.js for API, Admin Web Portal with Authentication)
* **Frontend (Admin):** HTML5, CSS3, JavaScript (for Login, CSV Upload/Download, Customer Search & Edit, and Activity Log Viewer webpages)
* **Frontend (Customer):** LIFF (Line Frontend Framework)
* **Database:** MySQL
* **PDF Engine:** Puppeteer (HTML-to-PDF)
* **Scheduler:** Node-cron
* **Email Engine:** Nodemailer (or equivalent SMTP client)

## 7. Database Schema

### 7.1 Table and Column Descriptions
```sql
DROP DATABASE IF EXISTS ftr_db;

-- Create the database
CREATE DATABASE ftr_db;

-- Use the newly created database
USE ftr_db;

-- 1. Customer Profile Table

-- 2. Invoice Header (Parent Table - One record per Invoice)

-- 3. Invoice Items/Records (Child Table - Many records per Invoice)

=========



-- 1. Invoice Header (Parent Table - One record per Invoice)
CREATE TABLE `invoices` (
    `tax_rec_id` VARCHAR(50) NOT NULL,            -- e.g. RF2605-01109 (Single source of truth) link to invoices_rec
    `tax_id` VARCHAR(13) DEFAULT NULL,		-- Link to customer_profile
    `customer_branch` VARCHAR(50) DEFAULT NULL,   -- e.g. สำนักงานใหญ่, 00004
    `container_num` TEXT DEFAULT NULL,            -- Container number filled in by customer
    `service_date` DATE DEFAULT NULL,             -- format: YYYY-MM-DD
    `status` ENUM('pending', 'ready', 'failed') DEFAULT 'pending', -- Tracks PDF status
    `is_accounting_exported` BOOLEAN DEFAULT FALSE, -- Flags if newly added tax data's been downloaded
    `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP, 
    `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
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
    `id` INT AUTO_INCREMENT NOT NULL, 
    `tax_id` VARCHAR(13) NOT NULL,		-- e.g. 0107547001032
    `customer_num` VARCHAR(50) DEFAULT NULL,     	-- e.g. CUS-00098
    `customer_name` TEXT DEFAULT NULL,
    `customer_addr` TEXT DEFAULT NULL,
    `customer_email` VARCHAR(50) DEFAULT NULL,
    `customer_phone` VARCHAR(20) DEFAULT NULL,
    `customer_branch` VARCHAR(50) DEFAULT NULL,	-- e.g. สำนักงานใหญ่, 00004, 00009
    `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP, 
    `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`) 
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

CREATE TABLE activity_logs ( 
    log_id INT AUTO_INCREMENT NOT NULL, 
    log_action VARCHAR(100) NOT NULL, 
    log_datetime VARCHAR(20) NOT NULL, 
    log_values TEXT DEFAULT NULL, 
    PRIMARY KEY (log_id) 
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

#### Module 2 & 3: LIFF Front-End
* **Profile Verification on Load:** When the user opens the "Adding Missing Info" LIFF form, the frontend will silently call a backend API to check if their data is already filled. If it is, the form is disabled to enforce the "one-time submission" rule.
* **Dynamic User ID:** The `line_user_id` is fetched natively via `liff.getProfile()` and silently passed to the backend for every request.

#### Module 4: Customer-Facing APIs
* **`/lookup-branches` Logic:**
  - **Function:** Receives a 13-digit `tax_id` query parameter and queries the master `customer_profile` table.
  - **Response:** Returns a list of matching profiles including branch details (`customer_branch`), customer names, addresses, and customer numbers to populate the UI dropdown.
* **`/update-profile` Logic:**
  - **Pre-CDMS Submission Constraint:** If a customer submits missing info *before* the Admin uploads the CDMS data (meaning the `tax_rec_id` does not exist), the API will reject the request with the message: "Your Tax Record is not ready yet, please do it again next day".
  - **One-Time Constraint:** If the database already has a `company_name` for the provided `tax_rec_id`, the API returns a 403 Forbidden error.
  - **Container Update:** Customers can submit container number information alongside the update profile payload, which is saved to the invoice record.
* **`/request-invoice` Logic:**
  - **Data Readiness:** The API checks if the `tax_rec_id` exists in the database. *Crucially, it does NOT strictly validate that the input `tax_id` matches the database.* This ensures users aren't blocked by typos. If they input the wrong `tax_id`, the PDF will generate with the typo and they must contact the Admin for a manual correction.
  - **Incomplete Profile:** Checks if `company_name`, `address`, or `tax_id` are missing. If so, returns "Some missing data: company name, address, tax id".
  - **PDF On-The-Fly (Async):** If data is complete but the PDF is not yet generated, the API immediately returns the success message: `ใบกำกับภาษี จะส่งให้คุณทางอีเมล์ <email_sending> ภายใน 10-15 นาที`. The PDF generation and email dispatch happen in the background so the user doesn't wait.
  - **PDF Already Exists:** If the PDF is already generated, the API immediately returns the success message: `ใบกำกับภาษี จะส่งให้คุณทางอีเมล์ <email_sending>` and dispatches the email in the background.

#### Module 5 & 6: PDF & Email Engine
* **PDF Storage:** Generated PDFs will be saved to `/storage/pdfs/FTR_[tax_rec_id].pdf`.
* **Email Content:** The system will dispatch the PDF with the following Thai content:
  - **Subject:** `ใบกำกับภาษีแบบเต็ม <tax_rec_id>`
  - **Body:** `ใบกำกับภาษีแบบเต็มของ <tax_rec_id> สำหรับภาษีหมายเลข <tax_id>`

#### Module 7: Cron Batch Processing
* **Nightly Scan:** At 01:00 AM, the cron job selects all invoices where `status = 'pending'` (meaning PDF URL is blank) AND checks the completeness of `company_name`, `address`, and `tax_id` (ensure no blank fields).
* **Cron Email Dispatch:** The nightly cron job *only* generates the PDF and stores it. It does *not* send an email. Emails are strictly dispatched only when a customer actively requests it via the LIFF form (since they may use a different email address each time).

#### Module 8 & 9: Admin Web Portal
* **Access & Routing:** The root URL (e.g., `http://localhost:3000` or the live domain) redirects standard browser traffic directly to the Admin Dashboard (`/admin/dashboard.html`), which triggers a login check and redirects to `/admin/login.html` if the user is unauthenticated. Users do not need to manually type `/admin` or `/admin/login.html` to access the portal. For LINE OA users, the root router handles incoming LIFF queries (`?target=...`) and redirects them to the customer LIFF forms.
* **Auth-Ready Architecture:** The admin backend routes and UI endpoints will be cleanly grouped (e.g., under a `/admin/*` prefix). This guarantees that adding username/password authentication later will only require wrapping the prefix with a security middleware, completely avoiding any redesign of the internal logic.
* **Mobile-Responsive UI:** The entire admin web portal (CSV Upload/Download, Search & Edit, Activity Logs) is built with a responsive layout. Sizing boundaries on desktop (`max-width: calc(100% - 260px)` and `min-width: 0`) and mobile ensure content scales fluidly to fit the screen, with horizontal scrollbars (`overflow-x: auto`) automatically provided on tabular containers (`.table-responsive`) to navigate overflowing columns cleanly.
* **Activity Logs Viewer:** Displays a maximum of 500 recent records across 10 pages (50 records/page), ordered by newest first. Includes Search Filters for `Activity Name` (Dropdown) and `Date Range` (Calendar).
* **CDMS CSV Upload & Customer Profile Preview:** After selecting a file, the UI provides a preview. For Customer Profiles, the UI filters and displays only target schema columns (`Tax ID`, `Customer Num`, `Customer Name`, `Customer Addr`, `Customer Email`, `Customer Phone`, `Customer Branch`), automatically filters out records without a Tax ID from the preview, and displays statistics of valid vs. skipped records so the admin knows exactly what will be imported before clicking confirm.
* **Accounting CSV Download:** The system strictly downloads records where `is_accounting_exported = FALSE`. Once downloaded, this flag is set to TRUE. If a customer or Admin subsequently edits a profile, the flag resets to FALSE so it is captured in the next download. Output includes: `customer_name`, `address`, and `tax_id`.
* **Customer Search & Edit:** Includes Search Filters for `tax_rec_id` (partial match, e.g., 'RF') and `Date Range`. Only `company_name`, `address`, and `tax_id` can be edited by the Admin.
* **Manage PDF:** Search filters matching Customer Search page. Action buttons are styled with modern hover colors, custom SVG icons, CSS tooltips (`[data-tooltip]`), and dynamic disabled states depending on profile completeness and PDF readiness.
  - *Generate PDF* (`POST /api/admin/customers/:tax_rec_id/generate-pdf`): Regenerates/overwrites PDF on-the-fly, updates `generated_at = CURRENT_TIMESTAMP`, and sets invoice status to `'ready'` in database. Disabled if profile is incomplete or PDF is already generated.
  - *Download PDF* (`GET /api/admin/customers/:tax_rec_id/download-pdf`): Streams file from local relative path using `res.download()`. Disabled if PDF is not ready.
  - *Send Email* (`POST /api/admin/customers/:tax_rec_id/send-email`): Dispatches generated PDF invoices to specified recipient emails natively using standard OAuth2 (Option A) or Gmail App Passwords (Option C) fallback.
* **Customer Profile CSV Import Rules:**
  - **Duplicate Handling:** If a record with the same `tax_id` and `customer_branch` already exists, it is skipped (the existing database record is not updated/overwritten).
  - **Result Messaging & Feedback:**
    - If zero new records are saved (i.e. all uploaded records are duplicates or invalid), the API responds with a `400` status and the message `"All records fail to save"`.
    - If only some records are successfully saved and others are skipped as duplicates, the API responds with a `200` status and the message `"Can be saved some records"`.
    - If all records are successfully saved, the API responds with a success status and the total import count.
  - **Branch Mapping:** Translates the branch type fields `ประเภทสาขา` and `สาขา` into the database representation:
    - If `ประเภทสาขา` is `"สำนักงานใหญ่"`, store `"สำนักงานใหญ่"`.
    - If `ประเภทสาขา` is `"สาขาย่อย"`, store the branch code from the `สาขา` column.
  - **Skip Empty Identifier:** Any row where `เลขประจำตัวผู้เสียภาษี` (Tax ID) is empty is automatically skipped from insertion.
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
   - `generatePdf(record)` function — accepts a full invoice record object
   - Uses Puppeteer to render an HTML invoice template to PDF
   - Saves output to `/storage/pdfs/FTR_[tax_rec_id].pdf`
   - Returns the saved file path

2. **Create `src/templates/invoice.html`:**
   - Full Tax Invoice HTML template matching the `full_tax_invoice.jpg` reference image
   - Supports dynamic injection of: `tax_rec_id`, `company_name`, `address`, `tax_id`, `service_date`, `gross_amount`, `vat_amount`, `total_amount`, `container_no`, `verification_code`
   - Thai-language labels; A4 print layout

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
**Goal:** Build the activity log viewer with pagination and filtering.

**Tasks:**
1. **Create `src/api/admin/logs.js`:**
   - `GET /admin/logs` (protected) — accepts query params: `action` (filter), `date_from`, `date_to`, `page` (default 1)
   - Returns paginated results: 50 records/page, max 500 total, ordered by `log_id DESC`

2. **Create `public/admin/logs.html`:**
   - Filter controls: `Activity Name` dropdown (the 7 action types) + Date Range calendar
   - Table displaying: `log_id`, `action`, `datetime`, `values`
   - Pagination controls (previous/next, page indicator)

**Deliverables:** Admin can browse and filter all system activity logs with pagination.

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


