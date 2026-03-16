const pool = require('../config/database');
const { SUCCESS_MESSAGES, ERROR_MESSAGES } = require('../config/constants');
const XLSX = require('xlsx');
const buildTemplateBuffer = require('../templates/hackathon_template');
const path = require('path');
const fs = require('fs');

// Helpers
async function getAdminActorId(connection, req) {
    let adminActorId = Number.isFinite(Number(req.user?.id)) ? Number(req.user.id) : null;
    if (!adminActorId) {
        const [adminRow] = await connection.query('SELECT id FROM admin LIMIT 1');
        adminActorId = adminRow.length ? adminRow[0].id : null;
    }
    return adminActorId;
}

async function getCriteriaWithDetailsCompat(connection, eventId) {
    const queries = [
        'SELECT id, criteria_name, criteria_details, percentage, max_score FROM criteria WHERE event_id = ?',
        'SELECT id, criteria_name, details AS criteria_details, percentage, max_score FROM criteria WHERE event_id = ?',
        'SELECT id, criteria_name, description AS criteria_details, percentage, max_score FROM criteria WHERE event_id = ?',
        'SELECT id, criteria_name, percentage, max_score FROM criteria WHERE event_id = ?'
    ];

    for (const sql of queries) {
        try {
            const [rows] = await connection.query(sql, [eventId]);
            return rows.map((row) => ({
                ...row,
                criteria_details: row.criteria_details || null
            }));
        } catch (err) {
            if (!(err.message && err.message.includes('Unknown column'))) {
                throw err;
            }
        }
    }

    return [];
}

async function ensureParticipantFileColumns(connection) {
    const alterQueries = [
        'ALTER TABLE participant ADD COLUMN pdf_file_path VARCHAR(500) NULL',
        'ALTER TABLE participant ADD COLUMN ppt_file_path VARCHAR(500) NULL'
    ];

    for (const sql of alterQueries) {
        try {
            await connection.query(sql);
        } catch (err) {
            // Ignore if column already exists.
            if (err && (err.code === 'ER_DUP_FIELDNAME' || (err.message && err.message.toLowerCase().includes('duplicate column')))) {
                continue;
            }
            throw err;
        }
    }
}

