require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');

const authRoutes = require('./routes/auth');
const projectRoutes = require('./routes/projects');
const taskRoutes = require('./routes/tasks');
const adminRoutes = require('./routes/admin');
const errorHandler = require('./middleware/errors');

const app = express();
const PORT = process.env.PORT || 3000;

// Security headers
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            scriptSrc: ["'self'", "'unsafe-inline'"],
            scriptSrcAttr: ["'unsafe-inline'"],
            imgSrc: ["'self'", "data:", "https:"],
            connectSrc: ["'self'", "https://*.supabase.co", "wss://*.supabase.co"]
        }
    }
}));

// CORS
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',')
    : ['http://localhost:3000', 'http://localhost:5001'];

app.use(cors({
    origin: function (origin, callback) {
        if (!origin) return callback(null, true); // same-origin / curl
        if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
        console.warn(`Blocked CORS request from: ${origin}`);
        callback(new Error('Not allowed by CORS'));
    },
    credentials: true
}));

// Body parsing
app.use(express.json({ limit: '1mb' }));

// Serve static frontend
app.use(express.static(path.join(__dirname, 'public')));

// Serve Supabase JS from local node_modules (satisfies CSP 'self')
app.use('/vendor', express.static(path.join(__dirname, 'node_modules/@supabase/supabase-js/dist/umd')));

// Public config endpoint — no auth needed
app.get('/api/config/public', (req, res) => {
    res.json({
        supabaseUrl: process.env.SUPABASE_URL || '',
        supabaseAnonKey: process.env.SUPABASE_ANON_KEY || ''
    });
});

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/admin', adminRoutes);

// Convenience alias: /api/users maps to auth users list
app.use('/api/users', require('./routes/auth'));

// Serve frontend for all non-API routes (SPA fallback)
app.get('*', (req, res) => {
    if (!req.path.startsWith('/api')) {
        res.sendFile(path.join(__dirname, 'public', 'index.html'));
    } else {
        res.status(404).json({ error: 'Not found' });
    }
});

// Global error handler — must be last
app.use(errorHandler);

app.listen(PORT, () => {
    console.log(`Task Manager running on http://localhost:${PORT}`);
    console.log(`Supabase project: ${process.env.SUPABASE_URL || '(not set)'}`);
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
        console.warn('WARNING: SUPABASE_SERVICE_ROLE_KEY not set — server using anon key for DB queries');
    }
});

module.exports = app; // for testing
