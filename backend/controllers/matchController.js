const pool = require('../config/database');

const VALID_STATUS = new Set(['pending', 'ongoing', 'finished']);
const VALID_WINNER_SIDE = new Set(['teama', 'teamb', 'none', '']);

function normStatus(v) {
    const s = String(v || '').toLowerCase().trim();
    return VALID_STATUS.has(s) ? s : null;
}

function shuffle(arr) {
    const out = [...arr];
    for (let i = out.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
}

async function ensureColumn(connection, name, sql) {
    const [rows] = await connection.query('SHOW COLUMNS FROM matches LIKE ?', [name]);
    if (!rows.length) await connection.query(sql);
}

async function ensureMatchesTable(connection) {
    await connection.query(`
        CREATE TABLE IF NOT EXISTS matches (
            id INT PRIMARY KEY AUTO_INCREMENT,
            event_id INT NOT NULL,
            bracket_type ENUM('single','upper','lower','grand_final','grand_final_reset') NOT NULL DEFAULT 'single',
            round_name VARCHAR(100) NOT NULL,
            round_number INT NOT NULL DEFAULT 1,
            match_number INT NOT NULL DEFAULT 1,
            teamA VARCHAR(255) NOT NULL DEFAULT 'TBD',
            teamB VARCHAR(255) NOT NULL DEFAULT 'TBD',
            teamA_participant_id INT NULL,
            teamB_participant_id INT NULL,
            source_label_teamA VARCHAR(255) NULL,
            source_label_teamB VARCHAR(255) NULL,
            source_match_teamA_id INT NULL,
            source_match_teamB_id INT NULL,
            status ENUM('pending','ongoing','finished') NOT NULL DEFAULT 'pending',
            facebook_live_url TEXT NULL,
            winner_team_id INT NULL,
            winner_team_name VARCHAR(255) NULL,
            loser_team_id INT NULL,
            loser_team_name VARCHAR(255) NULL,
            next_match_winner_id INT NULL,
            next_match_winner_slot ENUM('A','B') NULL,
            next_match_loser_id INT NULL,
            next_match_loser_slot ENUM('A','B') NULL,
            match_order INT NOT NULL DEFAULT 1,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            INDEX idx_matches_event (event_id, bracket_type, round_number, match_order)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await ensureColumn(connection, 'bracket_type', `ALTER TABLE matches ADD COLUMN bracket_type ENUM('single','upper','lower','grand_final','grand_final_reset') NOT NULL DEFAULT 'single' AFTER event_id`);
    await ensureColumn(connection, 'match_number', `ALTER TABLE matches ADD COLUMN match_number INT NOT NULL DEFAULT 1 AFTER round_number`);
    await ensureColumn(connection, 'winner_team_name', `ALTER TABLE matches ADD COLUMN winner_team_name VARCHAR(255) NULL AFTER winner_team_id`);
    await ensureColumn(connection, 'loser_team_id', `ALTER TABLE matches ADD COLUMN loser_team_id INT NULL AFTER winner_team_name`);
    await ensureColumn(connection, 'loser_team_name', `ALTER TABLE matches ADD COLUMN loser_team_name VARCHAR(255) NULL AFTER loser_team_id`);
    await ensureColumn(connection, 'next_match_winner_id', `ALTER TABLE matches ADD COLUMN next_match_winner_id INT NULL AFTER loser_team_name`);
    await ensureColumn(connection, 'next_match_winner_slot', `ALTER TABLE matches ADD COLUMN next_match_winner_slot ENUM('A','B') NULL AFTER next_match_winner_id`);
    await ensureColumn(connection, 'next_match_loser_id', `ALTER TABLE matches ADD COLUMN next_match_loser_id INT NULL AFTER next_match_winner_slot`);
    await ensureColumn(connection, 'next_match_loser_slot', `ALTER TABLE matches ADD COLUMN next_match_loser_slot ENUM('A','B') NULL AFTER next_match_loser_id`);
    await ensureColumn(connection, 'source_label_teamA', `ALTER TABLE matches ADD COLUMN source_label_teamA VARCHAR(255) NULL AFTER teamB_participant_id`);
    await ensureColumn(connection, 'source_label_teamB', `ALTER TABLE matches ADD COLUMN source_label_teamB VARCHAR(255) NULL AFTER source_label_teamA`);
    await ensureColumn(connection, 'source_match_teamA_id', `ALTER TABLE matches ADD COLUMN source_match_teamA_id INT NULL AFTER source_label_teamB`);
    await ensureColumn(connection, 'source_match_teamB_id', `ALTER TABLE matches ADD COLUMN source_match_teamB_id INT NULL AFTER source_match_teamA_id`);
}

async function getTournamentTeams(connection, eventId, teamIds) {
    const filtered = (Array.isArray(teamIds) ? teamIds : [])
        .map((id) => Number(id))
        .filter((id) => Number.isFinite(id) && id > 0);
    let sql = `
        SELECT MIN(id) AS participant_id, team_name
        FROM participant
        WHERE event_id = ? AND COALESCE(TRIM(team_name),'') <> ''
    `;
    const params = [eventId];
    if (filtered.length) {
        sql += ` AND id IN (${filtered.map(() => '?').join(',')})`;
        params.push(...filtered);
    }
    sql += ' GROUP BY team_name ORDER BY team_name ASC';
    const [rows] = await connection.query(sql, params);
    return rows.map((r) => ({ participant_id: r.participant_id, team_name: r.team_name }));
}

async function fetchAll(connection, eventId = null) {
    let sql = `
        SELECT m.*, e.event_name
        FROM matches m
        INNER JOIN event e ON e.id = m.event_id
    `;
    const params = [];
    if (eventId) {
        sql += ' WHERE m.event_id = ?';
        params.push(eventId);
    }
    sql += ` ORDER BY m.event_id ASC, FIELD(m.bracket_type,'upper','lower','grand_final','grand_final_reset','single') ASC, m.round_number ASC, m.match_order ASC, m.id ASC`;
    const [rows] = await connection.query(sql, params);
    return rows;
}

async function setSlot(connection, matchId, slot, teamName, teamId, sourceLabel, sourceMatchId) {
    const isA = String(slot || 'A').toUpperCase() === 'A';
    const teamCol = isA ? 'teamA' : 'teamB';
    const idCol = isA ? 'teamA_participant_id' : 'teamB_participant_id';
    const srcCol = isA ? 'source_label_teamA' : 'source_label_teamB';
    const srcMatchCol = isA ? 'source_match_teamA_id' : 'source_match_teamB_id';
    await connection.query(
        `UPDATE matches SET ${teamCol}=?, ${idCol}=?, ${srcCol}=?, ${srcMatchCol}=?, winner_team_id=NULL, winner_team_name=NULL, loser_team_id=NULL, loser_team_name=NULL, status='pending' WHERE id=?`,
        [teamName || 'TBD', teamId || null, sourceLabel || null, sourceMatchId || null, matchId]
    );
}

async function clearDependents(connection, sourceMatchId) {
    const [rows] = await connection.query(
        `SELECT id, source_match_teamA_id, source_match_teamB_id, source_label_teamA, source_label_teamB FROM matches WHERE source_match_teamA_id=? OR source_match_teamB_id=?`,
        [sourceMatchId, sourceMatchId]
    );
    for (const row of rows) {
        if (Number(row.source_match_teamA_id || 0) === Number(sourceMatchId)) {
            await setSlot(connection, row.id, 'A', 'TBD', null, row.source_label_teamA, row.source_match_teamA_id);
        }
        if (Number(row.source_match_teamB_id || 0) === Number(sourceMatchId)) {
            await setSlot(connection, row.id, 'B', 'TBD', null, row.source_label_teamB, row.source_match_teamB_id);
        }
        await clearDependents(connection, row.id);
    }
}

function buildDoubleTemplate8(teams) {
    const t = teams.slice(0, 8);
    return [
        { k: 'U1M1', bt: 'upper', rn: 'Upper Round 1', r: 1, n: 1, o: 1, ta: t[0], tb: t[1], sa: 'Seed 1', sb: 'Seed 2', nw: ['U2M1', 'A'], nl: ['L1M1', 'A'] },
        { k: 'U1M2', bt: 'upper', rn: 'Upper Round 1', r: 1, n: 2, o: 2, ta: t[2], tb: t[3], sa: 'Seed 3', sb: 'Seed 4', nw: ['U2M1', 'B'], nl: ['L1M1', 'B'] },
        { k: 'U1M3', bt: 'upper', rn: 'Upper Round 1', r: 1, n: 3, o: 3, ta: t[4], tb: t[5], sa: 'Seed 5', sb: 'Seed 6', nw: ['U2M2', 'A'], nl: ['L1M2', 'A'] },
        { k: 'U1M4', bt: 'upper', rn: 'Upper Round 1', r: 1, n: 4, o: 4, ta: t[6], tb: t[7], sa: 'Seed 7', sb: 'Seed 8', nw: ['U2M2', 'B'], nl: ['L1M2', 'B'] },
        { k: 'U2M1', bt: 'upper', rn: 'Upper Round 2', r: 2, n: 1, o: 5, sa: 'Winner U1M1', sb: 'Winner U1M2', srcA: 'U1M1', srcB: 'U1M2', nw: ['U3M1', 'A'], nl: ['L2M1', 'B'] },
        { k: 'U2M2', bt: 'upper', rn: 'Upper Round 2', r: 2, n: 2, o: 6, sa: 'Winner U1M3', sb: 'Winner U1M4', srcA: 'U1M3', srcB: 'U1M4', nw: ['U3M1', 'B'], nl: ['L2M2', 'B'] },
        { k: 'U3M1', bt: 'upper', rn: 'Upper Final', r: 3, n: 1, o: 7, sa: 'Winner U2M1', sb: 'Winner U2M2', srcA: 'U2M1', srcB: 'U2M2', nw: ['GF1', 'A'], nl: ['L4M1', 'B'] },
        { k: 'L1M1', bt: 'lower', rn: 'Lower Round 1', r: 1, n: 1, o: 8, sa: 'Loser U1M1', sb: 'Loser U1M2', srcA: 'U1M1', srcB: 'U1M2', nw: ['L2M1', 'A'] },
        { k: 'L1M2', bt: 'lower', rn: 'Lower Round 1', r: 1, n: 2, o: 9, sa: 'Loser U1M3', sb: 'Loser U1M4', srcA: 'U1M3', srcB: 'U1M4', nw: ['L2M2', 'A'] },
        { k: 'L2M1', bt: 'lower', rn: 'Lower Round 2', r: 2, n: 1, o: 10, sa: 'Winner L1M1', sb: 'Loser U2M1', srcA: 'L1M1', srcB: 'U2M1', nw: ['L3M1', 'A'] },
        { k: 'L2M2', bt: 'lower', rn: 'Lower Round 2', r: 2, n: 2, o: 11, sa: 'Winner L1M2', sb: 'Loser U2M2', srcA: 'L1M2', srcB: 'U2M2', nw: ['L3M1', 'B'] },
        { k: 'L3M1', bt: 'lower', rn: 'Lower Round 3', r: 3, n: 1, o: 12, sa: 'Winner L2M1', sb: 'Winner L2M2', srcA: 'L2M1', srcB: 'L2M2', nw: ['L4M1', 'A'] },
        { k: 'L4M1', bt: 'lower', rn: 'Lower Final', r: 4, n: 1, o: 13, sa: 'Winner L3M1', sb: 'Loser Upper Final', srcA: 'L3M1', srcB: 'U3M1', nw: ['GF1', 'B'] },
        { k: 'GF1', bt: 'grand_final', rn: 'Grand Final', r: 1, n: 1, o: 14, sa: 'Winner Upper Final', sb: 'Winner Lower Final', srcA: 'U3M1', srcB: 'L4M1' },
        { k: 'GFR1', bt: 'grand_final_reset', rn: 'Grand Final Reset (if needed)', r: 2, n: 1, o: 15, sa: 'Upper Bracket Champion', sb: 'Lower Bracket Champion' }
    ];
}

exports.getMatches = async (req, res) => {
    let connection;
    try {
        connection = await pool.getConnection();
        await ensureMatchesTable(connection);
        const eventId = req.query.event_id ? Number(req.query.event_id) : null;
        return res.json({ success: true, data: await fetchAll(connection, eventId) });
    } catch (e) {
        console.error('Get matches error:', e);
        return res.status(500).json({ success: false, message: 'Server error while fetching matches.' });
    } finally {
        if (connection) connection.release();
    }
};

exports.generateMatches = async (req, res) => {
    let connection;
    try {
        connection = await pool.getConnection();
        await ensureMatchesTable(connection);
        const eventId = Number(req.body?.event_id);
        if (!Number.isFinite(eventId) || eventId <= 0) return res.status(400).json({ success: false, message: 'event_id is required.' });
        const type = String(req.body?.bracket_type || 'single_elimination').toLowerCase();
        const teams = await getTournamentTeams(connection, eventId, req.body?.team_ids);
        if (teams.length < 2) return res.status(400).json({ success: false, message: 'At least 2 teams are required.' });

        await connection.beginTransaction();
        await connection.query('DELETE FROM matches WHERE event_id = ?', [eventId]);

        if (type === 'double_elimination') {
            if (teams.length !== 8) {
                await connection.rollback();
                return res.status(400).json({ success: false, message: 'Double elimination currently requires exactly 8 selected teams.' });
            }
            const map = new Map();
            const tpl = buildDoubleTemplate8(shuffle(teams));
            for (const m of tpl) {
                const [ins] = await connection.query(
                    `INSERT INTO matches (event_id, bracket_type, round_name, round_number, match_number, match_order, teamA, teamB, teamA_participant_id, teamB_participant_id, source_label_teamA, source_label_teamB, status)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
                    [eventId, m.bt, m.rn, m.r, m.n, m.o, m.ta?.team_name || 'TBD', m.tb?.team_name || 'TBD', m.ta?.participant_id || null, m.tb?.participant_id || null, m.sa || null, m.sb || null]
                );
                map.set(m.k, Number(ins.insertId));
            }
            for (const m of tpl) {
                await connection.query(
                    `UPDATE matches SET next_match_winner_id=?, next_match_winner_slot=?, next_match_loser_id=?, next_match_loser_slot=?, source_match_teamA_id=?, source_match_teamB_id=? WHERE id=?`,
                    [m.nw?.[0] ? map.get(m.nw[0]) : null, m.nw?.[1] || null, m.nl?.[0] ? map.get(m.nl[0]) : null, m.nl?.[1] || null, m.srcA ? map.get(m.srcA) : null, m.srcB ? map.get(m.srcB) : null, map.get(m.k)]
                );
            }
        } else {
            const ordered = type === 'mobile_legends' ? teams : shuffle(teams);
            const firstRound = [];
            for (let i = 0; i < ordered.length; i += 2) {
                const a = ordered[i];
                const b = ordered[i + 1] || { participant_id: null, team_name: 'BYE' };
                firstRound.push({ a, b, idx: (i / 2) + 1 });
            }
            for (const r of firstRound) {
                await connection.query(
                    `INSERT INTO matches (event_id, bracket_type, round_name, round_number, match_number, match_order, teamA, teamB, teamA_participant_id, teamB_participant_id, source_label_teamA, source_label_teamB, status, winner_team_id, winner_team_name)
                     VALUES (?, 'single', 'Round 1', 1, ?, ?, ?, ?, ?, ?, 'Seeded Team', ?, ?, ?, ?)`,
                    [eventId, r.idx, r.idx, r.a.team_name, r.b.team_name, r.a.participant_id, r.b.participant_id, r.b.participant_id ? 'Seeded Team' : 'BYE', r.b.participant_id ? 'pending' : 'finished', r.b.participant_id ? null : r.a.participant_id, r.b.participant_id ? null : r.a.team_name]
                );
            }
        }

        await connection.commit();
        return res.json({ success: true, message: 'Bracket generated successfully.', data: await fetchAll(connection, eventId) });
    } catch (e) {
        if (connection) try { await connection.rollback(); } catch (_) {}
        console.error('Generate matches error:', e);
        return res.status(500).json({ success: false, message: 'Server error while generating matches.' });
    } finally {
        if (connection) connection.release();
    }
};

