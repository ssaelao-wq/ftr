-- Drop database if it exists to start fresh
DROP DATABASE IF EXISTS ftr_db;
CREATE DATABASE ftr_db;
USE ftr_db;

-- 1. Customer Profile Table
CREATE TABLE `customer_profile` (
    `id` INT AUTO_INCREMENT NOT NULL, 
    `tax_id` VARCHAR(13) NOT NULL,		-- 0107547001032
    `customer_num` VARCHAR(50) DEFAULT NULL,     	-- CUS-00098
    `customer_name` TEXT DEFAULT NULL,
    `customer_addr` TEXT DEFAULT NULL,
    `customer_email` VARCHAR(50) DEFAULT NULL,
    `customer_phone` VARCHAR(20) DEFAULT NULL,
    `customer_branch` VARCHAR(50) DEFAULT NULL,	-- สำนักงานใหญ่, 00004,00009
    `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP, -- Record creation timestamp
    `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, -- last update
    PRIMARY KEY (`id`) 
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. Invoice Header (Parent Table - One record per Invoice)
CREATE TABLE `invoices` (
    `tax_rec_id` VARCHAR(50) NOT NULL,            -- RF2605-01109 (Single source of truth) link to invoices_rec
    `tax_id` VARCHAR(13) DEFAULT NULL,		-- 0107547001032, link to customer_profile
    `customer_branch` VARCHAR(50) DEFAULT NULL,   -- branch e.g. สำนักงานใหญ่, 00004
    `container_num` TEXT DEFAULT NULL,            -- container number filled in by customer
    `service_date` DATE DEFAULT NULL,             -- format: DD/MM/YY (13/05/69)
    `status` ENUM('pending', 'ready', 'failed') DEFAULT 'pending', -- Tracks PDF status
    `is_accounting_exported` BOOLEAN DEFAULT FALSE, -- Flags if newly added tax data's been downloaded
    `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP, -- Record creation timestamp
    `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, -- last update
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
    PRIMARY KEY (`rec_id`),
    CONSTRAINT `fk_rec_invoice` FOREIGN KEY (`tax_rec_id`) REFERENCES `invoices` (`tax_rec_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. Generated Documents (Child Table - One PDF per consolidated Invoice)
CREATE TABLE `generated_documents` (
    `id` INT AUTO_INCREMENT NOT NULL,
    `tax_rec_id` VARCHAR(50) NOT NULL,
    `pdf_folder` VARCHAR(500) NOT NULL,
    `generated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    CONSTRAINT `fk_doc_invoice` FOREIGN KEY (`tax_rec_id`) REFERENCES `invoices` (`tax_rec_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4. Create Admin Users Table
CREATE TABLE `admin_users` (
    `id` INT AUTO_INCREMENT NOT NULL,
    `username` VARCHAR(50) NOT NULL UNIQUE,
    `password_hash` VARCHAR(255) NOT NULL,
    `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 5. Create Activity Logs Table (aligned with logger.js)
CREATE TABLE `activity_logs` (
    `log_id` INT AUTO_INCREMENT NOT NULL,
    `log_action` VARCHAR(100) NOT NULL,
    `log_datetime` VARCHAR(20) NOT NULL,
    `log_values` TEXT DEFAULT NULL,
    PRIMARY KEY (`log_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Insert Admin User: admin/admin123
INSERT INTO `admin_users` (`username`, `password_hash`) 
VALUES ('admin', '$2b$10$X.zBWTh4BdxYakAmTTm.HumGGz31N7ZRJ5vSgV2/VIfmbLU6Oxpv6');
