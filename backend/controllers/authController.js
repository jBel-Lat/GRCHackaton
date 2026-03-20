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

async function resolveAdminRole(connection, admin) {
    let role = 'admin';

    try {
        const [roleRows] = await connection.query(
            `SELECT ar.role_name
             FROM admin a
             LEFT JOIN admin_role ar ON ar.id = a.role_id
             WHERE a.id = ?
             LIMIT 1`,
            [admin.id]
        );
        if (roleRows.length && roleRows[0].role_name) {
            role = String(roleRows[0].role_name).trim().toLowerCase();
            return role || 'admin';
        }
    } catch (err) {
        // ignore missing table/column and try legacy role sources
        const message = String(err?.message || '');
        const ignore = err?.code === 'ER_NO_SUCH_TABLE'
            || message.includes("doesn't exist")
            || message.includes('Unknown column');
        if (!ignore) {
            throw err;
        }
    }

    try {
        // Prefer role column from admin table if it exists.
        const [adminRoleRows] = await connection.query(
            'SELECT role FROM admin WHERE id = ? LIMIT 1',
            [admin.id]
        );
        if (adminRoleRows.length && adminRoleRows[0].role) {
            role = String(adminRoleRows[0].role).trim().toLowerCase();
            return role || 'admin';
        }
    } catch (err) {
        // ignore missing column and try users fallback
        if (!(err && err.message && err.message.includes('Unknown column'))) {
            throw err;
        }
    }

    try {
        // Optional compatibility fallback if role is stored in users table.
        const [userRoleRows] = await connection.query(
            'SELECT role FROM users WHERE LOWER(TRIM(username)) = LOWER(TRIM(?)) LIMIT 1',
            [admin.username]
        );
        if (userRoleRows.length && userRoleRows[0].role) {
            role = String(userRoleRows[0].role).trim().toLowerCase();
        }
    } catch (err) {
        // Ignore if users table does not exist.
        if (!(err && (err.code === 'ER_NO_SUCH_TABLE' || (err.message && err.message.includes("doesn't exist"))))) {
            throw err;
        }
    }

    return role || 'admin';
}

exports.adminLogin = async (req, res) => {
    let connection;
    try {
        const username = (req.body?.username || '').trim();
        const password = req.body?.password || '';

        if (!username || !password) {
            return res.status(400).json({
                success: false,
                message: ERROR_MESSAGES.MISSING_REQUIRED_FIELDS
            });
        }

        connection = await pool.getConnection();
        const [rows] = await connection.query(
            'SELECT * FROM admin WHERE LOWER(TRIM(username)) = LOWER(TRIM(?)) LIMIT 1',
            [username]
        );

        const admin = rows[0];
        if (!admin) {
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
            try {
                const newHash = await bcrypt.hash(inputPassword, 10);
                await connection.query('UPDATE admin SET password = ? WHERE id = ?', [newHash, admin.id]);
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
            try {
                const newHash = await bcrypt.hash(inputPassword.trim(), 10);
                await connection.query('UPDATE admin SET password = ? WHERE id = ?', [newHash, admin.id]);
                admin.password = newHash;
            } catch (err) {
                console.error('Admin password upgrade failed (ignored):', err.code || err.message);
            }
        }

        if (!passwordMatch) {
            return res.status(401).json({
                success: false,
                message: ERROR_MESSAGES.INVALID_CREDENTIALS
            });
        }

        const role = await resolveAdminRole(connection, admin);

        if (role !== 'admin') {
            return res.status(403).json({
                success: false,
                message: 'Forbidden: account does not have admin role'
            });
        }

        const token = jwt.sign(
            {
                id: admin.id,
                username: admin.username,
                role
            },
            process.env.JWT_SECRET,
            { expiresIn: '24h' }
        );

        const isSecure = process.env.NODE_ENV === 'production';
        res.cookie('admin_token', token, {
            httpOnly: true,
            sameSite: 'lax',
            secure: isSecure,
            maxAge: 24 * 60 * 60 * 1000,
            path: '/'
        });

        res.json({
            success: true,
            message: SUCCESS_MESSAGES.LOGIN_SUCCESS,
            token,
            user: {
                id: admin.id,
                username: admin.username,
                full_name: admin.full_name,
                role
            }
        });
    } catch (error) {
        console.error('Admin login error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    } finally {
        if (connection) connection.release();
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
        const name = String(req.body?.name || '').trim();
        const student_number = String(req.body?.student_number || '').trim();

        if (!name || !student_number) {
            return res.status(400).json({
                success: false,
                message: ERROR_MESSAGES.MISSING_REQUIRED_FIELDS
            });
        }

        const connection = await pool.getConnection();
        let [rows] = await connection.query(
            'SELECT * FROM student WHERE student_number = ? LIMIT 1',
            [student_number]
        );

        if (rows.length > 0) {
            const existingStudent = rows[0];
            const sameName = String(existingStudent.name || '').trim().toLowerCase() === name.toLowerCase();
            connection.release();

            if (!sameName) {
                return res.status(401).json({
                    success: false,
                    message: 'Student name and ID do not match'
                });
            }

            if (existingStudent.status !== 'active') {
                return res.status(403).json({
                    success: false,
                    message: 'Your account is inactive'
                });
            }

            const token = jwt.sign(
                {
                    id: existingStudent.id,
                    student_number: existingStudent.student_number,
                    role: 'student'
                },
                process.env.JWT_SECRET,
                { expiresIn: '24h' }
            );

            return res.json({
                success: true,
                message: SUCCESS_MESSAGES.LOGIN_SUCCESS,
                token,
                user: {
                    id: existingStudent.id,
                    name: existingStudent.name,
                    student_number: existingStudent.student_number
                }
            });
        }

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
                    'SELECT * FROM student WHERE student_number = ? LIMIT 1',
                    [student_number]
                );
            } catch (insertErr) {
                // Handle duplicate insert race by reloading the same student_number.
                if (insertErr && insertErr.code === 'ER_DUP_ENTRY') {
                    [rows] = await connection.query(
                        'SELECT * FROM student WHERE student_number = ? LIMIT 1',
                        [student_number]
                    );
                } else {
                    connection.release();
                    console.error('Auto-create student failed:', insertErr.message);
                    return res.status(500).json({
                        success: false,
                        message: 'Unable to create student account'
                    });
                }
            }
        }

        connection.release();

        if (rows.length === 0) {
            return res.status(500).json({
                success: false,
                message: 'Student account not found'
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