exports.updateMatchLiveUrl = async (req, res) => {
    let connection;
    try {
        connection = await pool.getConnection();
        await ensureMatchesTable(connection);
        const id = Number(req.params.id);
        const [r] = await connection.query('UPDATE matches SET facebook_live_url=? WHERE id=?', [String(req.body?.facebook_live_url || '').trim() || null, id]);
        if (!r.affectedRows) return res.status(404).json({ success: false, message: 'Match not found.' });
        return res.json({ success: true, message: 'Live link updated successfully.' });
    } catch (e) {
        console.error('Update match live URL error:', e);
        return res.status(500).json({ success: false, message: 'Server error while updating live link.' });
    } finally {
        if (connection) connection.release();
    }
};

exports.updateMatchStatus = async (req, res) => {
    let connection;
    try {
        connection = await pool.getConnection();
        await ensureMatchesTable(connection);
        const id = Number(req.params.id);
        const status = normStatus(req.body?.status);
        if (!status) return res.status(400).json({ success: false, message: 'Status must be pending, ongoing, or finished.' });
        const [r] = await connection.query('UPDATE matches SET status=? WHERE id=?', [status, id]);
        if (!r.affectedRows) return res.status(404).json({ success: false, message: 'Match not found.' });
        return res.json({ success: true, message: 'Match status updated successfully.' });
    } catch (e) {
        console.error('Update match status error:', e);
        return res.status(500).json({ success: false, message: 'Server error while updating status.' });
    } finally {
        if (connection) connection.release();
    }
};

