import { getClient } from '../supabase.js';
import { getSession } from '../config.js';
import pc from 'picocolors';

const PRIORITY_COLORS = {
    high: pc.red,
    medium: pc.yellow,
    low: pc.green,
    none: pc.gray
};

const PRIORITY_LABEL = {
    high: '🔴 High',
    medium: '🟡 Medium',
    low: '🟢 Low',
    none: '⚪ None'
};

const STATUS_COLOR = {
    not_started: pc.gray,
    in_progress: pc.blue,
    blocked: pc.red,
    paused: pc.yellow,
    completed: pc.green
};

const STATUS_ICON = {
    not_started: '⏹',
    in_progress: '▶',
    blocked: '⛔',
    paused: '⏸',
    completed: '✓'
};

// Map old 'pending' to 'not_started' for backward compatibility
function normalizeStatus(status) {
    if (status === 'pending') return 'not_started';
    return status;
}

function formatDate(iso) {
    if (!iso) return pc.gray('—');
    const d = new Date(iso);
    const now = new Date();
    const diff = d - now;
    const days = Math.ceil(diff / (1000 * 60 * 60 * 24));

    if (days < -1) return pc.red(d.toLocaleDateString());
    if (days === -1) return pc.red('Yesterday');
    if (days === 0) return pc.yellow('Today');
    if (days === 1) return pc.green('Tomorrow');
    return pc.gray(d.toLocaleDateString());
}

export async function listTasks({ project, status, priority, json = false }) {
    const supabase = getClient();
    const session = getSession();
    if (!session?.user) {
        console.error(pc.red('Not logged in. Run: tm login'));
        process.exit(1);
    }

    let query = supabase
        .from('tasks')
        .select('*, projects!inner(name, color)')
        .or(`created_by.eq.${session.user.id},assigned_to.eq.${session.user.id}`)
        .order('due_date', { ascending: true });

    if (project) {
        query = query.eq('project_id', project);
    }
    if (status) {
        // Handle backward compatibility: accept both 'pending' and 'not_started' 
        // Map 'pending' to query for both pending and not_started in DB
        if (status === 'pending') {
            // Query for both old and new status values
            query = query.or('status.eq.pending,status.eq.not_started');
        } else {
            query = query.eq('status', status);
        }
    }
    if (priority) {
        query = query.eq('priority', priority);
    }

    const { data, error } = await query;

    if (error) {
        console.error(pc.red(`Failed to load tasks: ${error.message}`));
        process.exit(1);
    }

    if (!data || data.length === 0) {
        if (json) {
            console.log(JSON.stringify({ tasks: [] }));
        } else {
            console.log(pc.gray('No tasks found.'));
        }
        return;
    }

    if (json) {
        console.log(JSON.stringify({ tasks: data }, null, 2));
        return;
    }

    console.log(pc.bold(`\n  ${data.length} task${data.length === 1 ? '' : 's'}\n`));

    for (const task of data) {
        const prio = (task.priority || 'none');
        const prioFn = PRIORITY_COLORS[prio] || pc.gray;
        const normalizedTaskStatus = normalizeStatus(task.status);
        const statusFn = STATUS_COLOR[normalizedTaskStatus] || pc.gray;
        const statusIcon = STATUS_ICON[normalizedTaskStatus] || '?';
        const done = normalizedTaskStatus === 'completed';

        const title = done
            ? pc.strikethrough(pc.gray(task.title))
            : pc.bold(task.title);

        console.log(
            `  ${prioFn(prio === 'none' ? '  ' : '◀')} ` +
            `${statusFn(statusIcon)} ` +
            `${title}`
        );
        console.log(
            `       ${pc.gray('due')} ${formatDate(task.due_date)}  ` +
            `${pc.gray('prio')} ${prioFn(prio)}  ` +
            `${pc.gray('proj')} ${task.projects?.name ? pc.blue(task.projects.name) : pc.gray('none')}`
        );
        if (task.description) {
            const desc = task.description.length > 60
                ? task.description.substring(0, 57) + '...'
                : task.description;
            console.log(`       ${pc.italic(pc.gray(desc))}`);
        }
        console.log();
    }
}

