-- Hackathon Grading System Database Schema

CREATE DATABASE IF NOT EXISTS hackathon_grading;
USE hackathon_grading;

-- Admin table
CREATE TABLE IF NOT EXISTS admin (
    id INT PRIMARY KEY AUTO_INCREMENT,
    username VARCHAR(255) NOT NULL UNIQUE,
    password VARCHAR(255) NOT NULL,
    full_name VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Panelist table
CREATE TABLE IF NOT EXISTS panelist (
    id INT PRIMARY KEY AUTO_INCREMENT,
    username VARCHAR(255) NOT NULL UNIQUE,
    password VARCHAR(255) NOT NULL,
    full_name VARCHAR(255) NOT NULL,
    status ENUM('active', 'inactive') DEFAULT 'active',
    created_by INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (created_by) REFERENCES admin(id) ON DELETE RESTRICT
);

-- Event table
CREATE TABLE IF NOT EXISTS event (
    id INT PRIMARY KEY AUTO_INCREMENT,
    event_name VARCHAR(255) NOT NULL,
    description TEXT,
    start_date DATETIME,
    end_date DATETIME,
    status ENUM('upcoming', 'ongoing', 'completed') DEFAULT 'upcoming',
    created_by INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (created_by) REFERENCES admin(id) ON DELETE RESTRICT
);

-- Event Criteria table
CREATE TABLE IF NOT EXISTS criteria (
    id INT PRIMARY KEY AUTO_INCREMENT,
    event_id INT NOT NULL,
    criteria_name VARCHAR(255) NOT NULL,
    criteria_details TEXT,
    percentage DECIMAL(5, 2) NOT NULL,
    max_score INT NOT NULL DEFAULT 100,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (event_id) REFERENCES event(id) ON DELETE CASCADE,
    UNIQUE KEY unique_criteria_per_event (event_id, criteria_name)
);

-- Panelist-Event Assignment table
CREATE TABLE IF NOT EXISTS panelist_event_assignment (
    id INT PRIMARY KEY AUTO_INCREMENT,
    panelist_id INT NOT NULL,
    event_id INT NOT NULL,
    assigned_by INT NOT NULL,
    assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (panelist_id) REFERENCES panelist(id) ON DELETE CASCADE,
    FOREIGN KEY (event_id) REFERENCES event(id) ON DELETE CASCADE,
    FOREIGN KEY (assigned_by) REFERENCES admin(id) ON DELETE RESTRICT,
    UNIQUE KEY unique_panelist_event (panelist_id, event_id)
);

-- Student table (for voters/graders who only provide name and student ID)
CREATE TABLE IF NOT EXISTS student (
    id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(255) NOT NULL,
    student_number VARCHAR(100) NOT NULL UNIQUE,
    status ENUM('active', 'inactive') DEFAULT 'active',
    created_by INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (created_by) REFERENCES admin(id) ON DELETE RESTRICT
);

-- Student-Event Assignment table
CREATE TABLE IF NOT EXISTS student_event_assignment (
    id INT PRIMARY KEY AUTO_INCREMENT,
    student_id INT NOT NULL,
    event_id INT NOT NULL,
    assigned_by INT NOT NULL,
    assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (student_id) REFERENCES student(id) ON DELETE CASCADE,
    FOREIGN KEY (event_id) REFERENCES event(id) ON DELETE CASCADE,
    FOREIGN KEY (assigned_by) REFERENCES admin(id) ON DELETE RESTRICT,
    UNIQUE KEY unique_student_event (student_id, event_id)
);

-- Student grade/vote table (records scores given by students)
CREATE TABLE IF NOT EXISTS student_grade (
    id INT PRIMARY KEY AUTO_INCREMENT,
    participant_id INT NOT NULL,
    criteria_id INT NOT NULL,
    student_id INT NOT NULL,
    score DECIMAL(5, 2) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (participant_id) REFERENCES participant(id) ON DELETE CASCADE,
    FOREIGN KEY (criteria_id) REFERENCES criteria(id) ON DELETE CASCADE,
    FOREIGN KEY (student_id) REFERENCES student(id) ON DELETE CASCADE,
    UNIQUE KEY unique_student_grade (participant_id, criteria_id, student_id)
);

-- Participant table
CREATE TABLE IF NOT EXISTS participant (
    id INT PRIMARY KEY AUTO_INCREMENT,
    event_id INT NOT NULL,
    participant_name VARCHAR(255) NOT NULL,
    team_name VARCHAR(255),
    problem_name VARCHAR(100),
    registration_number VARCHAR(100),
    pdf_file_path VARCHAR(500),
    ppt_file_path VARCHAR(500),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (event_id) REFERENCES event(id) ON DELETE CASCADE
);

-- Panelist Best-in-Category selections (used for Top 3 aggregation)
CREATE TABLE IF NOT EXISTS panelist_best_category (
    id INT PRIMARY KEY AUTO_INCREMENT,
    panelist_id INT NOT NULL,
    event_id INT NOT NULL,
    participant_id INT NOT NULL,
    category VARCHAR(80) NOT NULL DEFAULT 'best_technical_implementation',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (panelist_id) REFERENCES panelist(id) ON DELETE CASCADE,
    FOREIGN KEY (event_id) REFERENCES event(id) ON DELETE CASCADE,
    FOREIGN KEY (participant_id) REFERENCES participant(id) ON DELETE CASCADE,
    UNIQUE KEY unique_panelist_best_pick_category (panelist_id, event_id, participant_id, category)
);

-- Grade table
CREATE TABLE IF NOT EXISTS grade (
    id INT PRIMARY KEY AUTO_INCREMENT,
    participant_id INT NOT NULL,
    criteria_id INT NOT NULL,
    panelist_id INT NOT NULL,
    score DECIMAL(5, 2) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (participant_id) REFERENCES participant(id) ON DELETE CASCADE,
    FOREIGN KEY (criteria_id) REFERENCES criteria(id) ON DELETE CASCADE,
    FOREIGN KEY (panelist_id) REFERENCES panelist(id) ON DELETE CASCADE,
    UNIQUE KEY unique_grade (participant_id, criteria_id, panelist_id)
);