exports.updateMatchWinner = async (req, res) => {
    let connection;
    try {
        const id = Number(req.params.id);
        const side = String(req.body?.winner_side || '').toLowerCase().trim();
        if (!VALID_WINNER_SIDE.has(side)) return res.status(400).json({ success: false, message: 'winner_side must be teamA, teamB, or none.' });

        connection = await pool.getConnection();
        await ensureMatchesTable(connection);
        await connection.beginTransaction();
        const [rows] = await connection.query('SELECT * FROM matches WHERE id=? LIMIT 1', [id]);
        if (!rows.length) {
            await connection.rollback();
            return res.status(404).json({ success: false, message: 'Match not found.' });
        }
        const m = rows[0];

        if (side === 'none' || side === '') {
            await connection.query(`UPDATE matches SET winner_team_id=NULL, winner_team_name=NULL, loser_team_id=NULL, loser_team_name=NULL, status='pending' WHERE id=?`, [id]);
            await clearDependents(connection, id);
            await connection.commit();
            return res.json({ success: true, message: 'Winner reverted and progression cleared.' });
        }

        const winnerName = side === 'teama' ? m.teamA : m.teamB;
        const winnerId = side === 'teama' ? m.teamA_participant_id : m.teamB_participant_id;
        const loserName = side === 'teama' ? m.teamB : m.teamA;
        const loserId = side === 'teama' ? m.teamB_participant_id : m.teamA_participant_id;
        if (!winnerName || winnerName === 'TBD') {
            await connection.rollback();
            return res.status(400).json({ success: false, message: 'Cannot set winner while team slots are incomplete.' });
        }

        await connection.query(`UPDATE matches SET winner_team_id=?, winner_team_name=?, loser_team_id=?, loser_team_name=?, status='finished' WHERE id=?`, [winnerId || null, winnerName, loserId || null, loserName || null, id]);
        if (m.next_match_winner_id) await setSlot(connection, m.next_match_winner_id, m.next_match_winner_slot || 'A', winnerName, winnerId, `Advanced from ${m.round_name}`, id);
        if (m.next_match_loser_id && loserName && loserName !== 'TBD') await setSlot(connection, m.next_match_loser_id, m.next_match_loser_slot || 'A', loserName, loserId, `Dropped from ${m.round_name}`, id);

        await connection.commit();
        return res.json({ success: true, message: 'Match winner updated successfully.' });
    } catch (e) {
        if (connection) try { await connection.rollback(); } catch (_) {}
        console.error('Update match winner error:', e);
        return res.status(500).json({ success: false, message: 'Server error while updating winner.' });
    } finally {
        if (connection) connection.release();
    }
};

