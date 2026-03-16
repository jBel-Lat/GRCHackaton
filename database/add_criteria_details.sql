-- Add details/description support per grading criteria
ALTER TABLE criteria
ADD COLUMN criteria_details TEXT NULL AFTER criteria_name;
