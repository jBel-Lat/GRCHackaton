const pool = require('../config/database');
const { SUCCESS_MESSAGES, ERROR_MESSAGES } = require('../config/constants');

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

async function insertCriteriaCompat(connection, eventId, criteriaName, details, percentage) {
    const inserts = [
        {
            sql: 'INSERT INTO criteria (event_id, criteria_name, criteria_details, percentage, max_score) VALUES (?, ?, ?, ?, ?)',
            params: [eventId, criteriaName, details || null, percentage, percentage]
        },
        {
            sql: 'INSERT INTO criteria (event_id, criteria_name, details, percentage, max_score) VALUES (?, ?, ?, ?, ?)',
            params: [eventId, criteriaName, details || null, percentage, percentage]
        },
        {
            sql: 'INSERT INTO criteria (event_id, criteria_name, description, percentage, max_score) VALUES (?, ?, ?, ?, ?)',
            params: [eventId, criteriaName, details || null, percentage, percentage]
        },
        {
            sql: 'INSERT INTO criteria (event_id, criteria_name, percentage, max_score) VALUES (?, ?, ?, ?)',
            params: [eventId, criteriaName, percentage, percentage]
        }
    ];

    for (const query of inserts) {
        try {
            await connection.query(query.sql, query.params);
            return;
        } catch (err) {
            if (!(err.message && err.message.includes('Unknown column'))) {
                throw err;
            }
        }
    }
}

async function updateCriteriaCompat(connection, criteriaId, criteriaName, details, percentage) {
    const updates = [
        {
            sql: 'UPDATE criteria SET criteria_name = ?, criteria_details = ?, percentage = ?, max_score = ? WHERE id = ?',
            params: [criteriaName, details || null, percentage, percentage, criteriaId]
        },
        {
            sql: 'UPDATE criteria SET criteria_name = ?, details = ?, percentage = ?, max_score = ? WHERE id = ?',
            params: [criteriaName, details || null, percentage, percentage, criteriaId]
        },
        {
            sql: 'UPDATE criteria SET criteria_name = ?, description = ?, percentage = ?, max_score = ? WHERE id = ?',
            params: [criteriaName, details || null, percentage, percentage, criteriaId]
        },
        {
            sql: 'UPDATE criteria SET criteria_name = ?, percentage = ?, max_score = ? WHERE id = ?',
            params: [criteriaName, percentage, percentage, criteriaId]
        }
    ];

    for (const query of updates) {
        try {
            await connection.query(query.sql, query.params);
            return;
        } catch (err) {
            if (!(err.message && err.message.includes('Unknown column'))) {
                throw err;
            }
        }
    }
}

// Get all events
exports.getAllEvents = async (req, res) => {
    try {
        const connection = await pool.getConnection();
        
        const [events] = await connection.query(
            'SELECT * FROM event ORDER BY created_at DESC'
        );
        
        // Ensure is_tournament field exists for all events
        const eventsWithTournament = events.map(event => ({
            ...event,
            is_tournament: event.is_tournament ? 1 : 0
        }));
        
        connection.release();

        res.json({
            success: true,
            data: eventsWithTournament
        });
    } catch (error) {
        console.error('Get events error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error: ' + error.message
        });
    }
};

