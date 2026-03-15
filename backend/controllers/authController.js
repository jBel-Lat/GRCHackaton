const pool = require('../config/database');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { ERROR_MESSAGES, SUCCESS_MESSAGES } = require('../config/constants');

async function ensureCreatorAdmin(connection) {
    const [admins] = await connection.query('SELECT id FROM admin LIMIT 1');
    if (admins.length > 0) {
        return admins[0].id;
    }

    const bootstrapUsername = 'system_admin';
    const bootstrapPassword = `sys-${Date.now()}`;
    const bootstrapFullName = 'System Admin';
    const hashedPassword = await bcrypt.hash(bootstrapPassword, 10);

    const [result] = await connection.query(
        'INSERT INTO admin (username, password, full_name) VALUES (?, ?, ?)',
        [bootstrapUsername, hashedPassword, bootstrapFullName]
    );

    return result.insertId;
}

exports.adminLogin = async (req, res) => {
    try {
        const username = (req.body?.username || '').trim();
        const password = req.body?.password || '';

        if (!username || !password) {
            return res.status(400).json({
                success: false,
                message: ERROR_MESSAGES.MISSING_REQUIRED_FIELDS
            });
        }

        const connection = await pool.getConnection();
        const [rows] = await connection.query(
            'SELECT * FROM admin WHERE LOWER(TRIM(username)) = LOWER(TRIM(?)) LIMIT 1',
            [username]
        );

        const admin = rows[0];
        if (!admin) {
            connection.release();
            return res.status(401).json({
                success: false,
                message: ERROR_MESSAGES.INVALID_CREDENTIALS
            });
        }
        let passwordMatch = false;

        const storedPassword = String(admin.password || '');
        const inputPassword = String(password || '');

        // Accept standard bcrypt prefixes: $2a$, $2b$, $2y$
        if (storedPassword && /^\$2[aby]\$/.test(storedPassword)) {
            passwordMatch = await bcrypt.compare(inputPassword, storedPassword);
        } else if (password === admin.password) {
            // plaintext stored; accept once and upgrade to bcrypt hash (best-effort, non-blocking)
            passwordMatch = true;
            connection.release(); // release early before upgrade to avoid holding locks
            try {
                const newHash = await bcrypt.hash(inputPassword, 10);
                await pool.query('UPDATE admin SET password = ? WHERE id = ?', [newHash, admin.id]); // separate connection
                admin.password = newHash;
            } catch (err) {
                console.error('Admin password upgrade failed (ignored):', err.code || err.message);
            }
        } else if (
            inputPassword.trim() === storedPassword.trim() ||
            inputPassword.trim().toLowerCase() === storedPassword.trim().toLowerCase()
        ) {
            // Legacy tolerance for plaintext passwords with accidental casing/whitespace variations.
            passwordMatch = true;
            connection.release();
            try {
                const newHash = await bcrypt.hash(inputPassword.trim(), 10);
                await pool.query('UPDATE admin SET password = ? WHERE id = ?', [newHash, admin.id]);
                admin.password = newHash;
            } catch (err) {
                console.error('Admin password upgrade failed (ignored):', err.code || err.message);
            }
        } else {
            connection.release();
        }

        if (!passwordMatch) {
            return res.status(401).json({
                success: false,
                message: ERROR_MESSAGES.INVALID_CREDENTIALS
            });
        }

        // if still held, release connection
        if (connection && connection.connection && !connection.connection._closing) {
            try { connection.release(); } catch (e) {}
        }

        const token = jwt.sign(
            {
                id: admin.id,
                username: admin.username,
                role: 'admin'
            },
            process.env.JWT_SECRET,
            { expiresIn: '24h' }
        );

        res.json({
            success: true,
            message: SUCCESS_MESSAGES.LOGIN_SUCCESS,
            token,
            user: {
                id: admin.id,
                username: admin.username,
                full_name: admin.full_name
            }
        });
    } catch (error) {
        console.error('Admin login error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
};

exports.panelistLogin = async (req, res) => {
    try {
        const { username, password } = req.body;

        if (!username || !password) {
            return res.status(400).json({
                success: false,
                message: ERROR_MESSAGES.MISSING_REQUIRED_FIELDS
            });
        }

        const connection = await pool.getConnection();
        const [rows] = await connection.query('SELECT * FROM panelist WHERE username = ?', [username]);
        connection.release();

        if (rows.length === 0) {
            return res.status(401).json({
                success: false,
                message: ERROR_MESSAGES.INVALID_CREDENTIALS
            });
        }

        const panelist = rows[0];

        if (panelist.status !== 'active') {
            return res.status(403).json({
                success: false,
                message: 'Your account is inactive'
            });
        }

        const passwordMatch = await bcrypt.compare(password, panelist.password);

        if (!passwordMatch) {
            return res.status(401).json({
                success: false,
                message: ERROR_MESSAGES.INVALID_CREDENTIALS
            });
        }

        const token = jwt.sign(
            {
                id: panelist.id,
                username: panelist.username,
                role: 'panelist'
            },
            process.env.JWT_SECRET,
            { expiresIn: '24h' }
        );

        res.json({
            success: true,
            message: SUCCESS_MESSAGES.LOGIN_SUCCESS,
            token,
            user: {
                id: panelist.id,
                username: panelist.username,
                full_name: panelist.full_name
            }
        });
    } catch (error) {
        console.error('Panelist login error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
};

// Student login (no password, use name + student_number pair)
exports.studentLogin = async (req, res) => {
    try {
        const { name, student_number } = req.body;

        if (!name || !student_number) {
            return res.status(400).json({
                success: false,
                message: ERROR_MESSAGES.MISSING_REQUIRED_FIELDS
            });
        }

        const connection = await pool.getConnection();
        let [rows] = await connection.query(
            'SELECT * FROM student WHERE name = ? AND student_number = ?',
            [name, student_number]
        );

        // If student doesn't exist, try to create one
        if (rows.length === 0) {
            try {
                const creatorId = await ensureCreatorAdmin(connection);

                await connection.query(
                    'INSERT INTO student (name, student_number, status, created_by) VALUES (?, ?, ?, ?)',
                    [name, student_number, 'active', creatorId]
                );
                // Fetch the newly created student
                [rows] = await connection.query(
                    'SELECT * FROM student WHERE name = ? AND student_number = ?',
                    [name, student_number]
                );
            } catch (insertErr) {
                console.error('Auto-create student failed:', insertErr.message);
                // Fall through and return credentials error
            }
        }

        connection.release();

        if (rows.length === 0) {
            return res.status(401).json({
                success: false,
                message: ERROR_MESSAGES.INVALID_CREDENTIALS
            });
        }

        const student = rows[0];

        if (student.status !== 'active') {
            return res.status(403).json({
                success: false,
                message: 'Your account is inactive'
            });
        }

        // create token
        const token = jwt.sign(
            {
                id: student.id,
                student_number: student.student_number,
                role: 'student'
            },
            process.env.JWT_SECRET,
            { expiresIn: '24h' }
        );

        res.json({
            success: true,
            message: SUCCESS_MESSAGES.LOGIN_SUCCESS,
            token,
            user: {
                id: student.id,
                name: student.name,
                student_number: student.student_number
            }
        });
    } catch (error) {
        console.error('Student login error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
};
