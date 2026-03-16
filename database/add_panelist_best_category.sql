-- Create table for panelist "Best in Category" selections
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
