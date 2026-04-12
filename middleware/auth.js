const { supabaseAnon } = require('../services/supabase');

module.exports = async function requireAuth(req, res, next) {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.startsWith('Bearer ')
        ? authHeader.replace('Bearer ', '')
        : null;

    if (!token) {
        return res.status(401).json({ error: 'No token provided' });
    }

    const { data: { user }, error } = await supabaseAnon.auth.getUser(token);

    if (error || !user) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    req.user = user;
    req.token = token;
    next();
};
