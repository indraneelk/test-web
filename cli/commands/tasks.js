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
    pending: pc.yellow,
    in_progress: pc.blue,
    completed: pc.green
};

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
        .select('*, projects(name, color), profiles(username, name)')
        .eq('user_id', session.user.id)
        .order('due_date', { ascending: true });

    if (project) {
        query = query.eq('project_id', project);
    }
    if (status) {
        query = query.eq('status', status);
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
        const statusFn = STATUS_COLOR[task.status] || pc.gray;
        const done = task.status === 'completed';

        const title = done
            ? pc.strikethrough(pc.gray(task.title))
            : pc.bold(task.title);

        console.log(
            `  ${prioFn(prio === 'none' ? '  ' : '◀')} ` +
            `${statusFn(task.status === 'completed' ? '☑' : '☐')} ` +
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
            user_id: session.user.id,
            status: 'pending'
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

export async function completeTask(id, json = false) {
    const supabase = getClient();

    const { data, error } = await supabase
        .from('tasks')
        .update({ status: 'completed' })
        .eq('id', id)
        .select()
        .single();

    if (error) {
        console.error(pc.red(`Failed to complete task: ${error.message}`));
        process.exit(1);
    }

    if (json) {
        console.log(JSON.stringify({ task: data }, null, 2));
    } else {
        console.log(pc.green(`✓ Task completed: "${data.title}"`));
    }
}

export async function reopenTask(id, json = false) {
    const supabase = getClient();

    const { data, error } = await supabase
        .from('tasks')
        .update({ status: 'pending' })
        .eq('id', id)
        .select()
        .single();

    if (error) {
        console.error(pc.red(`Failed to reopen task: ${error.message}`));
        process.exit(1);
    }

    if (json) {
        console.log(JSON.stringify({ task: data }, null, 2));
    } else {
        console.log(pc.yellow(`↩ Task reopened: "${data.title}"`));
    }
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
        .select('*, projects(name, color), profiles(username, name)')
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

    console.log(pc.bold(`\n  ${data.title}\n`));
    console.log(`  ${pc.gray('ID')}:        ${data.id}`);
    console.log(`  ${pc.gray('Status')}:    ${STATUS_COLOR[data.status]?.(data.status) || data.status}`);
    console.log(`  ${pc.gray('Priority')}:  ${PRIORITY_COLORS[data.priority]?.(data.priority) || data.priority}`);
    console.log(`  ${pc.gray('Due')}:       ${formatDate(data.due_date)}`);
    console.log(`  ${pc.gray('Project')}:   ${data.projects?.name ? pc.blue(data.projects.name) : pc.gray('none')}`);
    console.log(`  ${pc.gray('Assignee')}: ${data.profiles?.username || data.profiles?.name || pc.gray('unassigned')}`);
    if (data.description) {
        console.log(`\n  ${pc.gray('Description:')}\n  ${data.description}`);
    }
    console.log();
}
