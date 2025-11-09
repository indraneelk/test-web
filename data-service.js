const fs = require('fs');
const path = require('path');
const D1Client = require('./d1-client');

/**
 * Data Service - Abstraction layer for database operations
 * Automatically uses D1 in production, JSON files in development
 */
class DataService {
    constructor() {
        this.useD1 = !!(
            process.env.CLOUDFLARE_ACCOUNT_ID &&
            process.env.CLOUDFLARE_D1_DATABASE_ID &&
            process.env.CLOUDFLARE_API_TOKEN
        );

        if (this.useD1) {
            console.log('📊 Using Cloudflare D1 database');
            this.d1 = new D1Client();
        } else {
            console.log('📊 Using JSON file storage (development mode)');
            this.DATA_DIR = path.join(__dirname, 'data');
            this.USERS_FILE = path.join(this.DATA_DIR, 'users.json');
            this.PROJECTS_FILE = path.join(this.DATA_DIR, 'projects.json');
            this.TASKS_FILE = path.join(this.DATA_DIR, 'tasks.json');
            this.ACTIVITY_FILE = path.join(this.DATA_DIR, 'activity.json');
            this.INVITATIONS_FILE = path.join(this.DATA_DIR, 'invitations.json');
            this.DISCORD_LINK_CODES_FILE = path.join(this.DATA_DIR, 'discord-link-codes.json');
            this.initializeJSONFiles();
        }
    }

    // ==================== JSON FILE HELPERS ====================

    initializeJSONFiles() {
        if (!fs.existsSync(this.DATA_DIR)) {
            fs.mkdirSync(this.DATA_DIR);
        }
        if (!fs.existsSync(this.USERS_FILE)) {
            const bcrypt = require('bcryptjs');
            const adminPassword = bcrypt.hashSync('admin123', 10);
            const defaultUsers = [{
                id: 'user-admin',
                username: 'admin',
                password_hash: adminPassword,
                name: 'Admin User',
                email: 'admin@example.com',
                is_admin: true,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            }];
            this.writeJSON(this.USERS_FILE, defaultUsers);
        }
        if (!fs.existsSync(this.PROJECTS_FILE)) {
            // Create default personal project for admin
            const defaultProjects = [{
                id: 'project-admin-personal',
                name: 'Admin User\'s Personal Tasks',
                description: 'Personal tasks and to-dos',
                owner_id: 'user-admin',
                color: '#f06a6a',
                members: [],
                is_personal: true,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            }];
            this.writeJSON(this.PROJECTS_FILE, defaultProjects);
        }
        if (!fs.existsSync(this.TASKS_FILE)) {
            this.writeJSON(this.TASKS_FILE, []);
        }
        if (!fs.existsSync(this.ACTIVITY_FILE)) {
            this.writeJSON(this.ACTIVITY_FILE, []);
        }
        if (!fs.existsSync(this.INVITATIONS_FILE)) {
            this.writeJSON(this.INVITATIONS_FILE, []);
        }
        if (!fs.existsSync(this.DISCORD_LINK_CODES_FILE)) {
            this.writeJSON(this.DISCORD_LINK_CODES_FILE, []);
        }
    }

    readJSON(filePath) {
        try {
            const data = fs.readFileSync(filePath, 'utf8');
            return JSON.parse(data);
        } catch (error) {
            return [];
        }
    }

    writeJSON(filePath, data) {
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    }

    // ==================== USER OPERATIONS ====================

    async getUsers() {
        if (this.useD1) {
            return await this.d1.getUsers();
        } else {
            return this.readJSON(this.USERS_FILE);
        }
    }

    async getUserById(userId) {
        if (this.useD1) {
            const result = await this.d1.query(
                'SELECT id, username, name, email, initials, is_admin, discord_handle, discord_user_id, discord_verified, created_at, updated_at FROM users WHERE id = ?',
                [userId]
            );
            return result.results?.[0] || null;
        } else {
            const users = this.readJSON(this.USERS_FILE);
            return users.find(u => u.id === userId) || null;
        }
    }

