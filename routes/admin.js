const express = require('express');
const router = express.Router();
const requireAuth = require('../middleware/auth');
const { supabaseAdmin } = require('../services/supabase');

// Middleware: require admin role (profile.role === 'admin')
async function requireAdmin(req, res, next) {
    try {
        const { data: profile, error } = await supabaseAdmin
            .from('profiles')
            .select('role')
            .eq('id', req.user.id)
            .single();

        if (error || !profile) {
            return res.status(403).json({ error: 'Admin access required' });
        }
        if (profile.role !== 'admin') {
            return res.status(403).json({ error: 'Admin access required' });
        }
        next();
    } catch (err) {
        next(err);
    }
}

// GET /api/admin/users — list all profiles
router.get('/users', requireAuth, requireAdmin, async (req, res, next) => {
    try {
        const { data: profiles, error } = await supabaseAdmin
            .from('profiles')
            .select('*')
            .order('created_at', { ascending: false });

        if (error) return res.status(500).json({ error: error.message });

        res.json(profiles);
    } catch (err) {
        next(err);
    }
});

// POST /api/admin/invite — create invitation record (and optionally send Supabase invite)
router.post('/invite', requireAuth, requireAdmin, async (req, res, next) => {
    try {
        const { email } = req.body;

        if (!email || !email.trim()) {
            return res.status(400).json({ error: 'Email is required' });
        }

        const normalizedEmail = email.toLowerCase().trim();
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(normalizedEmail)) {
            return res.status(400).json({ error: 'Invalid email format' });
        }

        // Check if invitation already exists
        const { data: existing } = await supabaseAdmin
            .from('invitations')
            .select('id, status')
            .eq('email', normalizedEmail)
            .single();

        if (existing && existing.status === 'accepted') {
            return res.status(409).json({ error: 'This email has already accepted an invitation' });
        }

        if (existing) {
            // Reset pending invitation
            const { error: updateErr } = await supabaseAdmin
                .from('invitations')
                .update({ status: 'pending', created_at: new Date().toISOString() })
                .eq('email', normalizedEmail);

            if (updateErr) return res.status(500).json({ error: updateErr.message });
        } else {
            // Create new invitation record
            const { error: insertErr } = await supabaseAdmin
                .from('invitations')
                .insert({
                    email: normalizedEmail,
                    invited_by: req.user.id,
                    status: 'pending'
                });

            if (insertErr) return res.status(400).json({ error: insertErr.message });
        }

        await supabaseAdmin.from('activity_log').insert({
            user_id: req.user.id,
            action: 'invitation_sent',
            details: { email: normalizedEmail }
        });

        res.status(201).json({
            message: 'Invitation created successfully',
            email: normalizedEmail
        });
    } catch (err) {
        next(err);
    }
});

// GET /api/admin/invitations — list all invitations
router.get('/invitations', requireAuth, requireAdmin, async (req, res, next) => {
    try {
        const { data: invitations, error } = await supabaseAdmin
            .from('invitations')
            .select('*')
            .order('created_at', { ascending: false });

        if (error) return res.status(500).json({ error: error.message });

        res.json({ invitations });
    } catch (err) {
        next(err);
    }
});

// GET /api/admin/activity — view activity log (admin only)
router.get('/activity', requireAuth, requireAdmin, async (req, res, next) => {
    try {
        const limit = Math.min(parseInt(req.query.limit) || 100, 500);

        const { data: activity, error } = await supabaseAdmin
            .from('activity_log')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(limit);

        if (error) return res.status(500).json({ error: error.message });

        res.json(activity);
    } catch (err) {
        next(err);
    }
});

module.exports = router;