exports.updateMatchOpponents = async (req, res) => {
    let connection;
    try {
        const id = Number(req.params.id);
        const teamA = String(req.body?.teamA || '').trim();
        const teamB = String(req.body?.teamB || '').trim();
        if (!teamA || !teamB) return res.status(400).json({ success: false, message: 'Both teamA and teamB are required.' });
        const teamAId = Number.isFinite(Number(req.body?.teamA_participant_id)) ? Number(req.body?.teamA_participant_id) : null;
        const teamBId = Number.isFinite(Number(req.body?.teamB_participant_id)) ? Number(req.body?.teamB_participant_id) : null;

        connection = await pool.getConnection();
        await ensureMatchesTable(connection);
        await connection.beginTransaction();
        const [r] = await connection.query(
            `UPDATE matches SET teamA=?, teamB=?, teamA_participant_id=?, teamB_participant_id=?, source_match_teamA_id=NULL, source_match_teamB_id=NULL, source_label_teamA='Manual Admin Assignment', source_label_teamB='Manual Admin Assignment', winner_team_id=NULL, winner_team_name=NULL, loser_team_id=NULL, loser_team_name=NULL, status='pending' WHERE id=?`,
            [teamA, teamB, teamAId, teamBId, id]
        );
        if (!r.affectedRows) {
            await connection.rollback();
            return res.status(404).json({ success: false, message: 'Match not found.' });
        }
        await clearDependents(connection, id);
        await connection.commit();
        return res.json({ success: true, message: 'Match teams updated.' });
    } catch (e) {
        if (connection) try { await connection.rollback(); } catch (_) {}
        console.error('Update match opponents error:', e);
        return res.status(500).json({ success: false, message: 'Server error while updating teams.' });
    } finally {
        if (connection) connection.release();
    }
};

exports.advanceToNextRound = async (req, res) => {
    return res.json({ success: true, message: 'Round progression is handled by winner updates for this bracket mode.' });
};

exports.resetTournament = async (req, res) => {
    let connection;
    try {
        connection = await pool.getConnection();
        await ensureMatchesTable(connection);
        const eventId = Number(req.body?.event_id);
        if (!Number.isFinite(eventId) || eventId <= 0) return res.status(400).json({ success: false, message: 'event_id is required.' });
        const [r] = await connection.query('DELETE FROM matches WHERE event_id=?', [eventId]);
        return res.json({ success: true, message: `Tournament reset. Deleted ${Number(r.affectedRows || 0)} matches.` });
    } catch (e) {
        console.error('Reset tournament error:', e);
        return res.status(500).json({ success: false, message: 'Server error while resetting tournament.' });
    } finally {
        if (connection) connection.release();
    }
};