    async getUserByUsername(username) {
        if (this.useD1) {
            const result = await this.d1.query(
                'SELECT * FROM users WHERE username = ?',
                [username]
            );
            return result.results?.[0] || null;
        } else {
            const users = this.readJSON(this.USERS_FILE);
            return users.find(u => u.username === username) || null;
        }
    }

    // getUserBySupabaseId removed: standardize on id = sub (Supabase user id)

    async getUserByEmail(email) {
        if (this.useD1) {
            const result = await this.d1.query(
                'SELECT * FROM users WHERE email = ?',
                [email]
            );
            return result.results?.[0] || null;
        } else {
            const users = this.readJSON(this.USERS_FILE);
            return users.find(u => u.email === email) || null;
        }
    }

    async createUser(userData) {
        if (this.useD1) {
            const columns = ['id', 'username', 'name', 'email', 'is_admin', 'created_at', 'updated_at'];
            const values = [
                userData.id,
                userData.username,
                userData.name,
                userData.email,
                userData.is_admin ? 1 : 0,
                userData.created_at,
                userData.updated_at
            ];

            // Add optional fields
            if (userData.password_hash) {
                columns.push('password_hash');
                values.push(userData.password_hash);
            }
            if (userData.supabase_id) {
                columns.push('supabase_id');
                values.push(userData.supabase_id);
            }
            if (userData.initials) {
                columns.push('initials');
                values.push(userData.initials);
            }
            if (userData.color) {
                columns.push('color');
                values.push(userData.color);
            }

            const placeholders = columns.map(() => '?').join(', ');
            await this.d1.query(
                `INSERT INTO users (${columns.join(', ')}) VALUES (${placeholders})`,
                values
            );
            return userData;
        } else {
            const users = this.readJSON(this.USERS_FILE);
            users.push(userData);
            this.writeJSON(this.USERS_FILE, users);
            return userData;
        }
    }

    async updateUser(userId, updates) {
        if (this.useD1) {
            const setClauses = [];
            const values = [];

            if (updates.name !== undefined) {
                setClauses.push('name = ?');
                values.push(updates.name);
            }
            if (updates.email !== undefined) {
                setClauses.push('email = ?');
                values.push(updates.email);
            }
            if (updates.initials !== undefined) {
                setClauses.push('initials = ?');
                values.push(updates.initials);
            }
            if (updates.color !== undefined) {
                setClauses.push('color = ?');
                values.push(updates.color);
            }
            if (updates.username !== undefined) {
                setClauses.push('username = ?');
                values.push(updates.username);
            }

            setClauses.push('updated_at = ?');
            values.push(new Date().toISOString());
            values.push(userId);

            await this.d1.query(
                `UPDATE users SET ${setClauses.join(', ')} WHERE id = ?`,
                values
            );
            return await this.getUserById(userId);
        } else {
            const users = this.readJSON(this.USERS_FILE);
            const index = users.findIndex(u => u.id === userId);
            if (index !== -1) {
                users[index] = {
                    ...users[index],
                    ...updates,
                    updated_at: new Date().toISOString()
                };
                this.writeJSON(this.USERS_FILE, users);
                return users[index];
            }
            return null;
        }
    }

    async getUserByDiscordId(discordUserId) {
        if (this.useD1) {
            const result = await this.d1.query(
                'SELECT id, username, name, email, initials, is_admin, discord_handle, discord_user_id, discord_verified, created_at, updated_at FROM users WHERE discord_user_id = ?',
                [discordUserId]
            );
            return result.results?.[0] || null;
        } else {
            const users = this.readJSON(this.USERS_FILE);
            return users.find(u => u.discord_user_id === discordUserId) || null;
        }
    }

