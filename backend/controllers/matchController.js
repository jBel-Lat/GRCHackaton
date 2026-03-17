const pool = require('../config/database');

const VALID_STATUS = new Set(['pending', 'ongoing', 'finished']);

async function ensureMatchesTable(connection) {
    await connection.query(`
        CREATE TABLE IF NOT EXISTS matches (
            id INT PRIMARY KEY AUTO_INCREMENT,
            event_id INT NOT NULL,
            round_name VARCHAR(100) NOT NULL,
            round_number INT NOT NULL DEFAULT 1,
            teamA VARCHAR(255) NOT NULL,
            teamB VARCHAR(255) NOT NULL,
            teamA_participant_id INT NULL,
            teamB_participant_id INT NULL,
            status ENUM('pending', 'ongoing', 'finished') NOT NULL DEFAULT 'pending',
            facebook_live_url TEXT NULL,
            winner_team_id INT NULL,
            match_order INT NOT NULL DEFAULT 1,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            INDEX idx_matches_event_round (event_id, round_number, match_order),
            CONSTRAINT fk_matches_event FOREIGN KEY (event_id) REFERENCES event(id) ON DELETE CASCADE,
            CONSTRAINT fk_matches_teamA_participant FOREIGN KEY (teamA_participant_id) REFERENCES participant(id) ON DELETE SET NULL,
            CONSTRAINT fk_matches_teamB_participant FOREIGN KEY (teamB_participant_id) REFERENCES participant(id) ON DELETE SET NULL,
            CONSTRAINT fk_matches_winner_participant FOREIGN KEY (winner_team_id) REFERENCES participant(id) ON DELETE SET NULL
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
}

function normalizeStatus(value) {
    const status = String(value || '').trim().toLowerCase();
    return VALID_STATUS.has(status) ? status : null;
}

function normalizeBracketType(value) {
    const type = String(value || '').trim().toLowerCase();
    return type === 'mobile_legends' ? 'mobile_legends' : 'single_elimination';
}

function shuffle(arr) {
    const copy = [...arr];
    for (let i = copy.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
}

function buildFirstRoundMatches(teams) {
    const matches = [];
    for (let i = 0; i < teams.length; i += 2) {
        const teamA = teams[i];
        const teamB = teams[i + 1] || { team_name: 'BYE', participant_id: null };
        matches.push({
            round_name: 'Round 1',
            round_number: 1,
            teamA: teamA.team_name,
            teamB: teamB.team_name,
            teamA_participant_id: teamA.participant_id,
            teamB_participant_id: teamB.participant_id,
            status: teamB.participant_id ? 'pending' : 'finished',
            winner_team_id: teamB.participant_id ? null : (teamA.participant_id || null),
            match_order: (i / 2) + 1
        });
    }
    return matches;
}

async function getParticipantNamesByIds(connection, ids = []) {
    const parsedIds = ids.map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0);
    if (!parsedIds.length) return new Map();

    const [rows] = await connection.query(
        `
            SELECT id, team_name, participant_name
            FROM participant
            WHERE id IN (${parsedIds.map(() => '?').join(',')})
        `,
        parsedIds
    );

    const map = new Map();
    rows.forEach((row) => {
        map.set(Number(row.id), (row.team_name || row.participant_name || `Team ${row.id}`));
    });
    return map;
}

async function getTournamentTeams(connection, eventId, teamIds = []) {
    const parsedEventId = Number(eventId);
    if (!Number.isFinite(parsedEventId) || parsedEventId <= 0) {
        throw new Error('Invalid event_id');
    }

    const hasTeamFilter = Array.isArray(teamIds) && teamIds.length > 0;
    const filteredIds = hasTeamFilter
        ? teamIds.map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0)
        : [];

    let sql = `
        SELECT MIN(id) AS participant_id, team_name
        FROM participant
        WHERE event_id = ?
          AND COALESCE(TRIM(team_name), '') <> ''
    `;
    const params = [parsedEventId];

    if (filteredIds.length) {
        sql += ` AND id IN (${filteredIds.map(() => '?').join(',')})`;
        params.push(...filteredIds);
    }

    sql += ` GROUP BY team_name ORDER BY team_name ASC`;

    const [rows] = await connection.query(sql, params);
    return rows.map((row) => ({
        participant_id: row.participant_id,
        team_name: row.team_name
    }));
}

exports.getMatches = async (req, res) => {
    let connection;
    try {
        const eventId = req.query.event_id ? Number(req.query.event_id) : null;
        connection = await pool.getConnection();
        await ensureMatchesTable(connection);

        let sql = `
            SELECT m.id, m.event_id, e.event_name, m.round_name, m.round_number,
                   m.teamA, m.teamB, m.teamA_participant_id, m.teamB_participant_id,
                   m.status, m.facebook_live_url, m.winner_team_id, m.match_order,
                   m.created_at, m.updated_at
            FROM matches m
            INNER JOIN event e ON e.id = m.event_id
        `;
        const params = [];

        if (eventId && Number.isFinite(eventId) && eventId > 0) {
            sql += ' WHERE m.event_id = ?';
            params.push(eventId);
        }

        sql += ' ORDER BY m.event_id ASC, m.round_number ASC, m.match_order ASC, m.id ASC';
        const [rows] = await connection.query(sql, params);

        return res.json({ success: true, data: rows });
    } catch (error) {
        console.error('Get matches error:', error);
        return res.status(500).json({ success: false, message: 'Server error while fetching matches.' });
    } finally {
        if (connection) connection.release();
    }
};

exports.generateMatches = async (req, res) => {
    let connection;
    try {
        const { event_id, team_ids, bracket_type } = req.body || {};
        const parsedEventId = Number(event_id);
        if (!Number.isFinite(parsedEventId) || parsedEventId <= 0) {
            return res.status(400).json({ success: false, message: 'event_id is required.' });
        }

        connection = await pool.getConnection();
        await ensureMatchesTable(connection);

        const teams = await getTournamentTeams(connection, parsedEventId, team_ids);
        if (teams.length < 2) {
            return res.status(400).json({ success: false, message: 'At least 2 teams are required to generate matches.' });
        }

        const bracketType = normalizeBracketType(bracket_type);
        const orderedTeams = bracketType === 'mobile_legends' ? teams : shuffle(teams);
        const matches = buildFirstRoundMatches(orderedTeams);

        await connection.beginTransaction();
        await connection.query('DELETE FROM matches WHERE event_id = ?', [parsedEventId]);

        const insertSql = `
            INSERT INTO matches (
                event_id, round_name, round_number, teamA, teamB,
                teamA_participant_id, teamB_participant_id, status, winner_team_id, match_order
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;

        for (const match of matches) {
            await connection.query(insertSql, [
                parsedEventId,
                match.round_name,
                match.round_number,
                match.teamA,
                match.teamB,
                match.teamA_participant_id,
                match.teamB_participant_id,
                match.status,
                match.winner_team_id,
                match.match_order
            ]);
        }

        await connection.commit();

        const [createdRows] = await connection.query(
            `
                SELECT m.id, m.event_id, e.event_name, m.round_name, m.round_number,
                       m.teamA, m.teamB, m.teamA_participant_id, m.teamB_participant_id,
                       m.status, m.facebook_live_url, m.winner_team_id, m.match_order,
                       m.created_at, m.updated_at
                FROM matches m
                INNER JOIN event e ON e.id = m.event_id
                WHERE m.event_id = ?
                ORDER BY m.round_number ASC, m.match_order ASC, m.id ASC
            `,
            [parsedEventId]
        );

        return res.json({
            success: true,
            message: 'Bracket matches generated successfully.',
            data: createdRows
        });
    } catch (error) {
        if (connection) {
            try { await connection.rollback(); } catch (_) {}
        }
        console.error('Generate matches error:', error);
        return res.status(500).json({ success: false, message: 'Server error while generating matches.' });
    } finally {
        if (connection) connection.release();
    }
};

exports.updateMatchLiveUrl = async (req, res) => {
    let connection;
    try {
        const matchId = Number(req.params.id);
        if (!Number.isFinite(matchId) || matchId <= 0) {
            return res.status(400).json({ success: false, message: 'Invalid match id.' });
        }

        const liveUrl = (req.body?.facebook_live_url || '').trim();

        connection = await pool.getConnection();
        await ensureMatchesTable(connection);

        const [result] = await connection.query(
            'UPDATE matches SET facebook_live_url = ? WHERE id = ?',
            [liveUrl || null, matchId]
        );

        if (!result.affectedRows) {
            return res.status(404).json({ success: false, message: 'Match not found.' });
        }

        return res.json({ success: true, message: 'Live link updated successfully.' });
    } catch (error) {
        console.error('Update match live URL error:', error);
        return res.status(500).json({ success: false, message: 'Server error while updating live link.' });
    } finally {
        if (connection) connection.release();
    }
};

exports.updateMatchStatus = async (req, res) => {
    let connection;
    try {
        const matchId = Number(req.params.id);
        if (!Number.isFinite(matchId) || matchId <= 0) {
            return res.status(400).json({ success: false, message: 'Invalid match id.' });
        }

        const status = normalizeStatus(req.body?.status);
        if (!status) {
            return res.status(400).json({ success: false, message: 'Status must be pending, ongoing, or finished.' });
        }

        connection = await pool.getConnection();
        await ensureMatchesTable(connection);

        const [result] = await connection.query(
            'UPDATE matches SET status = ? WHERE id = ?',
            [status, matchId]
        );

        if (!result.affectedRows) {
            return res.status(404).json({ success: false, message: 'Match not found.' });
        }

        return res.json({ success: true, message: 'Match status updated successfully.' });
    } catch (error) {
        console.error('Update match status error:', error);
        return res.status(500).json({ success: false, message: 'Server error while updating status.' });
    } finally {
        if (connection) connection.release();
    }
};

exports.updateMatchWinner = async (req, res) => {
    let connection;
    try {
        const matchId = Number(req.params.id);
        if (!Number.isFinite(matchId) || matchId <= 0) {
            return res.status(400).json({ success: false, message: 'Invalid match id.' });
        }

        const winnerSide = String(req.body?.winner_side || '').trim().toLowerCase();

        connection = await pool.getConnection();
        await ensureMatchesTable(connection);

        const [rows] = await connection.query(
            'SELECT id, teamA_participant_id, teamB_participant_id FROM matches WHERE id = ? LIMIT 1',
            [matchId]
        );

        if (!rows.length) {
            return res.status(404).json({ success: false, message: 'Match not found.' });
        }

        let winnerTeamId = null;
        let nextStatus = null;
        if (winnerSide === 'teama') winnerTeamId = rows[0].teamA_participant_id || null;
        if (winnerSide === 'teamb') winnerTeamId = rows[0].teamB_participant_id || null;
        if (!['teama', 'teamb', 'none', ''].includes(winnerSide)) {
            return res.status(400).json({ success: false, message: 'winner_side must be teamA, teamB, or none.' });
        }
        if (winnerSide === 'teama' || winnerSide === 'teamb') {
            nextStatus = 'finished';
        } else {
            nextStatus = 'pending';
        }

        await connection.query('UPDATE matches SET winner_team_id = ?, status = ? WHERE id = ?', [winnerTeamId, nextStatus, matchId]);
        return res.json({ success: true, message: 'Match winner updated successfully.' });
    } catch (error) {
        console.error('Update match winner error:', error);
        return res.status(500).json({ success: false, message: 'Server error while updating winner.' });
    } finally {
        if (connection) connection.release();
    }
};

exports.updateMatchOpponents = async (req, res) => {
    let connection;
    try {
        const matchId = Number(req.params.id);
        if (!Number.isFinite(matchId) || matchId <= 0) {
            return res.status(400).json({ success: false, message: 'Invalid match id.' });
        }

        const teamA = String(req.body?.teamA || '').trim();
        const teamB = String(req.body?.teamB || '').trim();
        const teamAParticipantIdRaw = req.body?.teamA_participant_id;
        const teamBParticipantIdRaw = req.body?.teamB_participant_id;

        if (!teamA || !teamB) {
            return res.status(400).json({ success: false, message: 'Both teamA and teamB are required.' });
        }

        const teamAParticipantId = Number.isFinite(Number(teamAParticipantIdRaw))
            ? Number(teamAParticipantIdRaw)
            : null;
        const teamBParticipantId = Number.isFinite(Number(teamBParticipantIdRaw))
            ? Number(teamBParticipantIdRaw)
            : null;

        connection = await pool.getConnection();
        await ensureMatchesTable(connection);

        const [result] = await connection.query(
            `
                UPDATE matches
                SET teamA = ?, teamB = ?,
                    teamA_participant_id = ?, teamB_participant_id = ?,
                    winner_team_id = NULL
                WHERE id = ?
            `,
            [teamA, teamB, teamAParticipantId, teamBParticipantId, matchId]
        );

        if (!result.affectedRows) {
            return res.status(404).json({ success: false, message: 'Match not found.' });
        }

        return res.json({
            success: true,
            message: 'Match opponents updated. Winner selection was cleared to avoid mismatch.'
        });
    } catch (error) {
        console.error('Update match opponents error:', error);
        return res.status(500).json({ success: false, message: 'Server error while updating opponents.' });
    } finally {
        if (connection) connection.release();
    }
};

exports.advanceToNextRound = async (req, res) => {
    let connection;
    try {
        const parsedEventId = Number(req.body?.event_id);
        if (!Number.isFinite(parsedEventId) || parsedEventId <= 0) {
            return res.status(400).json({ success: false, message: 'event_id is required.' });
        }

        connection = await pool.getConnection();
        await ensureMatchesTable(connection);

        const [roundRows] = await connection.query(
            'SELECT MAX(round_number) AS last_round FROM matches WHERE event_id = ?',
            [parsedEventId]
        );
        const lastRound = Number(roundRows[0]?.last_round || 0);
        if (!lastRound) {
            return res.status(400).json({ success: false, message: 'No matches found for this tournament event.' });
        }

        const [existingNext] = await connection.query(
            'SELECT COUNT(*) AS cnt FROM matches WHERE event_id = ? AND round_number = ?',
            [parsedEventId, lastRound + 1]
        );
        if (Number(existingNext[0]?.cnt || 0) > 0) {
            return res.status(400).json({ success: false, message: 'Next round is already generated.' });
        }

        const [lastRoundMatches] = await connection.query(
            `
                SELECT id, status, winner_team_id, match_order
                FROM matches
                WHERE event_id = ? AND round_number = ?
                ORDER BY match_order ASC, id ASC
            `,
            [parsedEventId, lastRound]
        );

        const unfinished = lastRoundMatches.find(
            (match) => String(match.status || '').toLowerCase() !== 'finished' || !match.winner_team_id
        );
        if (unfinished) {
            return res.status(400).json({
                success: false,
                message: 'Finish all matches and set winners before advancing to next round.'
            });
        }

        const winnerIds = lastRoundMatches.map((match) => Number(match.winner_team_id)).filter((id) => Number.isFinite(id) && id > 0);
        if (winnerIds.length <= 1) {
            return res.json({
                success: true,
                message: 'Tournament complete. No next round needed.',
                data: { completed: true, champion_team_id: winnerIds[0] || null }
            });
        }

        const nextRound = lastRound + 1;
        const participantNameMap = await getParticipantNamesByIds(connection, winnerIds);
        const nextRoundMatches = [];

        for (let i = 0; i < winnerIds.length; i += 2) {
            const teamAId = winnerIds[i];
            const teamBId = winnerIds[i + 1] || null;
            const teamAName = participantNameMap.get(teamAId) || `Team ${teamAId}`;
            const teamBName = teamBId ? (participantNameMap.get(teamBId) || `Team ${teamBId}`) : 'BYE';

            nextRoundMatches.push({
                event_id: parsedEventId,
                round_name: `Round ${nextRound}`,
                round_number: nextRound,
                teamA: teamAName,
                teamB: teamBName,
                teamA_participant_id: teamAId,
                teamB_participant_id: teamBId,
                status: teamBId ? 'pending' : 'finished',
                winner_team_id: teamBId ? null : teamAId,
                match_order: (i / 2) + 1
            });
        }

        await connection.beginTransaction();
        for (const match of nextRoundMatches) {
            await connection.query(
                `
                    INSERT INTO matches (
                        event_id, round_name, round_number, teamA, teamB,
                        teamA_participant_id, teamB_participant_id, status, winner_team_id, match_order
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `,
                [
                    match.event_id,
                    match.round_name,
                    match.round_number,
                    match.teamA,
                    match.teamB,
                    match.teamA_participant_id,
                    match.teamB_participant_id,
                    match.status,
                    match.winner_team_id,
                    match.match_order
                ]
            );
        }
        await connection.commit();

        const [allMatches] = await connection.query(
            `
                SELECT m.id, m.event_id, e.event_name, m.round_name, m.round_number,
                       m.teamA, m.teamB, m.teamA_participant_id, m.teamB_participant_id,
                       m.status, m.facebook_live_url, m.winner_team_id, m.match_order,
                       m.created_at, m.updated_at
                FROM matches m
                INNER JOIN event e ON e.id = m.event_id
                WHERE m.event_id = ?
                ORDER BY m.round_number ASC, m.match_order ASC, m.id ASC
            `,
            [parsedEventId]
        );

        return res.json({
            success: true,
            message: `Advanced to Round ${nextRound}.`,
            data: allMatches
        });
    } catch (error) {
        if (connection) {
            try { await connection.rollback(); } catch (_) {}
        }
        console.error('Advance round error:', error);
        return res.status(500).json({ success: false, message: 'Server error while advancing round.' });
    } finally {
        if (connection) connection.release();
    }
};
