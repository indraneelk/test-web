#!/bin/bash
# Cloudflare Deployment Script
# Usage: ./deploy.sh

set -e  # Exit on error

echo "🚀 Starting Cloudflare Deployment..."
echo ""

# Check if wrangler is installed
if ! command -v wrangler &> /dev/null; then
    echo "❌ Wrangler CLI not found. Installing..."
    npm install -g wrangler
fi

# Check if logged in
echo "Checking Cloudflare authentication..."
if ! wrangler whoami &> /dev/null; then
    echo "Please log in to Cloudflare:"
    wrangler login
fi

echo ""
echo "✅ Wrangler authenticated"
echo ""

# Step 1: Check if database_id is set
DATABASE_ID=$(grep "database_id" wrangler.toml | sed 's/.*= *"\(.*\)".*/\1/')

if [ -z "$DATABASE_ID" ] || [ "$DATABASE_ID" = "" ]; then
    echo "📦 Creating D1 database..."
    echo ""

    wrangler d1 create task-manager-db

    echo ""
    echo "⚠️  Please update wrangler.toml with the database_id from above"
    echo "   Edit line 9 of wrangler.toml and paste the database_id"
    echo "   Then run this script again."
    echo ""
    exit 0
fi

echo "✅ Database ID configured: $DATABASE_ID"
echo ""

# Step 2: Run migrations
echo "📊 Running database migrations..."
echo ""

# Check if migrations have been run
MIGRATION_CHECK=$(wrangler d1 execute task-manager-db --command "SELECT name FROM sqlite_master WHERE type='table' AND name='users'" 2>&1 || echo "error")

if echo "$MIGRATION_CHECK" | grep -q "error\|no such table"; then
    echo "Running initial schema..."
    wrangler d1 execute task-manager-db --file=./migrations/0001_initial_schema.sql

    echo "Running migration 002..."
    wrangler d1 execute task-manager-db --file=./migrations/002_add_color_to_projects.sql 2>/dev/null || echo "Migration 002 already applied or not needed"

    echo "Running migration 003..."
    wrangler d1 execute task-manager-db --file=./migrations/003_add_is_personal_to_projects.sql 2>/dev/null || echo "Migration 003 already applied or not needed"

    echo "Running migration 004..."
    wrangler d1 execute task-manager-db --file=./migrations/004_add_initials_to_users.sql 2>/dev/null || echo "Migration 004 already applied or not needed"

    echo "Running migration 005..."
    wrangler d1 execute task-manager-db --file=./migrations/005_add_supabase_support.sql 2>/dev/null || echo "Migration 005 already applied or not needed"

    echo ""
    echo "✅ Migrations completed"
else
    echo "✅ Database already initialized"
fi

echo ""

# Step 2.5: Migrate existing data (optional)
if [ -d "data" ] && [ "$(ls -A data/*.json 2>/dev/null)" ]; then
    echo "📦 Found local JSON data files..."
    echo ""
    read -p "Would you like to migrate local data to D1? (y/n) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        echo "🔄 Migrating data from JSON to D1..."
        node migrate-data-to-d1.js --execute
        echo ""
        echo "✅ Data migration completed"
    else
        echo "⏭️  Skipping data migration"
    fi
else
    echo "ℹ️  No local data files found (data/*.json), skipping migration"
fi

echo ""

# Step 3: Check secrets
echo "🔐 Checking secrets..."
echo ""

SECRETS=$(wrangler secret list 2>&1 || echo "")

if ! echo "$SECRETS" | grep -q "SUPABASE_ANON_KEY"; then
    echo "⚠️  Missing secret: SUPABASE_ANON_KEY"
    echo "   Please set it with: wrangler secret put SUPABASE_ANON_KEY"
    echo ""
    echo "   Get your keys from:"
    echo "   https://app.supabase.com → Your Project → Settings → API"
    echo ""

    read -p "Would you like to set secrets now? (y/n) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        echo "Enter your Supabase anon key:"
        wrangler secret put SUPABASE_ANON_KEY

        echo "Enter your Supabase service role key:"
        wrangler secret put SUPABASE_SERVICE_ROLE_KEY

        echo "Enter a session secret (or press Enter to generate):"
        read SESSION_SECRET
        if [ -z "$SESSION_SECRET" ]; then
            SESSION_SECRET=$(openssl rand -base64 32 2>/dev/null || date | md5sum | cut -c1-32)
        fi
        echo "$SESSION_SECRET" | wrangler secret put SESSION_SECRET

        echo ""
        echo "✅ Secrets configured"
    else
        echo "Please run: wrangler secret put SUPABASE_ANON_KEY"
        echo "Then run this script again."
        exit 0
    fi
else
    echo "✅ Secrets configured"
fi

echo ""

# Step 4: Deploy Worker
echo "🔧 Deploying Worker..."
echo ""
wrangler deploy

echo ""
echo "✅ Worker deployed"
echo ""

# Step 5: Deploy Pages
echo "📄 Deploying Pages..."
echo ""
wrangler pages deploy public --project-name=team-task-manager

echo ""
echo "✅ Pages deployed"
echo ""

# Step 6: Get deployment URLs
WORKER_URL=$(wrangler deployments list 2>&1 | grep -o 'https://[^[:space:]]*' | head -1 || echo "Check Cloudflare dashboard")
PAGES_URL="https://team-task-manager.pages.dev"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🎉 Deployment Complete!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Your application is live at:"
echo ""
echo "  Frontend: $PAGES_URL"
echo "  API:      $WORKER_URL"
echo ""
echo "Test endpoints:"
echo "  Health:   $WORKER_URL/api/health"
echo "  DB Check: $WORKER_URL/api/db-check"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Next steps:"
echo "  1. Visit $PAGES_URL"
echo "  2. Sign up with email or magic link"
echo "  3. Create your first project and tasks"
echo ""
echo "Documentation: ./DEPLOY_NOW.md"
echo ""
