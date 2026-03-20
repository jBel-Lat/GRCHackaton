-- Create a dedicated admin role entity and link admin accounts to it.

CREATE TABLE IF NOT EXISTS admin_role (
    id INT PRIMARY KEY AUTO_INCREMENT,
    role_name VARCHAR(50) NOT NULL UNIQUE,
    description VARCHAR(255) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

INSERT INTO admin_role (role_name, description)
VALUES
    ('admin', 'Full administrative access'),
    ('manager', 'Limited management access'),
    ('viewer', 'Read-only admin account')
ON DUPLICATE KEY UPDATE
    description = VALUES(description);

SET @has_role_id := (
    SELECT COUNT(*)
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'admin'
      AND COLUMN_NAME = 'role_id'
);
SET @sql_role_id := IF(@has_role_id = 0,
    'ALTER TABLE admin ADD COLUMN role_id INT NULL AFTER full_name',
    'SELECT ''role_id already exists''');
PREPARE stmt_role_id FROM @sql_role_id;
EXECUTE stmt_role_id;
DEALLOCATE PREPARE stmt_role_id;

SET @has_role_fk := (
    SELECT COUNT(*)
    FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'admin'
      AND CONSTRAINT_NAME = 'fk_admin_role_id'
);
SET @sql_role_fk := IF(@has_role_fk = 0,
    'ALTER TABLE admin ADD CONSTRAINT fk_admin_role_id FOREIGN KEY (role_id) REFERENCES admin_role(id) ON DELETE SET NULL',
    'SELECT ''fk_admin_role_id already exists''');
PREPARE stmt_role_fk FROM @sql_role_fk;
EXECUTE stmt_role_fk;
DEALLOCATE PREPARE stmt_role_fk;

UPDATE admin a
JOIN admin_role ar ON ar.role_name = 'admin'
SET a.role_id = ar.id
WHERE a.role_id IS NULL;

-- Example manual changes:
-- Assign one admin as manager
-- UPDATE admin
-- SET role_id = (SELECT id FROM admin_role WHERE role_name = 'manager')
-- WHERE username = 'your_admin_username';

-- See all admins with their role names
-- SELECT a.id, a.username, a.full_name, ar.role_name
-- FROM admin a
-- LEFT JOIN admin_role ar ON ar.id = a.role_id;
