-- Drop database if it exists to start fresh
DROP DATABASE IF EXISTS ftr_db;
CREATE DATABASE ftr_db;
USE ftr_db;

-- 1. Customer Profile Table
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

-- 2. Invoice Header (Parent Table - One record per Invoice)
CREATE TABLE `invoices` (
    `tax_rec_id`                VARCHAR(50)  NOT NULL,            -- e.g. RF2605-01109 (Single source of truth)
    `customer_num`              VARCHAR(50)  DEFAULT NULL,         -- Link to customer_profile (unique key for join)
    `container_num`             TEXT         DEFAULT NULL,         -- container number from Gate-In, Gate-Out file upload
    `booking_num`               VARCHAR(50)  DEFAULT NULL,         -- booking number from Gate-Out file upload
    `service_date`              DATE         DEFAULT NULL,         -- format: YYYY-MM-DD
    `status`                    ENUM('pending','ready','failed') DEFAULT 'pending', -- Tracks PDF status
    `is_accounting_exported`    BOOLEAN      DEFAULT TRUE,         -- Flags if newly added tax data's been downloaded (defaults to TRUE, becomes FALSE when customer data is filled)
    `is_customer_data_updated`  BOOLEAN      DEFAULT FALSE,        -- [CR#2] 1-time lock: customer submitted data via Rich Menu LIFF
    `is_pdf_sent_from_richmenu` BOOLEAN      DEFAULT FALSE,        -- [CR#2] 1-time lock: PDF generated & sent via Rich Menu LIFF
    `created_at`                TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
    `updated_at`                TIMESTAMP    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`tax_rec_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. Invoice Items/Records (Child Table - Many records per Invoice)
CREATE TABLE `invoices_rec` (
    `rec_id` INT AUTO_INCREMENT NOT NULL,
    `tax_rec_id` VARCHAR(50) NOT NULL,
    `part_desc` VARCHAR(255) DEFAULT NULL,
    `price` DECIMAL(10, 2) DEFAULT NULL,
    `unit_num` DECIMAL(10,0) DEFAULT NULL,
    `amount` DECIMAL(10, 2) DEFAULT NULL,
    `verification_code` VARCHAR(20) DEFAULT NULL,
    `raw_cdms_row` TEXT DEFAULT NULL,
    PRIMARY KEY (`rec_id`),
    CONSTRAINT `fk_rec_invoice` FOREIGN KEY (`tax_rec_id`) REFERENCES `invoices` (`tax_rec_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4. Generated Documents (Child Table - One PDF per consolidated Invoice)
CREATE TABLE `generated_documents` (
    `id` INT AUTO_INCREMENT NOT NULL,
    `tax_rec_id` VARCHAR(50) NOT NULL,            -- Links to the Header
    `pdf_folder` VARCHAR(500) NOT NULL,
    `generated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    CONSTRAINT `fk_doc_invoice` FOREIGN KEY (`tax_rec_id`) REFERENCES `invoices` (`tax_rec_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 5. Create Admin Users Table
CREATE TABLE `admin_users` (
    `id` INT AUTO_INCREMENT NOT NULL,
    `username` VARCHAR(50) NOT NULL UNIQUE,
    `password_hash` VARCHAR(255) NOT NULL,
    `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 6. Create Activity Logs Table
CREATE TABLE `activity_logs` (
    `log_id`       INT AUTO_INCREMENT NOT NULL,
    `log_action`   VARCHAR(100) NOT NULL,
    `log_datetime` VARCHAR(20) NOT NULL,
    `username`     VARCHAR(50) DEFAULT NULL,
    `log_values`   TEXT DEFAULT NULL,
    PRIMARY KEY (`log_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Insert Admin User: 
/*
admin / admin123
ann.acc / ann123
nam.acc / nam789
ray.acc / ray456
tuu.acc / tuu147
aum / aum258
patanida / patanida369
*/

INSERT INTO `admin_users` (`username`, `password_hash`) 
VALUES
('admin',   '$2b$10$X.zBWTh4BdxYakAmTTm.HumGGz31N7ZRJ5vSgV2/VIfmbLU6Oxpv6'),
('ann.acc', '$2a$10$FHlUJsC6aFC6RObOj.Fru.Lx/K167zxCvnivTLqHYHuP2Ve9LUU3m'),
('nam.acc', '$2a$10$ooHxxrnNzhwNo4ygQRFBD.iRI4/AKpP5tqYo3HPswfu2DAPQEjEym'),
('ray.acc', '$2a$10$lq4AseRPs0SC9Dyj1A1q.ekP1dMNFyHISdLTubqRrF8nVZwxahsam'),
('tuu.acc', '$2a$10$JGRBJeDFoTO6W4RSWsXEFu9lz.ohk5QUJh3GqSDwWsdaYx9P4Wk.m'),
('aum',     '$2a$10$x3zwg.oKCcD9kGJk1xZnl.fVLO2S6GLb0TUWZt8yUTKFkviapfDIm'),
('patanida','$2a$10$KswrsQJS0/7LdWZvgR4k..uu8nGSewufQfKt0uMGRaxYjye/SpRnO');

