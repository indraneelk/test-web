const express = require('express');
const router = express.Router();
const requireAuth = require('../middleware/auth');
const { supabaseAdmin } = require('../services/supabase');

// GET /api/auth/me — return current user's profile from profiles table
router.get('/me', requireAuth, async (req, res, next) => {
    try {
        const { data: profile, error } = await supabaseAdmin
            .from('profiles')
            .select('*')
            .eq('id', req.user.id)
            .single();

        if (error || !profile) {
            return res.status(404).json({ error: 'Profile not found' });
        }

        res.json({ user: profile });
    } catch (err) {
        next(err);
    }
});

// PUT /api/auth/profile — update current user's profile
router.put('/profile', requireAuth, async (req, res, next) => {
    try {
        const { name, color, avatar_url, username } = req.body;

        const updates = {};
        if (name !== undefined) updates.name = name;
        if (color !== undefined) updates.color = color;
        if (avatar_url !== undefined) updates.avatar_url = avatar_url;
        if (username !== undefined) updates.username = username;

        if (Object.keys(updates).length === 0) {
            return res.status(400).json({ error: 'No valid fields to update' });
        }

        const { data: profile, error } = await supabaseAdmin
            .from('profiles')
            .update(updates)
            .eq('id', req.user.id)
            .select()
            .single();

        if (error) {
            if (error.code === '23505') {
                return res.status(409).json({ error: 'Username already taken' });
            }
            return res.status(400).json({ error: error.message });
        }

        res.json({ user: profile });
    } catch (err) {
        next(err);
    }
});

// GET /api/auth/users — list all profiles (authenticated users can see the user list for project member selection)
router.get('/users', requireAuth, async (req, res, next) => {
    try {
        const { data: profiles, error } = await supabaseAdmin
            .from('profiles')
            .select('id, name, username, color, role, avatar_url, created_at')
            .order('name');

        if (error) return res.status(500).json({ error: error.message });

        res.json(profiles);
    } catch (err) {
        next(err);
    }
});

module.exports = router;