    async updateUserDiscordHandle(userId, discordHandle, discordUserId) {
        if (this.useD1) {
            await this.d1.query(
                'UPDATE users SET discord_handle = ?, discord_user_id = ?, discord_verified = 1, updated_at = ? WHERE id = ?',
                [discordHandle, discordUserId, new Date().toISOString(), userId]
            );
            return await this.getUserById(userId);
        } else {
            const users = this.readJSON(this.USERS_FILE);
            const index = users.findIndex(u => u.id === userId);
            if (index !== -1) {
                users[index] = {
                    ...users[index],
                    discord_handle: discordHandle,
                    discord_user_id: discordUserId,
                    discord_verified: 1,
                    updated_at: new Date().toISOString()
                };
                this.writeJSON(this.USERS_FILE, users);
                return users[index];
            }
            return null;
        }
    }

    // ==================== PROJECT OPERATIONS ====================

    async getProjects() {
        if (this.useD1) {
            return await this.d1.getProjects();
        } else {
            return this.readJSON(this.PROJECTS_FILE);
        }
    }

    async getProjectById(projectId) {
        if (this.useD1) {
            const result = await this.d1.query(
                'SELECT * FROM projects WHERE id = ?',
                [projectId]
            );
            return result.results?.[0] || null;
        } else {
            const projects = this.readJSON(this.PROJECTS_FILE);
            return projects.find(p => p.id === projectId) || null;
        }
    }

    async createProject(projectData) {
        if (this.useD1) {
            await this.d1.query(
                `INSERT INTO projects (id, name, description, color, is_personal, owner_id, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    projectData.id,
                    projectData.name,
                    projectData.description,
                    projectData.color || '#f06a6a',
                    projectData.is_personal ? 1 : 0,
                    projectData.owner_id,
                    projectData.created_at,
                    projectData.updated_at
                ]
            );
            return projectData;
        } else {
            const projects = this.readJSON(this.PROJECTS_FILE);
            const members = Array.isArray(projectData.members) ? projectData.members : [];
            projects.push({ ...projectData, members });
            this.writeJSON(this.PROJECTS_FILE, projects);
            return projectData;
        }
    }

    async updateProject(projectId, updates) {
        if (this.useD1) {
            await this.d1.query(
                `UPDATE projects SET name = ?, description = ?, color = ?, updated_at = ? WHERE id = ?`,
                [
                    updates.name,
                    updates.description,
                    updates.color || '#f06a6a',
                    new Date().toISOString(),
                    projectId
                ]
            );
            return await this.getProjectById(projectId);
        } else {
            const projects = this.readJSON(this.PROJECTS_FILE);
            const index = projects.findIndex(p => p.id === projectId);
            if (index !== -1) {
                projects[index] = { ...projects[index], ...updates, updated_at: new Date().toISOString() };
                this.writeJSON(this.PROJECTS_FILE, projects);
                return projects[index];
            }
            return null;
        }
    }

    async deleteProject(projectId) {
        if (this.useD1) {
            // D1 has CASCADE delete, so deleting project deletes members and tasks automatically
            await this.d1.query('DELETE FROM projects WHERE id = ?', [projectId]);
        } else {
            const projects = this.readJSON(this.PROJECTS_FILE);
            const filtered = projects.filter(p => p.id !== projectId);
            this.writeJSON(this.PROJECTS_FILE, filtered);

            // Also delete tasks for this project
            const tasks = this.readJSON(this.TASKS_FILE);
            const filteredTasks = tasks.filter(t => t.project_id !== projectId);
            this.writeJSON(this.TASKS_FILE, filteredTasks);
        }
    }

    // ==================== PROJECT MEMBER OPERATIONS ====================

    async getProjectMembers(projectId) {
        if (this.useD1) {
            return await this.d1.getProjectMembers(projectId);
        } else {
            const project = await this.getProjectById(projectId);
            return project?.members || [];
        }
    }

    async addProjectMember(projectId, userId) {
        if (this.useD1) {
            await this.d1.query(
                'INSERT INTO project_members (project_id, user_id, added_at) VALUES (?, ?, ?)',
                [projectId, userId, new Date().toISOString()]
            );
        } else {
            const projects = this.readJSON(this.PROJECTS_FILE);
            const project = projects.find(p => p.id === projectId);
            if (project) {
                if (!project.members) project.members = [];
                if (!project.members.includes(userId)) {
                    project.members.push(userId);
                    this.writeJSON(this.PROJECTS_FILE, projects);
                }
            }
        }
    }

    async removeProjectMember(projectId, userId) {
        if (this.useD1) {
            await this.d1.query(
                'DELETE FROM project_members WHERE project_id = ? AND user_id = ?',
                [projectId, userId]
            );
        } else {
            const projects = this.readJSON(this.PROJECTS_FILE);
            const project = projects.find(p => p.id === projectId);
            if (project && project.members) {
                project.members = project.members.filter(m => m !== userId);
                this.writeJSON(this.PROJECTS_FILE, projects);
            }
        }
    }

    // ==================== TASK OPERATIONS ====================

    async getTasks() {
        if (this.useD1) {
            return await this.d1.getTasks();
        } else {
            return this.readJSON(this.TASKS_FILE);
        }
    }

    async getTaskById(taskId) {
        if (this.useD1) {
            const result = await this.d1.query(
                'SELECT * FROM tasks WHERE id = ?',
                [taskId]
            );
            return result.results?.[0] || null;
        } else {
            const tasks = this.readJSON(this.TASKS_FILE);
            return tasks.find(t => t.id === taskId) || null;
        }
    }

    async createTask(taskData) {
        if (this.useD1) {
            await this.d1.query(
                `INSERT INTO tasks (id, name, description, date, project_id, assigned_to_id, created_by_id, status, priority, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    taskData.id,
                    taskData.name,
                    taskData.description,
                    taskData.date,
                    taskData.project_id,
                    taskData.assigned_to_id,
                    taskData.created_by_id,
                    taskData.status || 'pending',
                    taskData.priority || 'none',
                    taskData.created_at,
                    taskData.updated_at
                ]
            );
            return taskData;
        } else {
            const tasks = this.readJSON(this.TASKS_FILE);
            tasks.push(taskData);
            this.writeJSON(this.TASKS_FILE, tasks);
            return taskData;
        }
    }

