const express = require('express');
const router = express.Router();
const requireAuth = require('../middleware/auth');
const { supabaseAdmin } = require('../services/supabase');

// Helper: verify user has access to a project (owner or member)
async function hasProjectAccess(projectId, userId) {
    const { data: project } = await supabaseAdmin
        .from('projects')
        .select('owner_id')
        .eq('id', projectId)
        .single();

    if (!project) return false;
    if (project.owner_id === userId) return true;

    const { data: member } = await supabaseAdmin
        .from('project_members')
        .select('user_id')
        .eq('project_id', projectId)
        .eq('user_id', userId)
        .single();

    return !!member;
}

// GET /api/tasks — list tasks with optional filters
// Query params: ?projectId=, ?assignedTo=me, ?status=
router.get('/', requireAuth, async (req, res, next) => {
    try {
        const userId = req.user.id;
        const { projectId, assignedTo, status } = req.query;

        // Build the query
        let query = supabaseAdmin
            .from('tasks')
            .select('*')
            .order('created_at', { ascending: false });

        if (projectId) {
            // Verify access to the specified project
            const access = await hasProjectAccess(projectId, userId);
            if (!access) return res.status(403).json({ error: 'Access denied to that project' });
            query = query.eq('project_id', projectId);
        } else {
            // Get all project IDs the user has access to
            const { data: ownedProjects } = await supabaseAdmin
                .from('projects')
                .select('id')
                .eq('owner_id', userId);

            const { data: memberRows } = await supabaseAdmin
                .from('project_members')
                .select('project_id')
                .eq('user_id', userId);

            const accessibleIds = [
                ...(ownedProjects || []).map(p => p.id),
                ...(memberRows || []).map(r => r.project_id)
            ];

            if (accessibleIds.length === 0) return res.json([]);

            query = query.in('project_id', accessibleIds);
        }

        if (assignedTo === 'me') {
            query = query.eq('assigned_to', userId);
        } else if (assignedTo) {
            query = query.eq('assigned_to', assignedTo);
        }

        if (status) {
            query = query.eq('status', status);
        }

        const { data: tasks, error } = await query;

        if (error) return res.status(500).json({ error: error.message });

        res.json(tasks);
    } catch (err) {
        next(err);
    }
});

// GET /api/tasks/:id — get single task
router.get('/:id', requireAuth, async (req, res, next) => {
    try {
        const userId = req.user.id;

        const { data: task, error } = await supabaseAdmin
            .from('tasks')
            .select('*')
            .eq('id', req.params.id)
            .single();

        if (error || !task) return res.status(404).json({ error: 'Task not found' });

        const access = await hasProjectAccess(task.project_id, userId);
        if (!access) return res.status(403).json({ error: 'Access denied' });

        res.json(task);
    } catch (err) {
        next(err);
    }
});

// POST /api/tasks — create task
router.post('/', requireAuth, async (req, res, next) => {
    try {
        const userId = req.user.id;
        const { title, description, project_id, assigned_to, priority, status, due_date } = req.body;

        if (!title || !title.trim()) {
            return res.status(400).json({ error: 'Task title is required' });
        }
        if (!project_id) {
            return res.status(400).json({ error: 'project_id is required' });
        }

        const access = await hasProjectAccess(project_id, userId);
        if (!access) return res.status(403).json({ error: 'Access denied to that project' });

        const VALID_STATUSES = ['pending', 'in_progress', 'completed'];
        const VALID_PRIORITIES = ['none', 'low', 'medium', 'high'];

        if (status && !VALID_STATUSES.includes(status)) {
            return res.status(400).json({ error: `status must be one of: ${VALID_STATUSES.join(', ')}` });
        }
        if (priority && !VALID_PRIORITIES.includes(priority)) {
            return res.status(400).json({ error: `priority must be one of: ${VALID_PRIORITIES.join(', ')}` });
        }

        const { data: task, error } = await supabaseAdmin
            .from('tasks')
            .insert({
                title: title.trim(),
                description: description || null,
                project_id,
                assigned_to: assigned_to || null,
                created_by: userId,
                status: status || 'pending',
                priority: priority || 'none',
                due_date: due_date || null
            })
            .select()
            .single();

        if (error) return res.status(400).json({ error: error.message });

        await supabaseAdmin.from('activity_log').insert({
            user_id: userId,
            action: 'task_created',
            details: { task_id: task.id, task_title: task.title, project_id }
        });

        res.status(201).json(task);
    } catch (err) {
        next(err);
    }
});

// PUT /api/tasks/:id — update task
router.put('/:id', requireAuth, async (req, res, next) => {
    try {
        const userId = req.user.id;
        const taskId = req.params.id;

        const { data: existing, error: fetchErr } = await supabaseAdmin
            .from('tasks')
            .select('*')
            .eq('id', taskId)
            .single();

        if (fetchErr || !existing) return res.status(404).json({ error: 'Task not found' });

        const access = await hasProjectAccess(existing.project_id, userId);
        if (!access) return res.status(403).json({ error: 'Access denied' });

        const VALID_STATUSES = ['pending', 'in_progress', 'completed'];
        const VALID_PRIORITIES = ['none', 'low', 'medium', 'high'];

        const { title, description, assigned_to, priority, status, due_date } = req.body;

        if (status && !VALID_STATUSES.includes(status)) {
            return res.status(400).json({ error: `status must be one of: ${VALID_STATUSES.join(', ')}` });
        }
        if (priority && !VALID_PRIORITIES.includes(priority)) {
            return res.status(400).json({ error: `priority must be one of: ${VALID_PRIORITIES.join(', ')}` });
        }

        const updates = { updated_at: new Date().toISOString() };
        if (title !== undefined) updates.title = typeof title === 'string' ? title.trim() : title;
        if (description !== undefined) updates.description = description;
        if (assigned_to !== undefined) updates.assigned_to = assigned_to;
        if (priority !== undefined) updates.priority = priority;
        if (status !== undefined) updates.status = status;
        if (due_date !== undefined) updates.due_date = due_date;

        const { data: task, error } = await supabaseAdmin
            .from('tasks')
            .update(updates)
            .eq('id', taskId)
            .select()
            .single();

        if (error) return res.status(400).json({ error: error.message });

        await supabaseAdmin.from('activity_log').insert({
            user_id: userId,
            action: 'task_updated',
            details: { task_id: taskId, updates }
        });

        const oldStatus = existing.status;
        res.json({
            ...task,
            _statusChanged: oldStatus !== task.status,
            _wasCompleted: oldStatus !== 'completed' && task.status === 'completed'
        });
    } catch (err) {
        next(err);
    }
});

// DELETE /api/tasks/:id — delete task
router.delete('/:id', requireAuth, async (req, res, next) => {
    try {
        const userId = req.user.id;
        const taskId = req.params.id;

        const { data: task, error: fetchErr } = await supabaseAdmin
            .from('tasks')
            .select('*')
            .eq('id', taskId)
            .single();

        if (fetchErr || !task) return res.status(404).json({ error: 'Task not found' });

        const access = await hasProjectAccess(task.project_id, userId);
        if (!access) return res.status(403).json({ error: 'Access denied' });

        const { error } = await supabaseAdmin
            .from('tasks')
            .delete()
            .eq('id', taskId);

        if (error) return res.status(500).json({ error: error.message });

        await supabaseAdmin.from('activity_log').insert({
            user_id: userId,
            action: 'task_deleted',
            details: { task_id: taskId, task_title: task.title, project_id: task.project_id }
        });

        res.json({ message: 'Task deleted successfully', task });
    } catch (err) {
        next(err);
    }
});

module.exports = router;
