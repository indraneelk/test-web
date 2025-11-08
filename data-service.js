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
                'SELECT id, username, name, email, is_admin, created_at, updated_at FROM users WHERE id = ?',
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

    async createUser(userData) {
        if (this.useD1) {
            await this.d1.query(
                `INSERT INTO users (id, username, password_hash, name, email, is_admin, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    userData.id,
                    userData.username,
                    userData.password_hash,
                    userData.name,
                    userData.email,
                    userData.is_admin ? 1 : 0,
                    userData.created_at,
                    userData.updated_at
                ]
            );
            return userData;
        } else {
            const users = this.readJSON(this.USERS_FILE);
            users.push(userData);
            this.writeJSON(this.USERS_FILE, users);
            return userData;
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
                `INSERT INTO projects (id, name, description, owner_id, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [
                    projectData.id,
                    projectData.name,
                    projectData.description,
                    projectData.owner_id,
                    projectData.created_at,
                    projectData.updated_at
                ]
            );
            return projectData;
        } else {
            const projects = this.readJSON(this.PROJECTS_FILE);
            projects.push({ ...projectData, members: [] });
            this.writeJSON(this.PROJECTS_FILE, projects);
            return projectData;
        }
    }

    async updateProject(projectId, updates) {
        if (this.useD1) {
            await this.d1.query(
                `UPDATE projects SET name = ?, description = ?, updated_at = ? WHERE id = ?`,
                [updates.name, updates.description, new Date().toISOString(), projectId]
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
            await this.d1.query(
                `UPDATE tasks SET name = ?, description = ?, date = ?, assigned_to_id = ?, status = ?, priority = ?, updated_at = ? WHERE id = ?`,
                [
                    updates.name,
                    updates.description,
                    updates.date,
                    updates.assigned_to_id,
                    updates.status,
                    updates.priority || 'medium',
                    new Date().toISOString(),
                    taskId
                ]
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
}

// Export singleton instance
const dataService = new DataService();
module.exports = dataService;
