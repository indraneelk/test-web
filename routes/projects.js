const express = require('express');
const router = express.Router();
const requireAuth = require('../middleware/auth');
const { supabaseAdmin } = require('../services/supabase');

// Helper: check if a user is a member or owner of a project
async function getUserProjectRole(projectId, userId) {
    const { data: project } = await supabaseAdmin
        .from('projects')
        .select('owner_id')
        .eq('id', projectId)
        .single();

    if (!project) return null;
    if (project.owner_id === userId) return 'owner';

    const { data: member } = await supabaseAdmin
        .from('project_members')
        .select('role')
        .eq('project_id', projectId)
        .eq('user_id', userId)
        .single();

    return member ? member.role : null;
}

// GET /api/projects — list all projects user is owner or member of
router.get('/', requireAuth, async (req, res, next) => {
    try {
        const userId = req.user.id;

        // Projects where user is owner
        const { data: ownedProjects, error: ownedErr } = await supabaseAdmin
            .from('projects')
            .select('*, project_members(user_id, role)')
            .eq('owner_id', userId);

        if (ownedErr) return res.status(500).json({ error: ownedErr.message });

        // Projects where user is a member (not owner)
        const { data: memberRows, error: memberErr } = await supabaseAdmin
            .from('project_members')
            .select('project_id')
            .eq('user_id', userId);

        if (memberErr) return res.status(500).json({ error: memberErr.message });

        const memberProjectIds = memberRows.map(r => r.project_id);

        let memberProjects = [];
        if (memberProjectIds.length > 0) {
            const { data, error: mpErr } = await supabaseAdmin
                .from('projects')
                .select('*, project_members(user_id, role)')
                .in('id', memberProjectIds)
                .neq('owner_id', userId); // avoid duplicating owned projects

            if (mpErr) return res.status(500).json({ error: mpErr.message });
            memberProjects = data || [];
        }

        const allProjects = [...(ownedProjects || []), ...memberProjects];
        res.json(allProjects);
    } catch (err) {
        next(err);
    }
});

// GET /api/projects/:id — get single project with members
router.get('/:id', requireAuth, async (req, res, next) => {
    try {
        const userId = req.user.id;
        const projectId = req.params.id;

        const role = await getUserProjectRole(projectId, userId);
        if (!role) return res.status(403).json({ error: 'Access denied' });

        const { data: project, error } = await supabaseAdmin
            .from('projects')
            .select('*, project_members(user_id, role, profiles(id, name, username, color, avatar_url))')
            .eq('id', projectId)
            .single();

        if (error || !project) return res.status(404).json({ error: 'Project not found' });

        res.json(project);
    } catch (err) {
        next(err);
    }
});

// POST /api/projects — create project, auto-add creator as owner in project_members
router.post('/', requireAuth, async (req, res, next) => {
    try {
        const userId = req.user.id;
        const { name, description, is_personal } = req.body;

        if (!name || !name.trim()) {
            return res.status(400).json({ error: 'Project name is required' });
        }

        const { data: project, error: createErr } = await supabaseAdmin
            .from('projects')
            .insert({
                name: name.trim(),
                description: description || null,
                owner_id: userId,
                is_personal: is_personal || false
            })
            .select()
            .single();

        if (createErr) return res.status(400).json({ error: createErr.message });

        // Add creator as owner in project_members
        await supabaseAdmin
            .from('project_members')
            .insert({ project_id: project.id, user_id: userId, role: 'owner' });

        // Log activity
        await supabaseAdmin.from('activity_log').insert({
            user_id: userId,
            action: 'project_created',
            details: { project_id: project.id, project_name: project.name }
        });

        res.status(201).json(project);
    } catch (err) {
        next(err);
    }
});

// PUT /api/projects/:id — update (owner only)
router.put('/:id', requireAuth, async (req, res, next) => {
    try {
        const userId = req.user.id;
        const projectId = req.params.id;

        const role = await getUserProjectRole(projectId, userId);
        if (!role) return res.status(404).json({ error: 'Project not found' });
        if (role !== 'owner') return res.status(403).json({ error: 'Only the project owner can update this project' });

        const { name, description } = req.body;
        const updates = {};
        if (name !== undefined) updates.name = name.trim();
        if (description !== undefined) updates.description = description;

        if (Object.keys(updates).length === 0) {
            return res.status(400).json({ error: 'No valid fields to update' });
        }

        const { data: project, error } = await supabaseAdmin
            .from('projects')
            .update(updates)
            .eq('id', projectId)
            .select()
            .single();

        if (error) return res.status(400).json({ error: error.message });

        await supabaseAdmin.from('activity_log').insert({
            user_id: userId,
            action: 'project_updated',
            details: { project_id: projectId, updates }
        });

        res.json(project);
    } catch (err) {
        next(err);
    }
});

