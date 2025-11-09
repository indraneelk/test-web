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
const DB_NAME = 'task-manager-db-v2';

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

  // Track valid IDs for foreign key validation
  const validUserIds = new Set();
  const validProjectIds = new Set();
  const validTaskIds = new Set();

  // Migrate users
  console.log('📄 Reading users.json...');
  const users = readJSON('users.json');
  if (users.length > 0) {
    sql.push('-- Migrate Users');
    users.forEach(user => {
      validUserIds.add(user.id);
      const values = [
        sqlEscape(user.id),
        sqlEscape(user.username),
        sqlEscape(user.password || user.password_hash), // password_hash column
        sqlEscape(user.name || ''),
        sqlEscape(user.email),
        sqlEscape(user.initials || ''),
        sqlEscape(user.color || '#3b82f6'),
        user.is_admin ? 1 : 0,
        formatTimestamp(user.createdAt) || 'datetime(\'now\')',
        formatTimestamp(user.updatedAt) || 'datetime(\'now\')'
      ];
      sql.push(`INSERT OR IGNORE INTO users (id, username, password_hash, name, email, initials, color, is_admin, created_at, updated_at) VALUES (${values.join(', ')});`);
    });
    sql.push('');
    console.log(`✅ Found ${users.length} users`);
  }

  // Migrate projects
  console.log('📄 Reading projects.json...');
  const projects = readJSON('projects.json');
  const projectMembers = [];
  if (projects.length > 0) {
    sql.push('-- Migrate Projects');
    projects.forEach(project => {
      validProjectIds.add(project.id);
      const values = [
        sqlEscape(project.id),
        sqlEscape(project.name),
        sqlEscape(project.description || ''),
        sqlEscape(project.color || '#3b82f6'),
        sqlEscape(project.owner_id || project.ownerId),
        project.members ? sqlEscape(JSON.stringify(project.members)) : 'NULL',
        project.is_personal ? 1 : 0,
        formatTimestamp(project.created_at || project.createdAt) || 'datetime(\'now\')',
        formatTimestamp(project.updated_at || project.updatedAt) || 'datetime(\'now\')'
      ];
      sql.push(`INSERT OR IGNORE INTO projects (id, name, description, color, owner_id, members, is_personal, created_at, updated_at) VALUES (${values.join(', ')});`);

      // Collect project members for later (if stored as array in JSON)
      if (Array.isArray(project.members)) {
        project.members.forEach(userId => {
          projectMembers.push({ projectId: project.id, userId });
        });
      }
    });
    sql.push('');
    console.log(`✅ Found ${projects.length} projects`);

    // Insert project members AFTER all projects
    if (projectMembers.length > 0) {
      sql.push('-- Migrate Project Members');
      projectMembers.forEach(pm => {
        sql.push(`INSERT OR IGNORE INTO project_members (project_id, user_id) VALUES (${sqlEscape(pm.projectId)}, ${sqlEscape(pm.userId)});`);
      });
      sql.push('');
      console.log(`✅ Found ${projectMembers.length} project member relationships`);
    }
  }

  // Migrate tasks
  console.log('📄 Reading tasks.json...');
  const tasks = readJSON('tasks.json');
  if (tasks.length > 0) {
    sql.push('-- Migrate Tasks');
    tasks.forEach(task => {
      validTaskIds.add(task.id);
      const values = [
        sqlEscape(task.id),
        sqlEscape(task.name || task.title || 'Untitled Task'),
        sqlEscape(task.description || ''),
        sqlEscape(task.date || task.dueDate || task.due_date || formatTimestamp(new Date())),
        sqlEscape(task.project_id || task.projectId),
        sqlEscape(task.assigned_to_id || task.assigneeId || task.assignee_id),
        sqlEscape(task.created_by_id || task.createdById || task.assigned_to_id || task.assigneeId),
        sqlEscape(task.status || 'pending'),
        sqlEscape(task.priority || 'none'),
        task.archived ? 1 : 0,
        task.completed_at || task.completedAt ? formatTimestamp(task.completed_at || task.completedAt) : 'NULL',
        formatTimestamp(task.created_at || task.createdAt) || 'datetime(\'now\')',
        formatTimestamp(task.updated_at || task.updatedAt) || 'datetime(\'now\')'
      ];
      sql.push(`INSERT OR IGNORE INTO tasks (id, name, description, date, project_id, assigned_to_id, created_by_id, status, priority, archived, completed_at, created_at, updated_at) VALUES (${values.join(', ')});`);
    });
    sql.push('');
    console.log(`✅ Found ${tasks.length} tasks`);
  }

  // Migrate activity logs (if exists)
  console.log('📄 Reading activity.json...');
  const activities = readJSON('activity.json');
  if (activities.length > 0) {
    sql.push('-- Migrate Activity Logs');
    let skippedCount = 0;
    activities.forEach(activity => {
      // Validate foreign keys - only insert if task_id and project_id exist (or are null)
      const taskIdValid = !activity.task_id || validTaskIds.has(activity.task_id);
      const projectIdValid = !activity.project_id || validProjectIds.has(activity.project_id);

      const values = [
        sqlEscape(activity.id),
        sqlEscape(activity.user_id),
        sqlEscape(activity.action),
        activity.details ? sqlEscape(activity.details) : 'NULL',
        (activity.task_id && taskIdValid) ? sqlEscape(activity.task_id) : 'NULL',
        (activity.project_id && projectIdValid) ? sqlEscape(activity.project_id) : 'NULL',
        formatTimestamp(activity.timestamp)
      ];

      if (!taskIdValid || !projectIdValid) {
        skippedCount++;
      }

      sql.push(`INSERT OR IGNORE INTO activity_logs (id, user_id, action, details, task_id, project_id, created_at) VALUES (${values.join(', ')});`);
    });
    sql.push('');
    console.log(`✅ Found ${activities.length} activity logs${skippedCount > 0 ? ` (${skippedCount} with missing references)` : ''}`);
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