// Get event details with criteria
exports.getEventDetails = async (req, res) => {
    try {
        const { id } = req.params;

        const connection = await pool.getConnection();
        
        // Get event details
        const [eventData] = await connection.query(
            'SELECT * FROM event WHERE id = ?',
            [id]
        );

        if (eventData.length === 0) {
            connection.release();
            return res.status(404).json({
                success: false,
                message: ERROR_MESSAGES.EVENT_NOT_FOUND
            });
        }

        // Get criteria for event
        const criteria = await getCriteriaWithDetailsCompat(connection, id);

        connection.release();

        res.json({
            success: true,
            data: {
                event: eventData[0],
                criteria
            }
        });
    } catch (error) {
        console.error('Get event details error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
};

// Create new event
exports.createEvent = async (req, res) => {
    try {
        const { event_name, description, start_date, end_date, is_elimination, is_tournament, criteria } = req.body;
        const adminId = req.user.id;

        if (!event_name) {
            return res.status(400).json({
                success: false,
                message: ERROR_MESSAGES.MISSING_REQUIRED_FIELDS
            });
        }

        // Criteria are required only if not a tournament event
        if (!is_tournament && (!criteria || criteria.length === 0)) {
            return res.status(400).json({
                success: false,
                message: 'Please add at least one criteria (or mark as Tournament Event to skip)'
            });
        }

        if (Array.isArray(criteria) && criteria.length > 0) {
            const totalPercentage = criteria.reduce((sum, crit) => sum + (parseFloat(crit.percentage) || 0), 0);
            if (totalPercentage > 100) {
                return res.status(400).json({
                    success: false,
                    message: 'Total criteria percentage cannot exceed 100%.'
                });
            }
        }

        const connection = await pool.getConnection();
        
        // Try to insert with is_tournament column
        let eventResult;
        try {
            [eventResult] = await connection.query(
                'INSERT INTO event (event_name, description, start_date, end_date, is_elimination, is_tournament, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
                [event_name, description, start_date, end_date, is_elimination ? true : false, is_tournament ? true : false, adminId]
            );
        } catch (err) {
            // If is_tournament column doesn't exist, insert without it
            if (err.message.includes('Unknown column')) {
                console.warn('is_tournament column does not exist yet, inserting without it');
                [eventResult] = await connection.query(
                    'INSERT INTO event (event_name, description, start_date, end_date, is_elimination, created_by) VALUES (?, ?, ?, ?, ?, ?)',
                    [event_name, description, start_date, end_date, is_elimination ? true : false, adminId]
                );
            } else {
                throw err;
            }
        }

        const eventId = eventResult.insertId;

        // Insert criteria if provided
        if (criteria && criteria.length > 0) {
            for (const crit of criteria) {
                const details = (crit.criteria_details || crit.details || crit.description || '').trim();
                await insertCriteriaCompat(connection, eventId, crit.criteria_name, details, crit.percentage);
            }
        }

        connection.release();

        res.status(201).json({
            success: true,
            message: SUCCESS_MESSAGES.CREATED_SUCCESS,
            data: { event_id: eventId }
        });
    } catch (error) {
        console.error('Create event error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error: ' + error.message
        });
    }
};

// Update event
exports.updateEvent = async (req, res) => {
    try {
        const { id } = req.params;
        const { event_name, description, start_date, end_date, status, is_elimination, is_tournament } = req.body;

        const connection = await pool.getConnection();
        
        // Try to update with is_tournament column
        try {
            await connection.query(
                'UPDATE event SET event_name = ?, description = ?, start_date = ?, end_date = ?, status = ?, is_elimination = ?, is_tournament = ? WHERE id = ?',
                [event_name, description, start_date, end_date, status, is_elimination ? true : false, is_tournament ? true : false, id]
            );
        } catch (err) {
            // If is_tournament column doesn't exist, update without it
            if (err.message.includes('Unknown column')) {
                console.warn('is_tournament column does not exist yet, updating without it');
                await connection.query(
                    'UPDATE event SET event_name = ?, description = ?, start_date = ?, end_date = ?, status = ?, is_elimination = ? WHERE id = ?',
                    [event_name, description, start_date, end_date, status, is_elimination ? true : false, id]
                );
            } else {
                throw err;
            }
        }

        connection.release();

        res.json({
            success: true,
            message: SUCCESS_MESSAGES.UPDATED_SUCCESS
        });
    } catch (error) {
        console.error('Update event error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error: ' + error.message
        });
    }
};