// DELETE /api/projects/:id — delete (owner only)
router.delete('/:id', requireAuth, async (req, res, next) => {
    try {
        const userId = req.user.id;
        const projectId = req.params.id;

        const role = await getUserProjectRole(projectId, userId);
        if (!role) return res.status(404).json({ error: 'Project not found' });
        if (role !== 'owner') return res.status(403).json({ error: 'Only the project owner can delete this project' });

        const { error } = await supabaseAdmin
            .from('projects')
            .delete()
            .eq('id', projectId);

        if (error) return res.status(500).json({ error: error.message });

        await supabaseAdmin.from('activity_log').insert({
            user_id: userId,
            action: 'project_deleted',
            details: { project_id: projectId }
        });

        res.json({ message: 'Project deleted successfully' });
    } catch (err) {
        next(err);
    }
});

// POST /api/projects/:id/members — add member by email
router.post('/:id/members', requireAuth, async (req, res, next) => {
    try {
        const userId = req.user.id;
        const projectId = req.params.id;
        const { email, user_id: targetUserId } = req.body;

        if (!email && !targetUserId) {
            return res.status(400).json({ error: 'email or user_id is required' });
        }

        const role = await getUserProjectRole(projectId, userId);
        if (!role) return res.status(404).json({ error: 'Project not found' });
        if (role !== 'owner') return res.status(403).json({ error: 'Only the project owner can add members' });

        // Get project to check is_personal
        const { data: project } = await supabaseAdmin
            .from('projects')
            .select('is_personal')
            .eq('id', projectId)
            .single();

        if (project?.is_personal) {
            return res.status(403).json({ error: 'Cannot add members to a personal project' });
        }

        // Resolve user ID from email if needed
        let resolvedUserId = targetUserId;
        if (!resolvedUserId && email) {
            // Look up profile by email via auth admin API
            const { data: { users }, error: listErr } = await supabaseAdmin.auth.admin.listUsers();
            if (listErr) return res.status(500).json({ error: 'Failed to look up user' });

            const authUser = users.find(u => u.email?.toLowerCase() === email.toLowerCase());
            if (!authUser) return res.status(404).json({ error: 'No user found with that email' });
            resolvedUserId = authUser.id;
        }

        // Check if already a member
        const { data: existing } = await supabaseAdmin
            .from('project_members')
            .select('role')
            .eq('project_id', projectId)
            .eq('user_id', resolvedUserId)
            .single();

        if (existing) {
            return res.status(409).json({ error: 'User is already a member of this project' });
        }

        const { error: insertErr } = await supabaseAdmin
            .from('project_members')
            .insert({ project_id: projectId, user_id: resolvedUserId, role: 'member' });

        if (insertErr) return res.status(400).json({ error: insertErr.message });

        await supabaseAdmin.from('activity_log').insert({
            user_id: userId,
            action: 'member_added',
            details: { project_id: projectId, added_user_id: resolvedUserId }
        });

        // Return updated project with members
        const { data: updatedProject } = await supabaseAdmin
            .from('projects')
            .select('*, project_members(user_id, role, profiles(id, name, username, color, avatar_url))')
            .eq('id', projectId)
            .single();

        res.status(201).json(updatedProject);
    } catch (err) {
        next(err);
    }
});

// DELETE /api/projects/:id/members/:userId — remove member
router.delete('/:id/members/:userId', requireAuth, async (req, res, next) => {
    try {
        const requestingUserId = req.user.id;
        const projectId = req.params.id;
        const targetUserId = req.params.userId;

        const { data: project } = await supabaseAdmin
            .from('projects')
            .select('owner_id, is_personal, name')
            .eq('id', projectId)
            .single();

        if (!project) return res.status(404).json({ error: 'Project not found' });

        const isSelf = targetUserId === requestingUserId;
        const isOwner = project.owner_id === requestingUserId;

        // Owners cannot remove themselves
        if (isSelf && project.owner_id === requestingUserId) {
            return res.status(400).json({ error: 'Project owners cannot remove themselves' });
        }

        // Non-owners can only remove themselves (leave)
        if (!isOwner && !isSelf) {
            return res.status(403).json({ error: 'Only the project owner can remove other members' });
        }

        if (project.is_personal && !isSelf) {
            return res.status(403).json({ error: 'Cannot remove members from a personal project' });
        }

        const { error } = await supabaseAdmin
            .from('project_members')
            .delete()
            .eq('project_id', projectId)
            .eq('user_id', targetUserId);

        if (error) return res.status(500).json({ error: error.message });

        await supabaseAdmin.from('activity_log').insert({
            user_id: requestingUserId,
            action: 'member_removed',
            details: { project_id: projectId, removed_user_id: targetUserId }
        });

        res.json({ message: isSelf ? 'You left the project' : 'Member removed successfully' });
    } catch (err) {
        next(err);
    }
});

module.exports = router;
