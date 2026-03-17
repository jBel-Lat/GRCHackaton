-- Double-elimination support for tournament matches
-- Run this once in MySQL for existing databases.

ALTER TABLE matches
ADD COLUMN IF NOT EXISTS bracket_type ENUM('single','upper','lower','grand_final','grand_final_reset') NOT NULL DEFAULT 'single' AFTER event_id,
ADD COLUMN IF NOT EXISTS match_number INT NOT NULL DEFAULT 1 AFTER round_number,
ADD COLUMN IF NOT EXISTS source_label_teamA VARCHAR(255) NULL AFTER teamB_participant_id,
ADD COLUMN IF NOT EXISTS source_label_teamB VARCHAR(255) NULL AFTER source_label_teamA,
ADD COLUMN IF NOT EXISTS source_match_teamA_id INT NULL AFTER source_label_teamB,
ADD COLUMN IF NOT EXISTS source_match_teamB_id INT NULL AFTER source_match_teamA_id,
ADD COLUMN IF NOT EXISTS winner_team_name VARCHAR(255) NULL AFTER winner_team_id,
ADD COLUMN IF NOT EXISTS loser_team_id INT NULL AFTER winner_team_name,
ADD COLUMN IF NOT EXISTS loser_team_name VARCHAR(255) NULL AFTER loser_team_id,
ADD COLUMN IF NOT EXISTS next_match_winner_id INT NULL AFTER loser_team_name,
ADD COLUMN IF NOT EXISTS next_match_winner_slot ENUM('A','B') NULL AFTER next_match_winner_id,
ADD COLUMN IF NOT EXISTS next_match_loser_id INT NULL AFTER next_match_winner_slot,
ADD COLUMN IF NOT EXISTS next_match_loser_slot ENUM('A','B') NULL AFTER next_match_loser_id;

CREATE INDEX IF NOT EXISTS idx_matches_event_bracket_round
ON matches(event_id, bracket_type, round_number, match_order);

