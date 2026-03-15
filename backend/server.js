const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();
const pool = require('./config/database');

const authRoutes = require('./routes/authRoutes');
const eventRoutes = require('./routes/eventRoutes');
const participantRoutes = require('./routes/participantRoutes');
const panelistRoutes = require('./routes/panelistRoutes');
const studentRoutes = require('./routes/studentRoutes');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend/public')));

const ADMIN_BASE = '/admin';

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/events', eventRoutes);
app.use('/api/participants', participantRoutes);
app.use('/api/panelists', panelistRoutes);
app.use('/api/students', studentRoutes);

// Health check
app.get('/api/health', (req, res) => {
    res.json({ status: 'Server is running' });
});

// Admin login/dashboard paths
app.get(ADMIN_BASE, (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/public/admin/index.html'));
});
app.get(`${ADMIN_BASE}/dashboard.html`, (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/public/admin/dashboard.html'));
});
app.get(`${ADMIN_BASE}/`, (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/public/admin/index.html'));
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({
        success: false,
        message: 'Route not found'
    });
});

// Error handler
app.use((err, req, res, next) => {
    console.error('Server error:', err);
    res.status(500).json({
        success: false,
        message: 'Internal server error'
    });
});

const PORT = process.env.PORT || 5000;

async function startServer() {
    try {
        const connection = await pool.getConnection();
        connection.release();
        console.log('Database connected successfully');

        app.listen(PORT, () => {
            console.log(`Server running on http://localhost:${PORT}`);
            console.log(`Admin login: http://localhost:${PORT}${ADMIN_BASE}`);
            console.log(`Panelist login: http://localhost:${PORT}/panelist`);
        });
    } catch (err) {
        console.error('Database connection failed:', err.message);
        process.exit(1);
    }
}

startServer();