// Delete all participants for an event (admin)
exports.deleteAllParticipantsForEvent = async (req, res) => {
    try {
        const { event_id } = req.params;
        if (!event_id) {
            return res.status(400).json({ success: false, message: ERROR_MESSAGES.MISSING_REQUIRED_FIELDS });
        }
        const connection = await pool.getConnection();
        await connection.query('DELETE FROM participant WHERE event_id = ?', [event_id]);
        connection.release();
        res.json({ success: true, message: SUCCESS_MESSAGES.DELETED_SUCCESS });
    } catch (error) {
        console.error('Delete all participants error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

// Admin override/update panelist grade (upsert)
exports.adminUpdatePanelistGrade = async (req, res) => {
    try {
        let { participant_id, criteria_id, panelist_id, panelist_name, score } = req.body;
        const parsedParticipant = parseInt(participant_id, 10);
        const parsedCriteria = parseInt(criteria_id, 10);
        let parsedScore = score !== undefined ? parseFloat(score) : undefined;
        if (!Number.isFinite(parsedScore)) parsedScore = 0;
        if (!Number.isFinite(parsedParticipant) || !Number.isFinite(parsedCriteria)) {
            return res.status(400).json({
                success: false,
                message: `${ERROR_MESSAGES.MISSING_REQUIRED_FIELDS}: participant_id=${participant_id}, criteria_id=${criteria_id}, score=${parsedScore}`
            });
        }

        const connection = await pool.getConnection();
        let adminActorId = await getAdminActorId(connection, req);
        if (!adminActorId) {
            connection.release();
            return res.status(500).json({ success: false, message: 'No admin actor available for override.' });
        }

        // Resolve/create panelist
        if (!panelist_id) {
            if (panelist_name) {
                const [rows] = await connection.query('SELECT id FROM panelist WHERE full_name = ? LIMIT 1', [panelist_name]);
                if (rows.length) panelist_id = rows[0].id;
            }
            if (!panelist_id) {
                const overrideUsername = `admin_override_${adminActorId}`;
                const overrideFullName = `Admin Override (${req.user?.username || 'Admin'})`;
                await connection.query(
                    `INSERT IGNORE INTO panelist (username, password, full_name, created_by)
                     VALUES (?, ?, ?, ?)`,
                    [overrideUsername, 'override', overrideFullName, adminActorId]
                );
                const [overrideRow] = await connection.query(
                    `SELECT id FROM panelist WHERE username = ? LIMIT 1`,
                    [overrideUsername]
                );
                panelist_id = overrideRow.length ? overrideRow[0].id : null;
            }
        }

        if (!panelist_id || !Number.isFinite(Number(panelist_id))) {
            connection.release();
            return res.status(400).json({ success: false, message: 'No panelist id could be resolved.' });
        }

        await connection.query(
            `INSERT INTO grade (participant_id, criteria_id, panelist_id, score)
             VALUES (?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE score = VALUES(score)`,
            [parsedParticipant, parsedCriteria, panelist_id, parsedScore]
        );

        await connection.query(
            `INSERT INTO grade_edit_log (participant_id, criteria_id, target_type, target_id, old_score, new_score, admin_id)
             VALUES (?, ?, 'panelist', ?, NULL, ?, ?)`,
            [parsedParticipant, parsedCriteria, panelist_id, parsedScore, adminActorId]
        );

        connection.release();
        res.json({ success: true, message: SUCCESS_MESSAGES.UPDATED_SUCCESS });
    } catch (error) {
        console.error('Admin update panelist grade error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

// Admin override/update student grade (upsert)
exports.adminUpdateStudentGrade = async (req, res) => {
    try {
        let { participant_id, criteria_id, student_id, student_name, score } = req.body;
        const parsedParticipant = parseInt(participant_id, 10);
        const parsedCriteria = parseInt(criteria_id, 10);
        let parsedScore = score !== undefined ? parseFloat(score) : undefined;
        if (!Number.isFinite(parsedScore)) parsedScore = 0;
        if (!Number.isFinite(parsedParticipant) || !Number.isFinite(parsedCriteria)) {
            return res.status(400).json({
                success: false,
                message: `${ERROR_MESSAGES.MISSING_REQUIRED_FIELDS}: participant_id=${participant_id}, criteria_id=${criteria_id}, score=${parsedScore}`
            });
        }

        const connection = await pool.getConnection();
        let adminActorId = await getAdminActorId(connection, req);
        if (!adminActorId) {
            connection.release();
            return res.status(500).json({ success: false, message: 'No admin actor available for override.' });
        }

        if (!student_id) {
            if (student_name) {
                const [rows] = await connection.query('SELECT id FROM student WHERE name = ? LIMIT 1', [student_name]);
                if (rows.length) student_id = rows[0].id;
            }
            if (!student_id) {
                const overrideStudentNumber = `ADMIN_OVERRIDE_${adminActorId}`;
                const overrideName = `Admin Override (${req.user?.username || 'Admin'})`;
                await connection.query(
                    `INSERT IGNORE INTO student (name, student_number, status, created_by)
                     VALUES (?, ?, 'active', ?)`,
                    [overrideName, overrideStudentNumber, adminActorId]
                );
                const [overrideRow] = await connection.query(
                    `SELECT id FROM student WHERE student_number = ? LIMIT 1`,
                    [overrideStudentNumber]
                );
                student_id = overrideRow.length ? overrideRow[0].id : null;
            }
        }

        if (!student_id || !Number.isFinite(Number(student_id))) {
            connection.release();
            return res.status(400).json({ success: false, message: 'No student id could be resolved.' });
        }

        await connection.query(
            `INSERT INTO student_grade (participant_id, criteria_id, student_id, score)
             VALUES (?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE score = VALUES(score)`,
            [parsedParticipant, parsedCriteria, student_id, parsedScore]
        );

        await connection.query(
            `INSERT INTO grade_edit_log (participant_id, criteria_id, target_type, target_id, old_score, new_score, admin_id)
             VALUES (?, ?, 'student', ?, NULL, ?, ?)`,
            [parsedParticipant, parsedCriteria, student_id, parsedScore, adminActorId]
        );

        connection.release();
        res.json({ success: true, message: SUCCESS_MESSAGES.UPDATED_SUCCESS });
    } catch (error) {
        console.error('Admin update student grade error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

// ---- Placeholders for routes not yet restored (avoid startup errors) ----
const notImplemented = (name) => async (req, res) => {
    res.status(501).json({ success: false, message: `${name} not implemented` });
};

exports.getEventParticipants = async (req, res) => {
    try {
        const { event_id } = req.params;
        const connection = await pool.getConnection();
        let rows = [];
        try {
            const [withFiles] = await connection.query(
                `
                SELECT p.id,
                       p.participant_name,
                       p.team_name,
                       p.registration_number,
                       p.pdf_file_path,
                       p.ppt_file_path,
                       (
                         SELECT COALESCE(SUM(
                            c.percentage * (
                              (COALESCE((SELECT AVG(g.score) FROM grade g WHERE g.participant_id = p.id AND g.criteria_id = c.id), 0) / NULLIF(COALESCE(c.max_score, c.percentage, 100), 0)) * (ev.panelist_weight / 100) +
                              (COALESCE((SELECT AVG(sg.score) FROM student_grade sg WHERE sg.participant_id = p.id AND sg.criteria_id = c.id), 0) / NULLIF(COALESCE(c.max_score, c.percentage, 100), 0)) * (ev.student_weight / 100)
                            )
                         ),0)
                         FROM criteria c
                         WHERE c.event_id = p.event_id
                       ) AS total_score
                FROM participant p
                JOIN event ev ON ev.id = p.event_id
                WHERE p.event_id = ?
                ORDER BY p.participant_name
                `,
                [event_id]
            );
            rows = withFiles;
        } catch (err) {
            if (!(err.message && err.message.includes('Unknown column'))) {
                throw err;
            }
            const [withoutFiles] = await connection.query(
                `
                SELECT p.id,
                       p.participant_name,
                       p.team_name,
                       p.registration_number,
                       (
                         SELECT COALESCE(SUM(
                            c.percentage * (
                              (COALESCE((SELECT AVG(g.score) FROM grade g WHERE g.participant_id = p.id AND g.criteria_id = c.id), 0) / NULLIF(COALESCE(c.max_score, c.percentage, 100), 0)) * (ev.panelist_weight / 100) +
                              (COALESCE((SELECT AVG(sg.score) FROM student_grade sg WHERE sg.participant_id = p.id AND sg.criteria_id = c.id), 0) / NULLIF(COALESCE(c.max_score, c.percentage, 100), 0)) * (ev.student_weight / 100)
                            )
                         ),0)
                         FROM criteria c
                         WHERE c.event_id = p.event_id
                       ) AS total_score
                FROM participant p
                JOIN event ev ON ev.id = p.event_id
                WHERE p.event_id = ?
                ORDER BY p.participant_name
                `,
                [event_id]
            );
            rows = withoutFiles.map(r => ({ ...r, pdf_file_path: null, ppt_file_path: null }));
        }
        connection.release();
        res.json({ success: true, data: rows });
    } catch (error) {
        console.error('getEventParticipants error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

exports.getParticipantDetails = async (req, res) => {
    try {
        const { participant_id, event_id } = req.params;
        const connection = await pool.getConnection();
        const [rows] = await connection.query(
            'SELECT * FROM participant WHERE id = ? AND event_id = ?',
            [participant_id, event_id]
        );
        connection.release();
        if (!rows.length) {
            return res.status(404).json({ success: false, message: ERROR_MESSAGES.PARTICIPANT_NOT_FOUND });
        }
        res.json({ success: true, data: { participant: rows[0] } });
    } catch (error) {
        console.error('getParticipantDetails error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

exports.getParticipantGradesBreakdown = async (req, res) => {
    try {
        const { event_id, participant_id } = req.params;
        const connection = await pool.getConnection();
        const [eventWeights] = await connection.query('SELECT student_weight, panelist_weight FROM event WHERE id = ?', [event_id]);
        let criteria = await getCriteriaWithDetailsCompat(connection, event_id);
        // Use percentage as max_score when none is provided
        criteria = criteria.map(c => ({
            ...c,
            max_score: c.max_score && c.max_score > 0 ? c.max_score : c.percentage
        }));
        const [panelistGrades] = await connection.query(
            `SELECT c.id as criteria_id, p.full_name, g.score, g.panelist_id AS grader_id
             FROM criteria c
             LEFT JOIN grade g ON c.id = g.criteria_id AND g.participant_id = ?
             LEFT JOIN panelist p ON g.panelist_id = p.id
             WHERE c.event_id = ?`,
            [participant_id, event_id]
        );
        const [studentGrades] = await connection.query(
            `SELECT c.id as criteria_id, s.name, g.score, g.student_id AS grader_id
             FROM criteria c
             LEFT JOIN student_grade g ON c.id = g.criteria_id AND g.participant_id = ?
             LEFT JOIN student s ON g.student_id = s.id
             WHERE c.event_id = ?`,
            [participant_id, event_id]
        );
        connection.release();
        res.json({
            success: true,
            data: {
                weights: eventWeights[0] || { student_weight: 50, panelist_weight: 50 },
                criteria,
                panelistGrades,
                studentGrades
            }
        });
    } catch (error) {
        console.error('getParticipantGradesBreakdown error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

exports.addParticipant = async (req, res) => {
    try {
        const { event_id, participant_name, team_name, registration_number, members } = req.body;

        // Accept either a single participant_name or an array of members
        const names = [];
        if (participant_name && String(participant_name).trim()) {
            names.push(String(participant_name).trim());
        } else if (Array.isArray(members)) {
            members.forEach(m => {
                if (m && String(m).trim()) names.push(String(m).trim());
            });
        }

        if (!event_id || names.length === 0) {
            return res.status(400).json({ success: false, message: ERROR_MESSAGES.MISSING_REQUIRED_FIELDS });
        }

        const connection = await pool.getConnection();
        try {
            // Fetch existing participants in this event to avoid duplicates and enforce max members per team
            const [existing] = await connection.query(
                `SELECT participant_name, team_name FROM participant WHERE event_id = ?`,
                [event_id]
            );
            const existingSet = new Set(
                existing.map(p => `${(p.team_name || '').trim().toLowerCase()}|${(p.participant_name || '').trim().toLowerCase()}`)
            );

            const teamClean = (team_name || '').trim();
            const teamCleanLower = teamClean.toLowerCase();
            // reuse canonical team casing if it exists already (DB first, then within-batch)
            let canonicalTeamName = teamClean;
            const [teamRow] = await connection.query(
                `SELECT team_name FROM participant WHERE event_id = ? AND LOWER(TRIM(team_name)) = ? LIMIT 1`,
                [event_id, teamCleanLower]
            );
            if (teamRow.length) {
                canonicalTeamName = teamRow[0].team_name || teamClean;
            }

            const filtered = names
                .map(n => (n || '').trim())
                .filter(n => {
                    if (!n) return false;
                    const key = `${teamCleanLower}|${n.toLowerCase()}`;
                    if (existingSet.has(key)) return false;
                    existingSet.add(key); // guard within this batch
                    return true;
                });

            // enforce max 5 members per team (existing + new)
            const existingCount = existing.filter(p => (p.team_name || '').trim().toLowerCase() === teamCleanLower).length;
            const remainingSlots = Math.max(0, 5 - existingCount);
            const toInsert = filtered.slice(0, remainingSlots);
            const skippedForLimit = filtered.length - toInsert.length;

            if (toInsert.length === 0) {
                connection.release();
                return res.json({ success: true, data: { ids: [], count: 0, skipped: names.length, skipped_limit: skippedForLimit, remaining_slots: remainingSlots } });
            }

            await connection.beginTransaction();
            const ids = [];
            for (let i = 0; i < toInsert.length; i++) {
                const name = toInsert[i];
                const regNum = registration_number || `${canonicalTeamName || 'TEAM'}-${existingCount + i + 1}`;
                const [result] = await connection.query(
                    `INSERT INTO participant (event_id, participant_name, team_name, registration_number)
                     VALUES (?, ?, ?, ?)`,
                    [event_id, name, canonicalTeamName || null, regNum]
                );
                ids.push(result.insertId);
            }
            await connection.commit();
            connection.release();
            res.json({ success: true, data: { ids, count: ids.length, skipped: names.length - toInsert.length, skipped_limit: skippedForLimit, remaining_slots: Math.max(0, 5 - (existingCount + toInsert.length)) } });
        } catch (dbErr) {
            await connection.rollback();
            connection.release();
            console.error('addParticipant transaction error:', dbErr);
            res.status(500).json({ success: false, message: 'Server error' });
        }
    } catch (error) {
        console.error('addParticipant error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

exports.updateParticipant = async (req, res) => {
    try {
        const { id } = req.params;
        const { participant_name, team_name, registration_number } = req.body;
        const connection = await pool.getConnection();
        await connection.query(
            `UPDATE participant SET participant_name = ?, team_name = ?, registration_number = ? WHERE id = ?`,
            [participant_name, team_name || null, registration_number || null, id]
        );
        connection.release();
        res.json({ success: true, message: SUCCESS_MESSAGES.UPDATED_SUCCESS });
    } catch (error) {
        console.error('updateParticipant error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

exports.deleteParticipant = async (req, res) => {
    try {
        const { id } = req.params;
        const connection = await pool.getConnection();
        await connection.query('DELETE FROM participant WHERE id = ?', [id]);
        connection.release();
        res.json({ success: true, message: SUCCESS_MESSAGES.DELETED_SUCCESS });
    } catch (error) {
        console.error('deleteParticipant error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

exports.updateEventScoringWeights = async (req, res) => {
    try {
        const { event_id } = req.params;
        const { student_weight, panelist_weight } = req.body;
        const connection = await pool.getConnection();
        await connection.query(
            'UPDATE event SET student_weight = ?, panelist_weight = ? WHERE id = ?',
            [student_weight, panelist_weight, event_id]
        );
        connection.release();
        res.json({ success: true, message: SUCCESS_MESSAGES.UPDATED_SUCCESS });
    } catch (error) {
        console.error('updateEventScoringWeights error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

// Panelist
exports.getEventParticipantsForPanelist = async (req, res) => {
    try {
        const { event_id } = req.params;
        const connection = await pool.getConnection();
        // return one representative row per team (no per-member grading)
        let participants = [];
        try {
            const [withFiles] = await connection.query(
                `
                SELECT t.min_id AS id,
                       t.team_label AS team_name,
                       t.team_label AS participant_name,
                       p.pdf_file_path,
                       p.ppt_file_path
                FROM (
                    SELECT MIN(id) AS min_id,
                           team_label
                    FROM (
                        SELECT id,
                               COALESCE(NULLIF(team_name,''), participant_name) AS team_label
                        FROM participant
                        WHERE event_id = ?
                    ) grouped
                    GROUP BY team_label
                ) t
                LEFT JOIN participant p ON p.id = t.min_id
                ORDER BY t.team_label
                `,
                [event_id]
            );
            participants = withFiles;
        } catch (err) {
            if (!(err.message && err.message.includes('Unknown column'))) {
                throw err;
            }
            const [withoutFiles] = await connection.query(
                `
                SELECT MIN(id) AS id,
                       team_label AS team_name,
                       team_label AS participant_name
                FROM (
                    SELECT id,
                           COALESCE(NULLIF(team_name,''), participant_name) AS team_label
                    FROM participant
                    WHERE event_id = ?
                ) t
                GROUP BY team_label
                ORDER BY team_label
                `,
                [event_id]
            );
            participants = withoutFiles.map(p => ({ ...p, pdf_file_path: null, ppt_file_path: null }));
        }
        connection.release();
        res.json({ success: true, data: participants });
    } catch (error) {
        console.error('getEventParticipantsForPanelist error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

exports.getPanelistParticipantGrades = async (req, res) => {
    try {
        const { event_id, participant_id } = req.params;
        const panelistId = req.user.id;
        const connection = await pool.getConnection();
        const [participantRows] = await connection.query(
            'SELECT id FROM participant WHERE id = ? AND event_id = ? LIMIT 1',
            [participant_id, event_id]
        );
        if (!participantRows.length) {
            connection.release();
            return res.status(404).json({ success: false, message: ERROR_MESSAGES.PARTICIPANT_NOT_FOUND });
        }
        let criteria = await getCriteriaWithDetailsCompat(connection, event_id);
        criteria = criteria.map(c => ({
            ...c,
            max_score: c.max_score && c.max_score > 0 ? c.max_score : c.percentage
        }));
        const [grades] = await connection.query(
            'SELECT criteria_id, score FROM grade WHERE participant_id = ? AND panelist_id = ?',
            [participant_id, panelistId]
        );
        connection.release();
        const gradeMap = new Map(grades.map(g => [g.criteria_id, g.score]));
        const criteriaWithScores = criteria.map(c => ({
            ...c,
            existing_score: gradeMap.has(c.id) ? gradeMap.get(c.id) : null
        }));
        res.json({ success: true, data: criteriaWithScores });
    } catch (error) {
        console.error('getPanelistParticipantGrades error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

exports.submitGrade = async (req, res) => {
    try {
        const { event_id, participant_id, criteria_id, score } = req.body;
        const panelistId = Number(req.user.id);
        const parsedEventId = Number(event_id);
        const parsedParticipantId = Number(participant_id);
        const parsedCriteriaId = Number(criteria_id);
        const parsedScore = Number(score);

        if (!Number.isFinite(parsedEventId) || !Number.isFinite(parsedParticipantId) || !Number.isFinite(parsedCriteriaId) || !Number.isFinite(parsedScore)) {
            return res.status(400).json({ success: false, message: ERROR_MESSAGES.MISSING_REQUIRED_FIELDS });
        }

        const connection = await pool.getConnection();
        const [participantRows] = await connection.query(
            'SELECT id FROM participant WHERE id = ? AND event_id = ? LIMIT 1',
            [parsedParticipantId, parsedEventId]
        );
        if (!participantRows.length) {
            connection.release();
            return res.status(404).json({ success: false, message: ERROR_MESSAGES.PARTICIPANT_NOT_FOUND });
        }

        const [criteriaRows] = await connection.query(
            'SELECT id, percentage, max_score FROM criteria WHERE id = ? AND event_id = ? LIMIT 1',
            [parsedCriteriaId, parsedEventId]
        );
        if (!criteriaRows.length) {
            connection.release();
            return res.status(400).json({ success: false, message: 'Invalid criteria for selected event' });
        }

        const maxScore = Number(criteriaRows[0].max_score && criteriaRows[0].max_score > 0 ? criteriaRows[0].max_score : criteriaRows[0].percentage);
        if (parsedScore < 0 || (Number.isFinite(maxScore) && parsedScore > maxScore)) {
            connection.release();
            return res.status(400).json({ success: false, message: `Score must be between 0 and ${maxScore}` });
        }

        const [assignmentRows] = await connection.query(
            'SELECT id FROM panelist_event_assignment WHERE panelist_id = ? AND event_id = ? LIMIT 1',
            [panelistId, parsedEventId]
        );
        if (!assignmentRows.length) {
            connection.release();
            return res.status(403).json({ success: false, message: 'Panelist is not assigned to this event' });
        }

        await connection.query(
            `INSERT INTO grade (participant_id, criteria_id, panelist_id, score)
             VALUES (?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE score = VALUES(score)`,
            [parsedParticipantId, parsedCriteriaId, panelistId, parsedScore]
        );
        connection.release();
        res.json({ success: true, message: SUCCESS_MESSAGES.UPDATED_SUCCESS });
    } catch (error) {
        console.error('submitGrade error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

// Student
exports.getEventParticipantsForStudent = async (req, res) => {
    try {
        const { event_id } = req.params;
        const connection = await pool.getConnection();
        // return one representative row per team (no per-member grading)
        const [participants] = await connection.query(
            `
            SELECT MIN(id) AS id,
                   team_label AS team_name,
                   team_label AS participant_name
            FROM (
                SELECT id,
                       COALESCE(NULLIF(team_name,''), participant_name) AS team_label
                FROM participant
                WHERE event_id = ?
            ) t
            GROUP BY team_label
            ORDER BY team_label
            `,
            [event_id]
        );
        connection.release();
        res.json({ success: true, data: participants });
    } catch (error) {
        console.error('getEventParticipantsForStudent error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

exports.getStudentParticipantGrades = async (req, res) => {
    try {
        const { event_id, participant_id } = req.params;
        const studentId = req.user.id;
        const connection = await pool.getConnection();
        let criteria = await getCriteriaWithDetailsCompat(connection, event_id);
        criteria = criteria.map(c => ({
            ...c,
            max_score: c.max_score && c.max_score > 0 ? c.max_score : c.percentage
        }));
        const [grades] = await connection.query(
            'SELECT criteria_id, score FROM student_grade WHERE participant_id = ? AND student_id = ?',
            [participant_id, studentId]
        );
        connection.release();
        const gradeMap = new Map(grades.map(g => [g.criteria_id, g.score]));
        const criteriaWithScores = criteria.map(c => ({
            ...c,
            existing_score: gradeMap.has(c.id) ? gradeMap.get(c.id) : null
        }));
        res.json({ success: true, data: criteriaWithScores });
    } catch (error) {
        console.error('getStudentParticipantGrades error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

exports.submitGradeByStudent = async (req, res) => {
    try {
        const { participant_id, criteria_id, score } = req.body;
        const studentId = req.user.id;
        const connection = await pool.getConnection();
        await connection.query(
            `INSERT INTO student_grade (participant_id, criteria_id, student_id, score)
             VALUES (?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE score = VALUES(score)`,
            [participant_id, criteria_id, studentId, score]
        );
        connection.release();
        res.json({ success: true, message: SUCCESS_MESSAGES.UPDATED_SUCCESS });
    } catch (error) {
        console.error('submitGradeByStudent error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

// ---------- Admin import/export teams & members ----------
const multer = require('multer');
const importUpload = multer({ storage: multer.memoryStorage() });

const participantUploadsDir = path.join(__dirname, '..', 'uploads', 'participants');
if (!fs.existsSync(participantUploadsDir)) {
    fs.mkdirSync(participantUploadsDir, { recursive: true });
}

const participantFileStorage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, participantUploadsDir),
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname || '').toLowerCase();
        const safeExt = ext || '';
        const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
        cb(null, `participant-${req.params.participant_id || 'unknown'}-${unique}${safeExt}`);
    }
});

const participantFileUpload = multer({
    storage: participantFileStorage,
    fileFilter: (req, file, cb) => {
        const ext = path.extname(file.originalname || '').toLowerCase();
        const isPdf = ext === '.pdf';
        const isPpt = ext === '.ppt' || ext === '.pptx';
        if (!isPdf && !isPpt) {
            cb(new Error('Only PDF, PPT, and PPTX files are allowed.'));
            return;
        }
        cb(null, true);
    },
    limits: {
        fileSize: 25 * 1024 * 1024 // 25MB per file
    }
});

// export the middleware for routes
exports.importUploadMiddleware = importUpload.single('file');
exports.participantFilesUploadMiddleware = participantFileUpload.fields([
    { name: 'pdf_file', maxCount: 1 },
    { name: 'ppt_file', maxCount: 1 }
]);

exports.uploadParticipantFiles = async (req, res) => {
    try {
        const { participant_id } = req.params;
        const files = req.files || {};
        const pdfFile = files.pdf_file && files.pdf_file[0] ? files.pdf_file[0] : null;
        const pptFile = files.ppt_file && files.ppt_file[0] ? files.ppt_file[0] : null;

        if (!pdfFile && !pptFile) {
            return res.status(400).json({ success: false, message: 'Please upload a PDF or PPT/PPTX file.' });
        }

        const connection = await pool.getConnection();
        const [participantRows] = await connection.query(
            'SELECT id FROM participant WHERE id = ? LIMIT 1',
            [participant_id]
        );

        if (!participantRows.length) {
            connection.release();
            return res.status(404).json({ success: false, message: ERROR_MESSAGES.PARTICIPANT_NOT_FOUND });
        }

        // Auto-heal schema on environments where migration was not applied yet.
        await ensureParticipantFileColumns(connection);

        const updates = [];
        const params = [];
        if (pdfFile) {
            updates.push('pdf_file_path = ?');
            params.push(`/uploads/participants/${pdfFile.filename}`);
        }
        if (pptFile) {
            updates.push('ppt_file_path = ?');
            params.push(`/uploads/participants/${pptFile.filename}`);
        }
        params.push(participant_id);

        await connection.query(`UPDATE participant SET ${updates.join(', ')} WHERE id = ?`, params);
        const [updated] = await connection.query(
            'SELECT id, pdf_file_path, ppt_file_path FROM participant WHERE id = ? LIMIT 1',
            [participant_id]
        );
        connection.release();

        res.json({ success: true, data: updated[0] });
    } catch (error) {
        console.error('uploadParticipantFiles error:', error);
        res.status(500).json({ success: false, message: error.message || 'Server error' });
    }
};

exports.importTeams = async (req, res) => {
    try {
        const { file } = req;
        const event_id = req.body.event_id;
        if (!file || !event_id) {
            return res.status(400).json({ success: false, message: ERROR_MESSAGES.MISSING_REQUIRED_FIELDS });
        }
        const normalize = (v) =>
            (v || '')
                .trim()
                .replace(/\s+/g, ' ')
                .toLowerCase();

        const text = file.buffer.toString('utf8');
        const lines = text.split(/\r?\n/);
        if (lines.length < 2) {
            return res.status(400).json({ success: false, message: 'File is empty or missing data rows.' });
        }

        const connection = await pool.getConnection();
        const [existingRows] = await connection.query(
            `SELECT participant_name, team_name FROM participant WHERE event_id = ?`,
            [event_id]
        );

        // Maps for existing data
        const existingMemberKeys = new Set(
            existingRows.map(p => `${normalize(p.team_name)}|${normalize(p.participant_name)}`)
        );
        const existingTeamCounts = {};
        existingRows.forEach(p => {
            const t = normalize(p.team_name);
            existingTeamCounts[t] = (existingTeamCounts[t] || 0) + 1;
        });

        const teamCanonicalMap = {};
        existingRows.forEach(p => {
            const key = normalize(p.team_name);
            if (!teamCanonicalMap[key]) teamCanonicalMap[key] = p.team_name;
        });

        let processed = 0, teamsCreated = 0, membersInserted = 0, duplicates = 0, limitSkipped = 0;

        // Accumulate new members per team to apply 5-member limit
        const batchTeams = {};

        for (let i = 1; i < lines.length; i++) { // skip header
            const raw = lines[i];
            if (!raw || !raw.trim()) continue;
            const cols = raw.split(',').map(c => c.replace(/^"|"$/g, '').trim());
            if (cols.length < 2) continue;
            let team = cols[0];
            let member = cols[1];
            // skip separator rows
            if (/^---/i.test(team) || /^---/i.test(member)) continue;
            team = team.replace(/\s+/g, ' ').trim();
            member = member.replace(/\s+/g, ' ').trim();
            if (!team || !member) continue;

            processed++;
            const teamNorm = normalize(team);
            const memberNorm = normalize(member);
            const key = `${teamNorm}|${memberNorm}`;
            if (existingMemberKeys.has(key)) {
                duplicates++;
                continue;
            }
            if (!batchTeams[teamNorm]) {
                batchTeams[teamNorm] = {
                    canonical: teamCanonicalMap[teamNorm] || team,
                    members: new Set()
                };
            }
            batchTeams[teamNorm].members.add(member);
        }

        // Now insert per team respecting 5 member limit (existing + new)
        await connection.beginTransaction();
        for (const teamNorm of Object.keys(batchTeams)) {
            const info = batchTeams[teamNorm];
            const canonicalTeam = info.canonical;
            const currentCount = existingTeamCounts[teamNorm] || 0;
            const available = Math.max(0, 5 - currentCount);
            if (available <= 0) {
                limitSkipped += info.members.size;
                continue;
            }
            const membersArr = Array.from(info.members);
            const toInsert = membersArr.slice(0, available);
            limitSkipped += Math.max(0, membersArr.length - available);

            // if team not in DB, mark created
            if (currentCount === 0 && toInsert.length > 0) {
                teamsCreated++;
            }

            for (let idx = 0; idx < toInsert.length; idx++) {
                const member = toInsert[idx];
                const regNum = `${canonicalTeam || 'TEAM'}-${currentCount + idx + 1}`;
                await connection.query(
                    `INSERT INTO participant (event_id, participant_name, team_name, registration_number)
                     VALUES (?, ?, ?, ?)`,
                    [event_id, member, canonicalTeam, regNum]
                );
                membersInserted++;
                const newKey = `${teamNorm}|${normalize(member)}`;
                existingMemberKeys.add(newKey);
            }
            // update counts map for possible subsequent logic
            existingTeamCounts[teamNorm] = (existingTeamCounts[teamNorm] || 0) + toInsert.length;
        }
        await connection.commit();
        connection.release();

        res.json({
            success: true,
            data: {
                processed,
                teamsCreated,
                membersInserted,
                duplicates,
                limitSkipped
            }
        });
    } catch (error) {
        console.error('importTeams error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

// Custom Excel layout importer:
// Column A may contain "TEAM NAME:" or "MEMBERS:" or be blank.
// Column B holds either the team name (after TEAM NAME) or member names.
exports.importTeamsCustomLayout = async (req, res) => {
    try {
        const { file } = req;
        const event_id = req.body.event_id;
        if (!file || !event_id) {
            return res.status(400).json({ success: false, message: ERROR_MESSAGES.MISSING_REQUIRED_FIELDS });
        }

        const normalize = (v) =>
            (v || '')
                .trim()
                .replace(/\s+/g, ' ')
                .toLowerCase();

        const wb = XLSX.read(file.buffer, { type: 'buffer' });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

        let processed = 0,
            teamsCreated = 0,
            membersAdded = 0,
            duplicates = 0,
            invalid = 0,
            limitSkipped = 0;

        const connection = await pool.getConnection();
        // cache existing members and counts
        const [existingRows] = await connection.query(
            `SELECT participant_name, team_name FROM participant WHERE event_id = ?`,
            [event_id]
        );
        const existingMemberKeys = new Set(
            existingRows.map(p => `${normalize(p.team_name)}|${normalize(p.participant_name)}`)
        );
        const teamCounts = {};
        existingRows.forEach(p => {
            const t = normalize(p.team_name);
            teamCounts[t] = (teamCounts[t] || 0) + 1;
        });
        const canonicalTeamMap = {};
        existingRows.forEach(p => {
            const key = normalize(p.team_name);
            if (!canonicalTeamMap[key]) canonicalTeamMap[key] = p.team_name;
        });

        // in-batch cache
        const batchMembers = {}; // teamNorm -> Set of memberNorm

        // Parse per 7-row block starting at row index 2 (row 3 in Excel)
        for (let i = 2; i < rows.length; i += 7) {
            const labelA = (rows[i][0] || '').toString().trim().toLowerCase();
            const teamNameRaw = (rows[i][1] || '').toString().trim();
            if (!teamNameRaw || labelA !== 'team name') {
                invalid++;
                continue;
            }
            const tNorm = normalize(teamNameRaw);
            if (!canonicalTeamMap[tNorm]) canonicalTeamMap[tNorm] = teamNameRaw;
            if (!teamCounts[tNorm]) teamCounts[tNorm] = teamCounts[tNorm] || 0;
            if (!batchMembers[tNorm]) batchMembers[tNorm] = new Set();

            // member rows: i+1 to i+5
            for (let m = 1; m <= 5; m++) {
                const row = rows[i + m] || [];
                const label = (row[0] || '').toString().trim().toLowerCase();
                const memberRaw = (row[1] || '').toString().trim();
                if (m === 1 && label !== 'member name') {
                    // first member row must have label; if missing but member present, still allow
                }
                if (!memberRaw) continue; // skip blank member rows
                const memberNorm = normalize(memberRaw);
                const key = `${tNorm}|${memberNorm}`;
                if (existingMemberKeys.has(key) || batchMembers[tNorm]?.has(memberNorm)) {
                    duplicates++;
                    continue;
                }
                batchMembers[tNorm].add(memberNorm);
                processed++;
            }
        }

        await connection.beginTransaction();
        for (const tNorm of Object.keys(batchMembers)) {
            const canonicalTeam = canonicalTeamMap[tNorm] || tNorm;
            const existingCount = teamCounts[tNorm] || 0;
            const membersArr = Array.from(batchMembers[tNorm]);
            const available = Math.max(0, 5 - existingCount);
            if (available <= 0) {
                limitSkipped += membersArr.length;
                continue;
            }
            const toInsert = membersArr.slice(0, available);
            limitSkipped += Math.max(0, membersArr.length - available);

            if (existingCount === 0 && toInsert.length > 0) {
                teamsCreated++;
            }

            for (let i = 0; i < toInsert.length; i++) {
                const memberRaw = toInsert[i];
                const regNum = `${canonicalTeam || 'TEAM'}-${existingCount + i + 1}`;
                await connection.query(
                    `INSERT INTO participant (event_id, participant_name, team_name, registration_number)
                     VALUES (?, ?, ?, ?)`,
                    [event_id, memberRaw, canonicalTeam, regNum]
                );
                membersAdded++;
                existingMemberKeys.add(`${tNorm}|${normalize(memberRaw)}`);
            }
            teamCounts[tNorm] = existingCount + toInsert.length;
        }
        await connection.commit();
        connection.release();

        res.json({
            success: true,
            data: {
                teamsCreated,
                membersAdded,
                duplicates,
                limitSkipped,
                invalidRows: invalid
            }
        });
    } catch (error) {
        console.error('importTeamsCustomLayout error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

// Export in custom layout (TEAM NAME / MEMBERS blocks)
exports.exportTeamsCustomLayout = async (req, res) => {
    try {
        const { event_id } = req.query;
        if (!event_id) {
            return res.status(400).json({ success: false, message: ERROR_MESSAGES.MISSING_REQUIRED_FIELDS });
        }
        // Reuse the pre-built template generator
        const buf = buildTemplateBuffer();
        res.setHeader('Content-Disposition', 'attachment; filename="hackathon_30_teams_template.xlsx"');
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.send(buf);
    } catch (error) {
        console.error('exportTeamsCustomLayout error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

exports.exportTeams = async (req, res) => {
    try {
        const { event_id } = req.query;
        if (!event_id) {
            return res.status(400).json({ success: false, message: ERROR_MESSAGES.MISSING_REQUIRED_FIELDS });
        }
        const connection = await pool.getConnection();
        const [rows] = await connection.query(
            `SELECT team_name, participant_name
             FROM participant
             WHERE event_id = ?
             ORDER BY LOWER(TRIM(team_name)) ASC, LOWER(TRIM(participant_name)) ASC`,
            [event_id]
        );
        connection.release();

        const header = 'team_name,member_name';
        const seen = new Set();
        const body = rows
            .map(r => {
                const tRaw = (r.team_name || '').replace(/\s+/g, ' ').trim();
                const mRaw = (r.participant_name || '').replace(/\s+/g, ' ').trim();
                if (!tRaw || !mRaw) return null;
                const key = `${tRaw.toLowerCase()}|${mRaw.toLowerCase()}`;
                if (seen.has(key)) return null;
                seen.add(key);
                const t = tRaw.replace(/"/g, '""');
                const m = mRaw.replace(/"/g, '""');
                return `"${t}","${m}"`;
            })
            .filter(Boolean)
            .join('\n');

        const csv = [header, body].filter(Boolean).join('\n');
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename="participants_export.csv"');
        res.send(csv);
    } catch (error) {
        console.error('exportTeams error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};
