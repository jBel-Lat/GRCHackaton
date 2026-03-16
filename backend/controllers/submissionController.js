const pool = require('../config/database');

function toCsvUrl(inputUrl) {
    if (!inputUrl) return '';
    const rawUrl = String(inputUrl).trim();
    if (!rawUrl) return '';

    if (rawUrl.includes('/export?') && rawUrl.includes('format=csv')) {
        return rawUrl;
    }

    const { sheetId, gid } = getSheetIdAndGid(rawUrl);
    if (!sheetId) return rawUrl;

    return `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gid}`;
}

function getSheetIdAndGid(inputUrl) {
    const url = String(inputUrl || '').trim();
    const idMatch = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    if (!idMatch) return { sheetId: null, gid: '0' };
    const gidMatch = url.match(/[?&]gid=(\d+)/) || url.match(/#gid=(\d+)/) || url.match(/gid=(\d+)/);
    return { sheetId: idMatch[1], gid: gidMatch ? gidMatch[1] : '0' };
}

function buildCandidateCsvUrls(inputUrl) {
    const raw = String(inputUrl || '').trim();
    if (!raw) return [];

    const urls = [];
    const addUnique = (u) => {
        if (!u || typeof u !== 'string') return;
        if (!urls.includes(u)) urls.push(u);
    };

    const { sheetId, gid } = getSheetIdAndGid(raw);
    addUnique(toCsvUrl(raw));

    if (sheetId) {
        addUnique(`https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gid}`);
        addUnique(`https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv`);
        addUnique(`https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&gid=${gid}`);
        addUnique(`https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv`);
        addUnique(`https://docs.google.com/spreadsheets/d/${sheetId}/pub?output=csv&gid=${gid}`);
        addUnique(`https://docs.google.com/spreadsheets/d/${sheetId}/pub?output=csv`);
    }

    // Handle published links and force csv output when possible.
    if (/docs\.google\.com\/spreadsheets/i.test(raw)) {
        const csvByOutput = raw.replace(/output=[^&#]*/i, 'output=csv');
        addUnique(csvByOutput);
        if (!/output=csv/i.test(raw)) {
            addUnique(`${raw}${raw.includes('?') ? '&' : '?'}output=csv`);
        }
    }

    return urls;
}

function parseCsv(text) {
    const source = String(text || '').replace(/^\uFEFF/, '');
    if (!source.trim()) return [];

    const records = [];
    let currentField = '';
    let currentRecord = [];
    let inQuotes = false;

    for (let i = 0; i < source.length; i += 1) {
        const ch = source[i];
        const next = source[i + 1];

        if (ch === '"') {
            if (inQuotes && next === '"') {
                currentField += '"';
                i += 1;
            } else {
                inQuotes = !inQuotes;
            }
            continue;
        }

        if (ch === ',' && !inQuotes) {
            currentRecord.push(currentField.trim());
            currentField = '';
            continue;
        }

        if ((ch === '\n' || ch === '\r') && !inQuotes) {
            if (ch === '\r' && next === '\n') i += 1;
            currentRecord.push(currentField.trim());
            currentField = '';

            const hasValue = currentRecord.some((v) => String(v || '').trim() !== '');
            if (hasValue) records.push(currentRecord);
            currentRecord = [];
            continue;
        }

        currentField += ch;
    }

    if (currentField.length > 0 || currentRecord.length > 0) {
        currentRecord.push(currentField.trim());
        const hasValue = currentRecord.some((v) => String(v || '').trim() !== '');
        if (hasValue) records.push(currentRecord);
    }

    if (!records.length) return [];

    const headers = (records[0] || []).map((h) => String(h || '').trim());
    return records.slice(1).map((cols) => {
        const row = {};
        headers.forEach((h, idx) => {
            row[h] = cols[idx] || '';
        });
        return row;
    });
}

function normalizeHeader(text) {
    return String(text || '')
        .toLowerCase()
        .replace(/[\u2018\u2019\u201c\u201d'"]/g, '')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim()
        .replace(/\s+/g, ' ');
}

function getCellByHeaderTokens(row, headerTokenSets = []) {
    const entries = Object.entries(row || {});
    for (const [header, value] of entries) {
        const v = String(value || '').trim();
        if (!v) continue;
        const normalized = normalizeHeader(header);
        for (const tokens of headerTokenSets) {
            const ok = tokens.every((t) => normalized.includes(t));
            if (ok) return v;
        }
    }
    return '';
}

function normalizeDriveLink(link, type) {
    const raw = String(link || '').trim();
    if (!raw) return null;
    const firstUrlMatch = raw.match(/https?:\/\/[^\s,]+/i);
    const source = firstUrlMatch ? firstUrlMatch[0] : raw;
    const idMatch =
        source.match(/[?&]id=([a-zA-Z0-9_-]+)/) ||
        source.match(/\/file\/d\/([a-zA-Z0-9_-]+)/) ||
        source.match(/\/d\/([a-zA-Z0-9_-]+)/);
    const fileId = idMatch ? idMatch[1] : null;
    if (!fileId) return source;

    if (type === 'video') {
        return `https://drive.google.com/file/d/${fileId}/preview`;
    }
    return `https://drive.google.com/uc?export=download&id=${fileId}`;
}

async function ensureSubmissionsTable(connection) {
    await connection.query(`
        CREATE TABLE IF NOT EXISTS submissions (
            id INT PRIMARY KEY AUTO_INCREMENT,
            team_name VARCHAR(255) NOT NULL,
            team_leader VARCHAR(255) NOT NULL,
            team_members TEXT NULL,
            problem_name VARCHAR(255) NULL,
            pdf_link TEXT NULL,
            video_link TEXT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            UNIQUE KEY unique_submission (team_name, problem_name)
        )
    `);

    const alterStatements = [
        'ALTER TABLE submissions ADD COLUMN team_name VARCHAR(255) NULL',
        'ALTER TABLE submissions ADD COLUMN team_leader VARCHAR(255) NULL',
        'ALTER TABLE submissions ADD COLUMN team_members TEXT NULL',
        'ALTER TABLE submissions ADD COLUMN pdf_link TEXT NULL',
        'ALTER TABLE submissions ADD COLUMN video_link TEXT NULL'
    ];
    for (const sql of alterStatements) {
        try {
            await connection.query(sql);
        } catch (err) {
            if (!(err && (err.code === 'ER_DUP_FIELDNAME' || (err.message && err.message.toLowerCase().includes('duplicate column'))))) {
                throw err;
            }
        }
    }
}

async function tryFetchCsv(url) {
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000);
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Accept': 'text/csv,text/plain,*/*',
                'User-Agent': 'HackathonJudgingImporter/1.0'
            },
            redirect: 'follow',
            signal: controller.signal
        });
        clearTimeout(timeoutId);

        const text = await response.text();
        const contentType = response.headers.get('content-type') || '';
        const lowerBody = String(text || '').trim().toLowerCase();
        const isHtml = lowerBody.startsWith('<!doctype html') || lowerBody.startsWith('<html');
        const isCsvContentType = /text\/csv|application\/vnd\.ms-excel|text\/plain/i.test(contentType);
        const hasMultipleLines = text.split(/\r?\n/).filter(Boolean).length >= 2;
        const looksCsv = !isHtml && (isCsvContentType || (text.includes(',') && hasMultipleLines));
        return {
            ok: response.ok && looksCsv,
            status: response.status,
            contentType,
            body: text
        };
    } catch (error) {
        return { ok: false, status: 0, contentType: '', body: '', error: error.message };
    }
}

function getCell(row, keys) {
    for (const key of keys) {
        if (row[key] !== undefined && row[key] !== null && String(row[key]).trim() !== '') {
            return String(row[key]).trim();
        }
    }
    return '';
}

exports.importFromGoogleSheet = async (req, res) => {
    let connection;
    try {
        const { sheet_url } = req.body || {};
        const candidateUrls = buildCandidateCsvUrls(sheet_url);
        if (!candidateUrls.length) {
            return res.status(400).json({ success: false, message: 'sheet_url is required.' });
        }

        let csvText = '';
        const failures = [];
        for (const u of candidateUrls) {
            const r = await tryFetchCsv(u);
            if (r.ok) {
                csvText = r.body;
                break;
            }
            failures.push(`${u} -> status:${r.status}${r.error ? ` error:${r.error}` : ''}`);
        }
        if (!csvText) {
            return res.status(400).json({
                success: false,
                message: `Unable to fetch Google Sheet CSV. Use a public URL in this format: https://docs.google.com/spreadsheets/d/SHEET_ID/export?format=csv . Attempts: ${failures.join(' | ')}`
            });
        }
        const rows = parseCsv(csvText);

        connection = await pool.getConnection();
        await ensureSubmissionsTable(connection);

        let imported = 0;
        let skipped = 0;
        const skipDetails = [];
        for (let i = 0; i < rows.length; i += 1) {
            const row = rows[i];
            const teamName = getCellByHeaderTokens(row, [
                ['team', 'name'],
                ['group', 'name']
            ]);
            const teamLeader = getCellByHeaderTokens(row, [
                ['team', 'leader', 'name'],
                ['team', 'leader']
            ]);
            const teamMembers = getCellByHeaderTokens(row, [
                ['team', 'members', 'name'],
                ['team', 'member', 'name'],
                ['members', 'name']
            ]);
            const problemName = getCellByHeaderTokens(row, [
                ['problem', 'name'],
                ['challenge', 'name']
            ]);
            const rawPdf = getCellByHeaderTokens(row, [
                ['upload', 'project', 'documentation', 'pdf'],
                ['project', 'documentation', 'pdf'],
                ['documentation', 'pdf'],
                ['documentation', 'file']
            ]);
            const rawVideo = getCellByHeaderTokens(row, [
                ['upload', 'project', 'demo', 'video'],
                ['project', 'demo', 'video'],
                ['demo', 'video'],
                ['video', 'file']
            ]);

            const pdfUrl = normalizeDriveLink(rawPdf, 'pdf');
            const videoUrl = normalizeDriveLink(rawVideo, 'video');

            if (!teamName || (!pdfUrl && !videoUrl)) {
                skipped += 1;
                if (skipDetails.length < 10) {
                    const reasons = [];
                    if (!teamName) reasons.push('missing Team Name');
                    if (!pdfUrl && !videoUrl) reasons.push('missing PDF/Video link');
                    skipDetails.push({
                        row: i + 2,
                        reason: reasons.join(', ') || 'invalid row'
                    });
                }
                continue;
            }
            const safeTeamLeader = teamLeader || 'N/A';

            await connection.query(
                `
                INSERT INTO submissions
                    (team_name, team_leader, team_members, problem_name, pdf_link, video_link)
                VALUES (?, ?, ?, ?, ?, ?)
                ON DUPLICATE KEY UPDATE
                    team_leader = VALUES(team_leader),
                    team_members = VALUES(team_members),
                    pdf_link = VALUES(pdf_link),
                    video_link = VALUES(video_link),
                    updated_at = CURRENT_TIMESTAMP
                `,
                [teamName, safeTeamLeader, teamMembers || null, problemName || null, pdfUrl, videoUrl]
            );
            imported += 1;
        }

        return res.json({
            success: true,
            data: { imported, skipped, totalRows: rows.length, skipDetails }
        });
    } catch (error) {
        console.error('importFromGoogleSheet error:', error);
        return res.status(500).json({ success: false, message: 'Server error' });
    } finally {
        if (connection) connection.release();
    }
};

exports.getSubmissions = async (req, res) => {
    let connection;
    try {
        connection = await pool.getConnection();
        await ensureSubmissionsTable(connection);

        const [rows] = await connection.query(`SELECT * FROM submissions ORDER BY updated_at DESC`);
        return res.json({ success: true, data: rows });
    } catch (error) {
        console.error('getSubmissions error:', error);
        return res.status(500).json({ success: false, message: 'Server error' });
    } finally {
        if (connection) connection.release();
    }
};
