#!/bin/bash

# Cloudflare Deployment Script for Team Task Manager
# This script automates the deployment process

set -e  # Exit on error

echo "🚀 Team Task Manager - Cloudflare Deployment"
echo "==========================================="
echo ""

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Function to print colored output
print_success() {
    echo -e "${GREEN}✓ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠ $1${NC}"
}

print_error() {
    echo -e "${RED}✗ $1${NC}"
}

# Check if wrangler is available
if ! command -v npx &> /dev/null; then
    print_error "npm/npx not found. Please install Node.js and npm."
    exit 1
fi

print_success "Found npm/npx"

# Step 1: Check authentication
echo ""
echo "Step 1: Checking Cloudflare authentication..."
if ! npx wrangler whoami &> /dev/null; then
    print_warning "Not logged in to Cloudflare"
    echo "Running: npx wrangler login"
    npx wrangler login
else
    print_success "Already logged in to Cloudflare"
fi

# Step 2: Verify database
echo ""
echo "Step 2: Verifying D1 database..."
DB_ID=$(grep "database_id" wrangler.toml | cut -d'"' -f2)
if [ -z "$DB_ID" ]; then
    print_warning "Database ID not found in wrangler.toml"
    echo "You may need to create a D1 database:"
    echo "  npx wrangler d1 create task-manager-db"
    echo ""
    read -p "Continue anyway? (y/n) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
else
    print_success "Found D1 database: $DB_ID"
fi

# Step 3: Deploy
echo ""
echo "Step 3: Deploying worker..."
echo ""
read -p "Deploy to production? (y for production, n for dev) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo "Deploying to production..."
    npx wrangler deploy
    ENV="production"
else
    echo "Deploying to dev environment..."
    npx wrangler deploy --env dev
    ENV="dev"
fi

print_success "Deployment complete!"

# Show next steps
echo ""
echo "==========================================="
echo "🎉 Deployment Successful!"
echo "==========================================="
echo ""
echo "Next steps in DEPLOYMENT.md"
echo ""