    async updateTask(taskId, updates) {
        if (this.useD1) {
            const fields = ['name','description','date','assigned_to_id','status','priority'];
            const sets = ['name = ?','description = ?','date = ?','assigned_to_id = ?','status = ?','priority = ?'];
            const values = [
                updates.name,
                updates.description,
                updates.date,
                updates.assigned_to_id,
                updates.status,
                (updates.priority || 'none')
            ];
            if (updates.project_id !== undefined) {
                fields.push('project_id');
                sets.push('project_id = ?');
                values.push(updates.project_id);
            }
            sets.push('updated_at = ?');
            values.push(new Date().toISOString());
            values.push(taskId);

            await this.d1.query(
                `UPDATE tasks SET ${sets.join(', ')} WHERE id = ?`,
                values
            );
            return await this.getTaskById(taskId);
        } else {
            const tasks = this.readJSON(this.TASKS_FILE);
            const index = tasks.findIndex(t => t.id === taskId);
            if (index !== -1) {
                tasks[index] = { ...tasks[index], ...updates, updated_at: new Date().toISOString() };
                this.writeJSON(this.TASKS_FILE, tasks);
                return tasks[index];
            }
            return null;
        }
    }

    async deleteTask(taskId) {
        if (this.useD1) {
            await this.d1.query('DELETE FROM tasks WHERE id = ?', [taskId]);
        } else {
            const tasks = this.readJSON(this.TASKS_FILE);
            const filtered = tasks.filter(t => t.id !== taskId);
            this.writeJSON(this.TASKS_FILE, filtered);
        }
    }

    // ==================== ACTIVITY LOG ====================