// Delete event (cascades via foreign keys)
exports.deleteEvent = async (req, res) => {
    try {
        const { id } = req.params;
        const connection = await pool.getConnection();

        const [result] = await connection.query('DELETE FROM event WHERE id = ?', [id]);
        connection.release();

        // optionally check affectedRows but cascade should handle related data
        res.json({
            success: true,
            message: SUCCESS_MESSAGES.DELETED_SUCCESS
        });
    } catch (error) {
        console.error('Delete event error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
};

// Add criteria to event
exports.addCriteria = async (req, res) => {
    try {
        const { event_id, criteria_name, percentage, criteria_details } = req.body;

        if (!event_id || !criteria_name || !percentage) {
            return res.status(400).json({
                success: false,
                message: ERROR_MESSAGES.MISSING_REQUIRED_FIELDS
            });
        }

        const connection = await pool.getConnection();

        const [sumRows] = await connection.query(
            'SELECT COALESCE(SUM(percentage), 0) AS total FROM criteria WHERE event_id = ?',
            [event_id]
        );
        const currentTotal = parseFloat(sumRows[0]?.total) || 0;
        const nextTotal = currentTotal + (parseFloat(percentage) || 0);
        if (nextTotal > 100) {
            connection.release();
            return res.status(400).json({
                success: false,
                message: `Total criteria percentage cannot exceed 100% (current: ${currentTotal}%).`
            });
        }
        
        await insertCriteriaCompat(
            connection,
            event_id,
            criteria_name,
            (criteria_details || '').trim(),
            percentage
        );

        connection.release();

        res.status(201).json({
            success: true,
            message: SUCCESS_MESSAGES.CREATED_SUCCESS
        });
    } catch (error) {
        console.error('Add criteria error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
};

// Update criteria
exports.updateCriteria = async (req, res) => {
    try {
        const { id } = req.params;
        const { criteria_name, percentage, criteria_details } = req.body;

        if (!id || !criteria_name || percentage === undefined || percentage === null) {
            return res.status(400).json({
                success: false,
                message: ERROR_MESSAGES.MISSING_REQUIRED_FIELDS
            });
        }

        const parsedPercentage = parseFloat(percentage);
        if (!Number.isFinite(parsedPercentage) || parsedPercentage < 0 || parsedPercentage > 100) {
            return res.status(400).json({
                success: false,
                message: 'Percentage must be between 0 and 100.'
            });
        }

        const connection = await pool.getConnection();
        const [criteriaRows] = await connection.query(
            'SELECT id, event_id FROM criteria WHERE id = ? LIMIT 1',
            [id]
        );

        if (!criteriaRows.length) {
            connection.release();
            return res.status(404).json({
                success: false,
                message: 'Criteria not found'
            });
        }

        const eventId = criteriaRows[0].event_id;
        const [sumRows] = await connection.query(
            'SELECT COALESCE(SUM(percentage), 0) AS total FROM criteria WHERE event_id = ? AND id <> ?',
            [eventId, id]
        );
        const otherTotal = parseFloat(sumRows[0]?.total) || 0;
        const nextTotal = otherTotal + parsedPercentage;
        if (nextTotal > 100) {
            connection.release();
            return res.status(400).json({
                success: false,
                message: `Total criteria percentage cannot exceed 100% (others already: ${otherTotal}%).`
            });
        }

        await updateCriteriaCompat(
            connection,
            id,
            criteria_name,
            (criteria_details || '').trim(),
            parsedPercentage
        );

        connection.release();
        res.json({
            success: true,
            message: SUCCESS_MESSAGES.UPDATED_SUCCESS
        });
    } catch (error) {
        console.error('Update criteria error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
};

// Delete criteria
exports.deleteCriteria = async (req, res) => {
    try {
        const { id } = req.params;

        const connection = await pool.getConnection();
        await connection.query('DELETE FROM criteria WHERE id = ?', [id]);
        connection.release();

        res.json({
            success: true,
            message: SUCCESS_MESSAGES.DELETED_SUCCESS
        });
    } catch (error) {
        console.error('Delete criteria error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
};
