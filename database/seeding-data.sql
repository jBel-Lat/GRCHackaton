-- Sample seeding data (optional)
-- Run after schema.sql to populate test data

-- Create admin account
-- Password: admin123
INSERT INTO admin (username, password, full_name, role_id)
VALUES (
    'admin',
    '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcg7b3XeKeUxWdeS86E36DRjk3u',
    'System Admin',
    (SELECT id FROM admin_role WHERE role_name = 'admin' LIMIT 1)
);

-- Create sample panelists
-- Password: panelist123
INSERT INTO panelist (username, password, full_name, created_by) 
VALUES 
('panelist1', '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcg7b3XeKeUxWdeS86E36DRjk3u', 'John Evaluator', 1),
('panelist2', '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcg7b3XeKeUxWdeS86E36DRjk3u', 'Jane Assessor', 1),
('panelist3', '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcg7b3XeKeUxWdeS86E36DRjk3u', 'Mike Reviewer', 1);

-- Create sample event
INSERT INTO event (event_name, description, start_date, end_date, status, created_by)
VALUES ('Hackathon 2026', 'Annual company-wide hackathon event', '2026-03-15 09:00:00', '2026-03-16 18:00:00', 'ongoing', 1);

-- Add criteria to event
INSERT INTO criteria (event_id, criteria_name, percentage, max_score)
VALUES 
(1, 'Innovation', 30, 100),
(1, 'Technical Implementation', 25, 100),
(1, 'Presentation', 20, 100),
(1, 'Teamwork', 15, 100),
(1, 'Execution', 10, 100);

-- Assign panelists to event
INSERT INTO panelist_event_assignment (panelist_id, event_id, assigned_by)
VALUES 
(1, 1, 1),
(2, 1, 1),
(3, 1, 1);

-- Add sample participants
INSERT INTO participant (event_id, participant_name, team_name, registration_number)
VALUES 
(1, 'Team Alpha', 'Team Alpha', 'REG001'),
(1, 'Team Beta', 'Team Beta', 'REG002'),
(1, 'Team Gamma', 'Team Gamma', 'REG003'),
(1, 'Team Delta', 'Team Delta', 'REG004');

-- Add sample students
INSERT INTO student (name, student_number, status, created_by)
VALUES
('Alice Learner', 'STU1001', 'active', 1),
('Bob Scholar', 'STU1002', 'active', 1);

-- Assign sample students to event
INSERT INTO student_event_assignment (student_id, event_id, assigned_by)
VALUES
(1, 1, 1),
(2, 1, 1);

-- Add sample grades
INSERT INTO grade (participant_id, criteria_id, panelist_id, score)
VALUES 
-- Team Alpha scores
(1, 1, 1, 85),  -- Innovation from panelist 1
(1, 2, 1, 80),  -- Technical from panelist 1
(1, 3, 1, 90),  -- Presentation from panelist 1
(1, 1, 2, 88),  -- Innovation from panelist 2
(1, 2, 2, 82),  -- Technical from panelist 2

-- Team Beta scores
(2, 1, 1, 92),
(2, 2, 1, 88),
(2, 3, 1, 85),
(2, 1, 2, 90),
(2, 2, 2, 86),

-- Team Gamma scores
(3, 1, 1, 78),
(3, 2, 1, 75),
(3, 3, 1, 80),

-- Team Delta scores
(4, 1, 1, 95),
(4, 2, 1, 93),
(4, 3, 1, 92);