    async logActivity(activityData) {
        if (this.useD1) {
            await this.d1.query(
                `INSERT INTO activity_log (id, user_id, task_id, project_id, action, details, timestamp)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [
                    activityData.id,
                    activityData.user_id,
                    activityData.task_id,
                    activityData.project_id,
                    activityData.action,
                    activityData.details,
                    activityData.timestamp
                ]
            );
        } else {
            const activities = this.readJSON(this.ACTIVITY_FILE);
            activities.push(activityData);
            if (activities.length > 500) {
                activities.splice(0, activities.length - 500);
            }
            this.writeJSON(this.ACTIVITY_FILE, activities);
        }
    }

    async getActivityLog() {
        if (this.useD1) {
            const result = await this.d1.query(
                'SELECT * FROM activity_log ORDER BY timestamp DESC LIMIT 50'
            );
            return result.results || [];
        } else {
            const activities = this.readJSON(this.ACTIVITY_FILE);
            return activities.slice(-50).reverse();
        }
    }

    // ==================== INVITATION OPERATIONS ====================

    async createInvitation(invitationData) {
        if (this.useD1) {
            await this.d1.query(
                'INSERT INTO invitations (email, invited_by_user_id, invited_at, magic_link_sent_at, status) VALUES (?, ?, ?, ?, ?)',
                [
                    invitationData.email,
                    invitationData.invited_by_user_id,
                    invitationData.invited_at,
                    invitationData.magic_link_sent_at,
                    invitationData.status
                ]
            );
        } else {
            const invitations = this.readJSON(this.INVITATIONS_FILE);
            invitations.push(invitationData);
            this.writeJSON(this.INVITATIONS_FILE, invitations);
        }
    }

    async getInvitations() {
        if (this.useD1) {
            const result = await this.d1.query(`
                SELECT
                    i.id, i.email, i.invited_at, i.magic_link_sent_at,
                    i.joined_at, i.status,
                    u.id as user_id, u.name as user_name, u.username
                FROM invitations i
                LEFT JOIN users u ON i.joined_user_id = u.id
                ORDER BY i.invited_at DESC
            `);
            return result.results || [];
        } else {
            const invitations = this.readJSON(this.INVITATIONS_FILE);
            const users = this.readJSON(this.USERS_FILE);
            // Join data manually
            return invitations.map(inv => {
                const user = users.find(u => u.id === inv.joined_user_id);
                return {
                    ...inv,
                    user_id: user?.id,
                    user_name: user?.name,
                    username: user?.username
                };
            }).sort((a, b) => new Date(b.invited_at) - new Date(a.invited_at));
        }
    }

    async getInvitationByEmail(email) {
        if (this.useD1) {
            const result = await this.d1.query(
                'SELECT * FROM invitations WHERE email = ?',
                [email]
            );
            return result.results?.[0] || null;
        } else {
            const invitations = this.readJSON(this.INVITATIONS_FILE);
            return invitations.find(inv => inv.email === email) || null;
        }
    }

    async updateInvitation(email, updates) {
        if (this.useD1) {
            const setClauses = [];
            const values = [];

            if (updates.magic_link_sent_at !== undefined) {
                setClauses.push('magic_link_sent_at = ?');
                values.push(updates.magic_link_sent_at);
            }
            if (updates.status !== undefined) {
                setClauses.push('status = ?');
                values.push(updates.status);
            }
            if (updates.joined_at !== undefined) {
                setClauses.push('joined_at = ?');
                values.push(updates.joined_at);
            }
            if (updates.joined_user_id !== undefined) {
                setClauses.push('joined_user_id = ?');
                values.push(updates.joined_user_id);
            }

            if (setClauses.length === 0) return;

            values.push(email);
            await this.d1.query(
                `UPDATE invitations SET ${setClauses.join(', ')} WHERE email = ?`,
                values
            );
        } else {
            const invitations = this.readJSON(this.INVITATIONS_FILE);
            const index = invitations.findIndex(inv => inv.email === email);
            if (index !== -1) {
                invitations[index] = { ...invitations[index], ...updates };
                this.writeJSON(this.INVITATIONS_FILE, invitations);
            }
        }
    }

    // ==================== DISCORD LINK CODE OPERATIONS ====================

    async createDiscordLinkCode(codeData) {
        if (this.useD1) {
            await this.d1.query(
                'INSERT INTO discord_link_codes (code, user_id, expires_at, used, created_at) VALUES (?, ?, ?, ?, ?)',
                [
                    codeData.code,
                    codeData.user_id,
                    codeData.expires_at,
                    codeData.used ? 1 : 0,
                    codeData.created_at
                ]
            );
        } else {
            const codes = this.readJSON(this.DISCORD_LINK_CODES_FILE);
            codes.push(codeData);
            this.writeJSON(this.DISCORD_LINK_CODES_FILE, codes);
        }
    }

    async getDiscordLinkCodeByCode(code) {
        if (this.useD1) {
            const result = await this.d1.query(
                'SELECT * FROM discord_link_codes WHERE code = ?',
                [code]
            );
            return result.results?.[0] || null;
        } else {
            const codes = this.readJSON(this.DISCORD_LINK_CODES_FILE);
            return codes.find(c => c.code === code) || null;
        }
    }

    async getDiscordLinkCodeForUser(code, userId) {
        if (this.useD1) {
            const result = await this.d1.query(
                'SELECT used, expires_at FROM discord_link_codes WHERE code = ? AND user_id = ?',
                [code, userId]
            );
            return result.results?.[0] || null;
        } else {
            const codes = this.readJSON(this.DISCORD_LINK_CODES_FILE);
            return codes.find(c => c.code === code && c.user_id === userId) || null;
        }
    }

    async deleteExpiredDiscordLinkCodes(userId) {
        const now = new Date().toISOString();
        if (this.useD1) {
            await this.d1.query(
                'DELETE FROM discord_link_codes WHERE user_id = ? AND expires_at < ?',
                [userId, now]
            );
        } else {
            const codes = this.readJSON(this.DISCORD_LINK_CODES_FILE);
            const filtered = codes.filter(c => !(c.user_id === userId && c.expires_at < now));
            this.writeJSON(this.DISCORD_LINK_CODES_FILE, filtered);
        }
    }

    async getValidDiscordLinkCodeForUser(userId) {
        const now = new Date().toISOString();
        if (this.useD1) {
            const result = await this.d1.query(
                'SELECT code, expires_at FROM discord_link_codes WHERE user_id = ? AND used = 0 AND expires_at > ?',
                [userId, now]
            );
            return result.results?.[0] || null;
        } else {
            const codes = this.readJSON(this.DISCORD_LINK_CODES_FILE);
            return codes.find(c => c.user_id === userId && c.used === 0 && c.expires_at > now) || null;
        }
    }

    async markDiscordLinkCodeAsUsed(code) {
        if (this.useD1) {
            await this.d1.query(
                'UPDATE discord_link_codes SET used = 1 WHERE code = ?',
                [code]
            );
        } else {
            const codes = this.readJSON(this.DISCORD_LINK_CODES_FILE);
            const codeObj = codes.find(c => c.code === code);
            if (codeObj) {
                codeObj.used = 1;
                this.writeJSON(this.DISCORD_LINK_CODES_FILE, codes);
            }
        }
    }

    async deleteDiscordLinkCode(code) {
        if (this.useD1) {
            await this.d1.query(
                'DELETE FROM discord_link_codes WHERE code = ?',
                [code]
            );
        } else {
            const codes = this.readJSON(this.DISCORD_LINK_CODES_FILE);
            const filtered = codes.filter(c => c.code !== code);
            this.writeJSON(this.DISCORD_LINK_CODES_FILE, filtered);
        }
    }
}

// Export singleton instance
const dataService = new DataService();
module.exports = dataService;
