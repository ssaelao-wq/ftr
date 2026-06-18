USE ftr_db;

select * from invoices;
select * from invoices_rec;
select * from customer_profile;
select * from activity_logs;
select * from generated_documents;
select * from admin_users;

-- ALTER TABLE invoices ADD COLUMN booking_num VARCHAR(50) DEFAULT NULL AFTER container_num;
/*
SET FOREIGN_KEY_CHECKS = 0;
TRUNCATE TABLE invoices;
TRUNCATE TABLE invoices_rec;
TRUNCATE TABLE customer_profile;
TRUNCATE TABLE activity_logs;
TRUNCATE TABLE generated_documents;
SET FOREIGN_KEY_CHECKS = 1;
*/