export async function createTask({ title, description, project, due, priority, assignee, json = false }) {
    const supabase = getClient();
    const session = getSession();
    if (!session?.user) {
        console.error(pc.red('Not logged in. Run: tm login'));
        process.exit(1);
    }

    if (!title) {
        console.error(pc.red('Task title is required. Use: tm tasks create -t "My task"'));
        process.exit(1);
    }

    if (!due) {
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        due = tomorrow.toISOString().split('T')[0];
    }

    const { data, error } = await supabase
        .from('tasks')
        .insert({
            title,
            description: description || null,
            project_id: project || null,
            due_date: due,
            priority: priority || 'none',
            assigned_to: assignee || session.user.id,
            status: 'not_started'
        })
        .select()
        .single();

    if (error) {
        console.error(pc.red(`Failed to create task: ${error.message}`));
        process.exit(1);
    }

    if (json) {
        console.log(JSON.stringify({ task: data }, null, 2));
    } else {
        console.log(pc.green(`✓ Task created: "${data.title}"`));
        console.log(pc.gray(`  ID: ${data.id}`));
    }
}

export async function setStatus(id, newStatus, json = false) {
    const supabase = getClient();

    // Handle backward compatibility: convert 'pending' to 'not_started'
    const normalizedStatus = newStatus === 'pending' ? 'not_started' : newStatus;

    // Validate status
    const validStatuses = ['not_started', 'in_progress', 'blocked', 'paused', 'completed'];
    if (!validStatuses.includes(normalizedStatus)) {
        console.error(pc.red(`Invalid status: ${newStatus}. Valid values: ${validStatuses.join(', ')}`));
        process.exit(1);
    }

    const { data, error } = await supabase
        .from('tasks')
        .update({ status: normalizedStatus })
        .eq('id', id)
        .select()
        .single();

    if (error) {
        console.error(pc.red(`Failed to update task status: ${error.message}`));
        process.exit(1);
    }

    const statusIcon = STATUS_ICON[normalizedStatus] || '?';
    if (json) {
        console.log(JSON.stringify({ task: data }, null, 2));
    } else {
        console.log(pc.green(`✓ Task status updated: "${data.title}" -> ${statusIcon} ${normalizedStatus}`));
    }
}

// Keep backward compatible aliases
export async function completeTask(id, json = false) {
    return setStatus(id, 'completed', json);
}

export async function reopenTask(id, json = false) {
    return setStatus(id, 'not_started', json);
}

export async function deleteTask(id, json = false) {
    const supabase = getClient();

    const { error } = await supabase
        .from('tasks')
        .delete()
        .eq('id', id);

    if (error) {
        console.error(pc.red(`Failed to delete task: ${error.message}`));
        process.exit(1);
    }

    if (json) {
        console.log(JSON.stringify({ deleted: id }));
    } else {
        console.log(pc.green(`✓ Task deleted`));
    }
}

export async function getTask(id, json = false) {
    const supabase = getClient();

    const { data, error } = await supabase
        .from('tasks')
        .select('*, projects(name, color)')
        .eq('id', id)
        .single();

    if (error) {
        console.error(pc.red(`Task not found: ${id}`));
        process.exit(1);
    }

    if (json) {
        console.log(JSON.stringify({ task: data }, null, 2));
        return;
    }

    const normalizedStatus = normalizeStatus(data.status);
    const statusFn = STATUS_COLOR[normalizedStatus] || pc.gray;
    const statusIcon = STATUS_ICON[normalizedStatus] || '?';

    console.log(pc.bold(`\n  ${data.title}\n`));
    console.log(`  ${pc.gray('ID')}:        ${data.id}`);
    console.log(`  ${pc.gray('Status')}:    ${statusFn(statusIcon + ' ' + normalizedStatus)}`);
    console.log(`  ${pc.gray('Priority')}:  ${PRIORITY_COLORS[data.priority]?.(data.priority) || data.priority}`);
    console.log(`  ${pc.gray('Due')}:       ${formatDate(data.due_date)}`);
    console.log(`  ${pc.gray('Project')}:   ${data.projects?.name ? pc.blue(data.projects.name) : pc.gray('none')}`);
    console.log(`  ${pc.gray('Assignee')}: ${data.profiles?.username || data.profiles?.name || pc.gray('unassigned')}`);
    if (data.description) {
        console.log(`\n  ${pc.gray('Description:')}\n  ${data.description}`);
    }
    console.log();
}
