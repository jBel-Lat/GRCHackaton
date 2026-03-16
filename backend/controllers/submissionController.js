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

function parseCsvLine(line) {
    const out = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i += 1) {
        const ch = line[i];
        if (ch === '"') {
            if (inQuotes && line[i + 1] === '"') {
                cur += '"';
                i += 1;
            } else {
                inQuotes = !inQuotes;
            }
        } else if (ch === ',' && !inQuotes) {
            out.push(cur);
            cur = '';
        } else {
            cur += ch;
        }
    }
    out.push(cur);
    return out.map((v) => v.trim());
}

function parseCsv(text) {
    const lines = String(text || '')
        .replace(/^\uFEFF/, '')
        .split(/\r?\n/)
        .filter((line) => line.trim() !== '');
    if (!lines.length) return [];

    const headers = parseCsvLine(lines[0]).map((h) => h.trim());
    return lines.slice(1).map((line) => {
        const cols = parseCsvLine(line);
        const row = {};
        headers.forEach((h, idx) => {
            row[h] = cols[idx] || '';
        });
        return row;
    });
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
        for (const row of rows) {
            const teamName = getCell(row, ['Team Name', 'team name']);
            const teamLeader = getCell(row, ['Team Leader Name', 'Team Leader', 'team leader name']);
            const teamMembers = getCell(row, ['Team Members Name', 'Team Member Name', 'team members name']);
            const problemName = getCell(row, ['Problem Name', 'problem name']);
            const rawPdf = getCell(row, ['Upload Project Documentation (PDF)', 'Upload Project Documentation', 'Project Documentation (PDF)']);
            const rawVideo = getCell(row, ['Upload Project Demo Video', 'Project Demo Video']);

            const pdfUrl = normalizeDriveLink(rawPdf, 'pdf');
            const videoUrl = normalizeDriveLink(rawVideo, 'video');

            if (!teamName || !teamLeader || (!pdfUrl && !videoUrl)) {
                skipped += 1;
                continue;
            }

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
                [teamName, teamLeader, teamMembers || null, problemName || null, pdfUrl, videoUrl]
            );
            imported += 1;
        }

        return res.json({
            success: true,
            data: { imported, skipped, totalRows: rows.length }
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
