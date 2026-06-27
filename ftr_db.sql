USE ftr_db;



/*
INSERT INTO invoices_rec (tax_rec_id, part_desc, price, unit_num, amount) 
VALUES ("RF2606-01898", "AAAAAAA", 150.00, 1, 150.00),
		("RF2606-01898", "BBBBBBB", 150.00, 1, 150.00),
        ("RF2606-01898", "CCCCCCC", 150.00, 1, 150.00),
        ("RF2606-01898", "DDDDDDD", 150.00, 1, 150.00),
        ("RF2606-01898", "EEEEEEE", 150.00, 1, 150.00);
*/
 
select * from invoices; # where tax_rec_id = "RF2606-02296";
select raw_cdms_row from invoices_rec where tax_rec_id = "RF2606-02021";		# where tax_rec_id = "RF2606-01898";
        
select * from customer_profile;
select * from activity_logs;
select * from generated_documents;
select * from admin_users;

-- ALTER TABLE invoices ADD COLUMN booking_num VARCHAR(50) DEFAULT NULL AFTER container_num;
-- ALTER TABLE invoices_rec ADD COLUMN raw_cdms_row TEXT DEFAULT NULL;

/* Clean up all data. Schema for DB local
SET FOREIGN_KEY_CHECKS = 0;
TRUNCATE TABLE invoices;
TRUNCATE TABLE invoices_rec;
TRUNCATE TABLE customer_profile;
TRUNCATE TABLE activity_logs;
TRUNCATE TABLE generated_documents;
SET FOREIGN_KEY_CHECKS = 1;
*/

/* schema for DB server
SET FOREIGN_KEY_CHECKS = 0;
DELETE FROM invoices;
DELETE FROM invoices_rec;
DELETE FROM customer_profile;
DELETE FROM activity_logs;
DELETE FROM generated_documents;

-- Optional: Reset the AUTO_INCREMENT counters back to 1
ALTER TABLE invoices AUTO_INCREMENT = 1;
ALTER TABLE invoices_rec AUTO_INCREMENT = 1;
ALTER TABLE customer_profile AUTO_INCREMENT = 1;
ALTER TABLE activity_logs AUTO_INCREMENT = 1;
ALTER TABLE generated_documents AUTO_INCREMENT = 1;
SET FOREIGN_KEY_CHECKS = 1;
*/