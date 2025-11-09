/**
 * Migration: Add archived field to tasks
 * Created: 2025-01-01T00:00:00.000Z
 *
 * This is an example migration showing how to add a new field to existing tasks
 */

const fs = require('fs');
const path = require('path');

/**
 * Run migration - Add archived field to all tasks
 */
async function up() {
    console.log('Adding archived field to tasks...');

    const tasksPath = path.join(__dirname, '..', 'data', 'tasks.json');

    // Check if tasks file exists
    if (!fs.existsSync(tasksPath)) {
        console.log('No tasks file found - skipping');
        return;
    }

    // Read tasks
    const tasksData = fs.readFileSync(tasksPath, 'utf8');
    const tasks = JSON.parse(tasksData);

    // Add archived field to each task if it doesn't exist
    let modified = 0;
    tasks.forEach(task => {
        if (task.archived === undefined) {
            task.archived = false;
            modified++;
        }
    });

    // Save updated tasks
    if (modified > 0) {
        fs.writeFileSync(tasksPath, JSON.stringify(tasks, null, 2));
        console.log(`✅ Added archived field to ${modified} task(s)`);
    } else {
        console.log('All tasks already have archived field');
    }
}

/**
 * Rollback migration - Remove archived field from tasks
 */
async function down() {
    console.log('Removing archived field from tasks...');

    const tasksPath = path.join(__dirname, '..', 'data', 'tasks.json');

    // Check if tasks file exists
    if (!fs.existsSync(tasksPath)) {
        console.log('No tasks file found - skipping');
        return;
    }

    // Read tasks
    const tasksData = fs.readFileSync(tasksPath, 'utf8');
    const tasks = JSON.parse(tasksData);

    // Remove archived field from each task
    tasks.forEach(task => {
        delete task.archived;
    });

    // Save updated tasks
    fs.writeFileSync(tasksPath, JSON.stringify(tasks, null, 2));
    console.log(`✅ Removed archived field from ${tasks.length} task(s)`);
}

module.exports = { up, down };
