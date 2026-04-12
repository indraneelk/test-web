const { createClient } = require('@supabase/supabase-js');

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
    console.error('FATAL: SUPABASE_URL and SUPABASE_ANON_KEY must be set in .env');
    process.exit(1);
}

const supabaseAnon = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY
);

let supabaseAdmin = null;
if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
    supabaseAdmin = createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_SERVICE_ROLE_KEY
    );
}

module.exports = { supabaseAnon, supabaseAdmin };
