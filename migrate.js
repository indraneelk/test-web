#!/usr/bin/env node

/**
 * Database Migration Runner
 * Tracks and executes database schema migrations
 *
 * Usage:
 *   node migrate.js up            - Run all pending migrations
 *   node migrate.js down           - Rollback last migration
 *   node migrate.js create <name>  - Create new migration file
 *   node migrate.js status         - Show migration status
 */

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { DATABASE } = require('./shared/constants');

const MIGRATIONS_DIR = path.join(__dirname, DATABASE.MIGRATIONS_DIR);
const MIGRATIONS_FILE = path.join(__dirname, 'data', 'migrations.json');

// Ensure migrations directory exists
if (!fs.existsSync(MIGRATIONS_DIR)) {
    fs.mkdirSync(MIGRATIONS_DIR, { recursive: true });
}

// Ensure data directory exists
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

/**
 * Get list of applied migrations
 * @returns {Array<string>} List of applied migration names
 */
function getAppliedMigrations() {
    if (!fs.existsSync(MIGRATIONS_FILE)) {
        return [];
    }
    const data = fs.readFileSync(MIGRATIONS_FILE, 'utf8');
    return JSON.parse(data);
}

/**
 * Save applied migrations
 * @param {Array<string>} migrations - List of applied migration names
 */
function saveAppliedMigrations(migrations) {
    fs.writeFileSync(MIGRATIONS_FILE, JSON.stringify(migrations, null, 2));
}

/**
 * Get list of all migration files
 * @returns {Array<Object>} List of migration files with name and path
 */
function getAllMigrations() {
    const files = fs.readdirSync(MIGRATIONS_DIR)
        .filter(f => f.endsWith('.js'))
        .sort();

    return files.map(file => ({
        name: file.replace('.js', ''),
        path: path.join(MIGRATIONS_DIR, file)
    }));
}

/**
 * Get list of pending migrations
 * @returns {Array<Object>} List of pending migrations
 */
function getPendingMigrations() {
    const applied = getAppliedMigrations();
    const all = getAllMigrations();
    return all.filter(m => !applied.includes(m.name));
}

/**
 * Run migration up
 * @param {Object} migration - Migration object
 */
async function runMigrationUp(migration) {
    console.log(`Running migration: ${migration.name}`);
    const mod = require(migration.path);

    if (typeof mod.up !== 'function') {
        throw new Error(`Migration ${migration.name} missing 'up' function`);
    }

    await mod.up();
    console.log(`✅ Migrated: ${migration.name}`);
}

/**
 * Run migration down
 * @param {Object} migration - Migration object
 */
async function runMigrationDown(migration) {
    console.log(`Rolling back migration: ${migration.name}`);
    const mod = require(migration.path);

    if (typeof mod.down !== 'function') {
        throw new Error(`Migration ${migration.name} missing 'down' function`);
    }

    await mod.down();
    console.log(`✅ Rolled back: ${migration.name}`);
}

/**
 * Run all pending migrations
 */
async function migrateUp() {
    const pending = getPendingMigrations();

    if (pending.length === 0) {
        console.log('✅ No pending migrations');
        return;
    }

    console.log(`Found ${pending.length} pending migration(s)\n`);

    const applied = getAppliedMigrations();

    for (const migration of pending) {
        try {
            await runMigrationUp(migration);
            applied.push(migration.name);
            saveAppliedMigrations(applied);
        } catch (error) {
            console.error(`❌ Migration failed: ${migration.name}`);
            console.error(error);
            process.exit(1);
        }
    }

    console.log('\n✅ All migrations completed successfully');
}

/**
 * Rollback last migration
 */
async function migrateDown() {
    const applied = getAppliedMigrations();

    if (applied.length === 0) {
        console.log('✅ No migrations to rollback');
        return;
    }

    const lastMigrationName = applied[applied.length - 1];
    const allMigrations = getAllMigrations();
    const migration = allMigrations.find(m => m.name === lastMigrationName);

    if (!migration) {
        console.error(`❌ Migration file not found: ${lastMigrationName}`);
        process.exit(1);
    }

    try {
        await runMigrationDown(migration);
        applied.pop();
        saveAppliedMigrations(applied);
        console.log('\n✅ Rollback completed successfully');
    } catch (error) {
        console.error(`❌ Rollback failed: ${lastMigrationName}`);
        console.error(error);
        process.exit(1);
    }
}

/**
 * Create new migration file
 * @param {string} name - Migration name
 */
function createMigration(name) {
    if (!name) {
        console.error('❌ Migration name required');
        console.log('Usage: node migrate.js create <name>');
        process.exit(1);
    }

    const timestamp = Date.now();
    const filename = `${timestamp}_${name.replace(/\s+/g, '_')}.js`;
    const filepath = path.join(MIGRATIONS_DIR, filename);

    const template = `/**
 * Migration: ${name}
 * Created: ${new Date().toISOString()}
 */

const fs = require('fs');
const path = require('path');

/**
 * Run migration
 */
async function up() {
    console.log('Running migration: ${name}');

    // Add your migration code here
    // Example: Modify data files, update schema, etc.

    // For JSON file storage:
    // const dataPath = path.join(__dirname, '..', 'data', 'tasks.json');
    // const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
    // // Modify data
    // fs.writeFileSync(dataPath, JSON.stringify(data, null, 2));

    // For D1 database:
    // Execute SQL statements via Wrangler CLI or API
}

/**
 * Rollback migration
 */
async function down() {
    console.log('Rolling back migration: ${name}');

    // Add your rollback code here
    // This should undo the changes made in up()
}

module.exports = { up, down };
`;

    fs.writeFileSync(filepath, template);
    console.log(`✅ Created migration: ${filename}`);
    console.log(`   Path: ${filepath}`);
    console.log('\nEdit the file to add your migration logic.');
}

/**
 * Show migration status
 */
function showStatus() {
    const applied = getAppliedMigrations();
    const pending = getPendingMigrations();
    const all = getAllMigrations();

    console.log('\n📊 Migration Status\n');
    console.log(`Total migrations: ${all.length}`);
    console.log(`Applied: ${applied.length}`);
    console.log(`Pending: ${pending.length}\n`);

    if (applied.length > 0) {
        console.log('Applied migrations:');
        applied.forEach(name => console.log(`  ✅ ${name}`));
        console.log('');
    }

    if (pending.length > 0) {
        console.log('Pending migrations:');
        pending.forEach(m => console.log(`  ⏳ ${m.name}`));
        console.log('');
    }
}

/**
 * Main entry point
 */
async function main() {
    const command = process.argv[2];
    const arg = process.argv[3];

    console.log('\n🔄 Database Migration Tool\n');

    switch (command) {
        case 'up':
            await migrateUp();
            break;

        case 'down':
            await migrateDown();
            break;

        case 'create':
            createMigration(arg);
            break;

        case 'status':
            showStatus();
            break;

        default:
            console.log('Usage:');
            console.log('  node migrate.js up              - Run pending migrations');
            console.log('  node migrate.js down            - Rollback last migration');
            console.log('  node migrate.js create <name>   - Create new migration');
            console.log('  node migrate.js status          - Show migration status');
            process.exit(1);
    }
}

// Run if executed directly
if (require.main === module) {
    main().catch(error => {
        console.error('\n❌ Error:', error);
        process.exit(1);
    });
}

module.exports = { migrateUp, migrateDown, createMigration, showStatus };
