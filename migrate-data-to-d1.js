#!/usr/bin/env node
/**
 * Data Migration Script: JSON → Cloudflare D1
 *
 * Migrates existing data from local JSON files to D1 database.
 *
 * Usage:
 *   node migrate-data-to-d1.js                    # Generate SQL file
 *   node migrate-data-to-d1.js --execute          # Execute against D1 directly
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const DATA_DIR = path.join(__dirname, 'data');
const OUTPUT_SQL = path.join(__dirname, 'migrations/006_migrate_json_data.sql');
const DB_NAME = 'task-manager-db';

// Helper to escape SQL strings
function sqlEscape(str) {
  if (str === null || str === undefined) return 'NULL';
  if (typeof str === 'number') return str;
  if (typeof str === 'boolean') return str ? 1 : 0;
  return `'${String(str).replace(/'/g, "''")}'`;
}

// Helper to format timestamp
function formatTimestamp(ts) {
  if (!ts) return 'NULL';
  // Convert to ISO 8601 format
  const date = new Date(ts);
  if (isNaN(date.getTime())) return 'NULL';
  return sqlEscape(date.toISOString());
}

// Read JSON file safely
function readJSON(filename) {
  const filepath = path.join(DATA_DIR, filename);
  if (!fs.existsSync(filepath)) {
    console.log(`⚠️  ${filename} not found, skipping...`);
    return [];
  }
  try {
    const content = fs.readFileSync(filepath, 'utf-8');
    return JSON.parse(content);
  } catch (err) {
    console.error(`❌ Error reading ${filename}:`, err.message);
    return [];
  }
}

// Generate SQL statements
function generateMigrationSQL() {
  const sql = [];

  sql.push('-- Data Migration from JSON to D1');
  sql.push('-- Generated: ' + new Date().toISOString());
  sql.push('');

  // Migrate users
  console.log('📄 Reading users.json...');
  const users = readJSON('users.json');
  if (users.length > 0) {
    sql.push('-- Migrate Users');
    users.forEach(user => {
      const values = [
        sqlEscape(user.id),
        sqlEscape(user.username),
        sqlEscape(user.name || ''),
        sqlEscape(user.email),
        sqlEscape(user.password),
        sqlEscape(user.initials || ''),
        formatTimestamp(user.createdAt)
      ];
      sql.push(`INSERT OR IGNORE INTO users (id, username, name, email, password, initials, created_at) VALUES (${values.join(', ')});`);
    });
    sql.push('');
    console.log(`✅ Found ${users.length} users`);
  }

  // Migrate projects
  console.log('📄 Reading projects.json...');
  const projects = readJSON('projects.json');
  if (projects.length > 0) {
    sql.push('-- Migrate Projects');
    projects.forEach(project => {
      const values = [
        sqlEscape(project.id),
        sqlEscape(project.name),
        sqlEscape(project.description || ''),
        sqlEscape(project.color || '#3b82f6'),
        project.is_personal ? 1 : 0,
        formatTimestamp(project.createdAt)
      ];
      sql.push(`INSERT OR IGNORE INTO projects (id, name, description, color, is_personal, created_at) VALUES (${values.join(', ')});`);

      // Migrate project members (if stored as array in JSON)
      if (Array.isArray(project.members)) {
        project.members.forEach(userId => {
          sql.push(`INSERT OR IGNORE INTO project_members (project_id, user_id) VALUES (${sqlEscape(project.id)}, ${sqlEscape(userId)});`);
        });
      }
    });
    sql.push('');
    console.log(`✅ Found ${projects.length} projects`);
  }

  // Migrate tasks
  console.log('📄 Reading tasks.json...');
  const tasks = readJSON('tasks.json');
  if (tasks.length > 0) {
    sql.push('-- Migrate Tasks');
    tasks.forEach(task => {
      const values = [
        sqlEscape(task.id),
        sqlEscape(task.title),
        sqlEscape(task.description || ''),
        sqlEscape(task.status || 'pending'),
        sqlEscape(task.priority || 'medium'),
        task.assigneeId ? sqlEscape(task.assigneeId) : 'NULL',
        task.projectId ? sqlEscape(task.projectId) : 'NULL',
        task.dueDate ? formatTimestamp(task.dueDate) : 'NULL',
        task.completedAt ? formatTimestamp(task.completedAt) : 'NULL',
        task.archived ? 1 : 0,
        formatTimestamp(task.createdAt),
        formatTimestamp(task.updatedAt)
      ];
      sql.push(`INSERT OR IGNORE INTO tasks (id, title, description, status, priority, assignee_id, project_id, due_date, completed_at, archived, created_at, updated_at) VALUES (${values.join(', ')});`);
    });
    sql.push('');
    console.log(`✅ Found ${tasks.length} tasks`);
  }

  // Migrate activity logs (if exists)
  console.log('📄 Reading activity.json...');
  const activities = readJSON('activity.json');
  if (activities.length > 0) {
    sql.push('-- Migrate Activity Logs');
    activities.forEach(activity => {
      const values = [
        sqlEscape(activity.id),
        sqlEscape(activity.userId),
        sqlEscape(activity.action),
        sqlEscape(activity.entity),
        activity.entityId ? sqlEscape(activity.entityId) : 'NULL',
        activity.details ? sqlEscape(JSON.stringify(activity.details)) : 'NULL',
        formatTimestamp(activity.timestamp)
      ];
      sql.push(`INSERT OR IGNORE INTO activity_logs (id, user_id, action, entity, entity_id, details, timestamp) VALUES (${values.join(', ')});`);
    });
    sql.push('');
    console.log(`✅ Found ${activities.length} activity logs`);
  }

  return sql.join('\n');
}

// Main execution
async function main() {
  const args = process.argv.slice(2);
  const shouldExecute = args.includes('--execute');

  console.log('🚀 D1 Data Migration Tool\n');

  // Check if data directory exists
  if (!fs.existsSync(DATA_DIR)) {
    console.error(`❌ Data directory not found: ${DATA_DIR}`);
    console.log('💡 This script migrates data from local JSON files to D1.');
    console.log('   If you don\'t have local data, you can skip this step.');
    process.exit(1);
  }

  // Generate SQL
  console.log('Generating migration SQL...\n');
  const migrationSQL = generateMigrationSQL();

  if (!migrationSQL.includes('INSERT')) {
    console.log('\n⚠️  No data found to migrate.');
    console.log('   The data/ directory is empty or contains no valid JSON files.');
    process.exit(0);
  }

  // Write to file
  const migrationsDir = path.dirname(OUTPUT_SQL);
  if (!fs.existsSync(migrationsDir)) {
    fs.mkdirSync(migrationsDir, { recursive: true });
  }

  fs.writeFileSync(OUTPUT_SQL, migrationSQL);
  console.log(`\n✅ Migration SQL written to: ${OUTPUT_SQL}`);

  // Execute against D1 if requested
  if (shouldExecute) {
    console.log(`\n🔄 Executing migration against D1 database: ${DB_NAME}...`);
    try {
      execSync(`wrangler d1 execute ${DB_NAME} --file="${OUTPUT_SQL}"`, {
        stdio: 'inherit'
      });
      console.log('\n✅ Migration completed successfully!');
    } catch (err) {
      console.error('\n❌ Migration failed:', err.message);
      console.log('\n💡 You can manually run:');
      console.log(`   wrangler d1 execute ${DB_NAME} --file="${OUTPUT_SQL}"`);
      process.exit(1);
    }
  } else {
    console.log('\n📋 To execute this migration:');
    console.log(`   wrangler d1 execute ${DB_NAME} --file="${OUTPUT_SQL}"`);
    console.log('\n   Or run this script with --execute flag:');
    console.log('   node migrate-data-to-d1.js --execute');
  }
}

main().catch(err => {
  console.error('❌ Unexpected error:', err);
  process.exit(1);
});
