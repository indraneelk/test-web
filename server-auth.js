const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const cookieParser = require('cookie-parser');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors({
    origin: true,
    credentials: true
}));
app.use(express.json());
app.use(cookieParser());
app.use(session({
    secret: 'your-secret-key-change-this-in-production',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: false, // set to true in production with HTTPS
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
}));
app.use(express.static('public'));

// Data storage files
const DATA_DIR = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const PROJECTS_FILE = path.join(DATA_DIR, 'projects.json');
const TASKS_FILE = path.join(DATA_DIR, 'tasks.json');
const ACTIVITY_FILE = path.join(DATA_DIR, 'activity.json');

// Initialize data directory and files
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR);
}

if (!fs.existsSync(USERS_FILE)) {
    // Create default admin user (password: admin123)
    const adminPassword = bcrypt.hashSync('admin123', 10);
    const defaultUsers = [{
        id: 'user-admin',
        username: 'admin',
        password_hash: adminPassword,
        name: 'Admin User',
        email: 'admin@example.com',
        is_admin: true,
        created_at: new Date().toISOString()
    }];
    fs.writeFileSync(USERS_FILE, JSON.stringify(defaultUsers, null, 2));
}

if (!fs.existsSync(PROJECTS_FILE)) {
    fs.writeFileSync(PROJECTS_FILE, JSON.stringify([], null, 2));
}

if (!fs.existsSync(TASKS_FILE)) {
    fs.writeFileSync(TASKS_FILE, JSON.stringify([], null, 2));
}

if (!fs.existsSync(ACTIVITY_FILE)) {
    fs.writeFileSync(ACTIVITY_FILE, JSON.stringify([], null, 2));
}

// Helper functions
const readJSON = (filePath) => {
    try {
        const data = fs.readFileSync(filePath, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        return [];
    }
};

const writeJSON = (filePath, data) => {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
};

const generateId = (prefix = 'id') => {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
};

const logActivity = (userId, action, details, taskId = null, projectId = null) => {
    const activities = readJSON(ACTIVITY_FILE);
    activities.push({
        id: generateId('activity'),
        user_id: userId,
        task_id: taskId,
        project_id: projectId,
        action,
        details,
        timestamp: new Date().toISOString()
    });
    // Keep only last 500 activities
    if (activities.length > 500) {
        activities.splice(0, activities.length - 500);
    }
    writeJSON(ACTIVITY_FILE, activities);
};

// Authentication Middleware
const requireAuth = (req, res, next) => {
    if (!req.session || !req.session.userId) {
        return res.status(401).json({ error: 'Authentication required' });
    }
    next();
};

const requireAdmin = (req, res, next) => {
    if (!req.session || !req.session.userId) {
        return res.status(401).json({ error: 'Authentication required' });
    }
    const users = readJSON(USERS_FILE);
    const user = users.find(u => u.id === req.session.userId);
    if (!user || !user.is_admin) {
        return res.status(403).json({ error: 'Admin access required' });
    }
    next();
};

// Check if user is project member or owner
const isProjectMember = (userId, projectId) => {
    const projects = readJSON(PROJECTS_FILE);
    const project = projects.find(p => p.id === projectId);
    if (!project) return false;
    if (project.owner_id === userId) return true;
    return project.members && project.members.includes(userId);
};

// Check if user is project owner
const isProjectOwner = (userId, projectId) => {
    const projects = readJSON(PROJECTS_FILE);
    const project = projects.find(p => p.id === projectId);
    return project && project.owner_id === userId;
};

// ==================== AUTH ROUTES ====================

// Register new user
app.post('/api/auth/register', (req, res) => {
    try {
        const { username, password, name, email } = req.body;

        if (!username || !password || !name) {
            return res.status(400).json({ error: 'Username, password, and name are required' });
        }

        const users = readJSON(USERS_FILE);

        // Check if username exists
        if (users.find(u => u.username === username)) {
            return res.status(400).json({ error: 'Username already exists' });
        }

        // Hash password
        const password_hash = bcrypt.hashSync(password, 10);

        const newUser = {
            id: generateId('user'),
            username,
            password_hash,
            name,
            email: email || null,
            is_admin: false,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        };

        users.push(newUser);
        writeJSON(USERS_FILE, users);

        logActivity(newUser.id, 'user_registered', `User ${name} registered`);

        // Return user without password
        const { password_hash: _, ...userWithoutPassword } = newUser;
        res.status(201).json({ user: userWithoutPassword });
    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({ error: 'Registration failed' });
    }
});

// Login
app.post('/api/auth/login', (req, res) => {
    try {
        const { username, password } = req.body;

        if (!username || !password) {
            return res.status(400).json({ error: 'Username and password are required' });
        }

        const users = readJSON(USERS_FILE);
        const user = users.find(u => u.username === username);

        if (!user || !bcrypt.compareSync(password, user.password_hash)) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        // Set session
        req.session.userId = user.id;
        req.session.username = user.username;

        logActivity(user.id, 'user_login', `User ${user.name} logged in`);

        // Return user without password
        const { password_hash: _, ...userWithoutPassword } = user;
        res.json({ user: userWithoutPassword });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Login failed' });
    }
});

// Logout
app.post('/api/auth/logout', requireAuth, (req, res) => {
    const userId = req.session.userId;
    req.session.destroy((err) => {
        if (err) {
            return res.status(500).json({ error: 'Logout failed' });
        }
        logActivity(userId, 'user_logout', 'User logged out');
        res.json({ message: 'Logged out successfully' });
    });
});

// Check session
app.get('/api/auth/me', requireAuth, (req, res) => {
    try {
        const users = readJSON(USERS_FILE);
        const user = users.find(u => u.id === req.session.userId);

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        const { password_hash: _, ...userWithoutPassword } = user;
        res.json({ user: userWithoutPassword });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch user' });
    }
});

// ==================== USER MANAGEMENT ROUTES ====================

// Get all users (for admin and project member selection)
app.get('/api/users', requireAuth, (req, res) => {
    try {
        const users = readJSON(USERS_FILE);
        const usersWithoutPasswords = users.map(({ password_hash, ...user }) => user);
        res.json(usersWithoutPasswords);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch users' });
    }
});

// Get user by ID
app.get('/api/users/:id', requireAuth, (req, res) => {
    try {
        const users = readJSON(USERS_FILE);
        const user = users.find(u => u.id === req.params.id);

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        const { password_hash: _, ...userWithoutPassword } = user;
        res.json(userWithoutPassword);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch user' });
    }
});

// Delete user (admin only)
app.delete('/api/users/:id', requireAdmin, (req, res) => {
    try {
        const users = readJSON(USERS_FILE);
        const userIndex = users.findIndex(u => u.id === req.params.id);

        if (userIndex === -1) {
            return res.status(404).json({ error: 'User not found' });
        }

        const deletedUser = users.splice(userIndex, 1)[0];
        writeJSON(USERS_FILE, users);

        logActivity(req.session.userId, 'user_deleted', `User ${deletedUser.name} deleted`);

        res.json({ message: 'User deleted successfully' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to delete user' });
    }
});

// ==================== PROJECT ROUTES ====================

// Get all projects for current user
app.get('/api/projects', requireAuth, (req, res) => {
    try {
        const projects = readJSON(PROJECTS_FILE);
        const userId = req.session.userId;

        // Return projects where user is owner or member
        const userProjects = projects.filter(p =>
            p.owner_id === userId || (p.members && p.members.includes(userId))
        );

        res.json(userProjects);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch projects' });
    }
});

// Get single project
app.get('/api/projects/:id', requireAuth, (req, res) => {
    try {
        const projects = readJSON(PROJECTS_FILE);
        const project = projects.find(p => p.id === req.params.id);

        if (!project) {
            return res.status(404).json({ error: 'Project not found' });
        }

        // Check if user has access
        if (!isProjectMember(req.session.userId, project.id)) {
            return res.status(403).json({ error: 'Access denied' });
        }

        res.json(project);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch project' });
    }
});

// Create new project
app.post('/api/projects', requireAuth, (req, res) => {
    try {
        const { name, description } = req.body;

        if (!name) {
            return res.status(400).json({ error: 'Project name is required' });
        }

        const projects = readJSON(PROJECTS_FILE);

        // Check for duplicate name
        if (projects.find(p => p.name === name)) {
            return res.status(400).json({ error: 'Project name already exists' });
        }

        const newProject = {
            id: generateId('project'),
            name,
            description: description || '',
            owner_id: req.session.userId,
            members: [],
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        };

        projects.push(newProject);
        writeJSON(PROJECTS_FILE, projects);

        logActivity(req.session.userId, 'project_created', `Project "${name}" created`, null, newProject.id);

        res.status(201).json(newProject);
    } catch (error) {
        res.status(500).json({ error: 'Failed to create project' });
    }
});

// Update project
app.put('/api/projects/:id', requireAuth, (req, res) => {
    try {
        const projects = readJSON(PROJECTS_FILE);
        const projectIndex = projects.findIndex(p => p.id === req.params.id);

        if (projectIndex === -1) {
            return res.status(404).json({ error: 'Project not found' });
        }

        // Check if user is owner
        if (!isProjectOwner(req.session.userId, req.params.id)) {
            return res.status(403).json({ error: 'Only project owner can update project' });
        }

        const { name, description } = req.body;

        projects[projectIndex] = {
            ...projects[projectIndex],
            name: name || projects[projectIndex].name,
            description: description !== undefined ? description : projects[projectIndex].description,
            updated_at: new Date().toISOString()
        };

        writeJSON(PROJECTS_FILE, projects);

        logActivity(req.session.userId, 'project_updated', `Project "${projects[projectIndex].name}" updated`, null, req.params.id);

        res.json(projects[projectIndex]);
    } catch (error) {
        res.status(500).json({ error: 'Failed to update project' });
    }
});

// Delete project
app.delete('/api/projects/:id', requireAuth, (req, res) => {
    try {
        const projects = readJSON(PROJECTS_FILE);
        const projectIndex = projects.findIndex(p => p.id === req.params.id);

        if (projectIndex === -1) {
            return res.status(404).json({ error: 'Project not found' });
        }

        // Check if user is owner
        if (!isProjectOwner(req.session.userId, req.params.id)) {
            return res.status(403).json({ error: 'Only project owner can delete project' });
        }

        const deletedProject = projects.splice(projectIndex, 1)[0];
        writeJSON(PROJECTS_FILE, projects);

        // Delete all tasks in this project
        const tasks = readJSON(TASKS_FILE);
        const updatedTasks = tasks.filter(t => t.project_id !== req.params.id);
        writeJSON(TASKS_FILE, updatedTasks);

        logActivity(req.session.userId, 'project_deleted', `Project "${deletedProject.name}" deleted`, null, req.params.id);

        res.json({ message: 'Project deleted successfully', project: deletedProject });
    } catch (error) {
        res.status(500).json({ error: 'Failed to delete project' });
    }
});

// Add member to project
app.post('/api/projects/:id/members', requireAuth, (req, res) => {
    try {
        const { user_id } = req.body;

        if (!user_id) {
            return res.status(400).json({ error: 'User ID is required' });
        }

        const projects = readJSON(PROJECTS_FILE);
        const projectIndex = projects.findIndex(p => p.id === req.params.id);

        if (projectIndex === -1) {
            return res.status(404).json({ error: 'Project not found' });
        }

        // Check if current user is owner
        if (!isProjectOwner(req.session.userId, req.params.id)) {
            return res.status(403).json({ error: 'Only project owner can add members' });
        }

        // Check if user exists
        const users = readJSON(USERS_FILE);
        const userToAdd = users.find(u => u.id === user_id);
        if (!userToAdd) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Check if already owner
        if (projects[projectIndex].owner_id === user_id) {
            return res.status(400).json({ error: 'User is already the project owner' });
        }

        // Initialize members array if it doesn't exist
        if (!projects[projectIndex].members) {
            projects[projectIndex].members = [];
        }

        // Check if already member
        if (projects[projectIndex].members.includes(user_id)) {
            return res.status(400).json({ error: 'User is already a member' });
        }

        projects[projectIndex].members.push(user_id);
        projects[projectIndex].updated_at = new Date().toISOString();

        writeJSON(PROJECTS_FILE, projects);

        logActivity(req.session.userId, 'member_added', `${userToAdd.name} added to project "${projects[projectIndex].name}"`, null, req.params.id);

        res.json(projects[projectIndex]);
    } catch (error) {
        res.status(500).json({ error: 'Failed to add member' });
    }
});

// Remove member from project
app.delete('/api/projects/:id/members/:userId', requireAuth, (req, res) => {
    try {
        const projects = readJSON(PROJECTS_FILE);
        const projectIndex = projects.findIndex(p => p.id === req.params.id);

        if (projectIndex === -1) {
            return res.status(404).json({ error: 'Project not found' });
        }

        // Check if current user is owner
        if (!isProjectOwner(req.session.userId, req.params.id)) {
            return res.status(403).json({ error: 'Only project owner can remove members' });
        }

        if (!projects[projectIndex].members) {
            return res.status(404).json({ error: 'Member not found' });
        }

        const memberIndex = projects[projectIndex].members.indexOf(req.params.userId);
        if (memberIndex === -1) {
            return res.status(404).json({ error: 'Member not found' });
        }

        projects[projectIndex].members.splice(memberIndex, 1);
        projects[projectIndex].updated_at = new Date().toISOString();

        writeJSON(PROJECTS_FILE, projects);

        const users = readJSON(USERS_FILE);
        const removedUser = users.find(u => u.id === req.params.userId);

        logActivity(req.session.userId, 'member_removed', `${removedUser?.name || 'User'} removed from project "${projects[projectIndex].name}"`, null, req.params.id);

        res.json(projects[projectIndex]);
    } catch (error) {
        res.status(500).json({ error: 'Failed to remove member' });
    }
});

// ==================== TASK ROUTES ====================

// Get all tasks (filtered by user's projects)
app.get('/api/tasks', requireAuth, (req, res) => {
    try {
        const tasks = readJSON(TASKS_FILE);
        const projects = readJSON(PROJECTS_FILE);
        const userId = req.session.userId;

        // Get user's project IDs
        const userProjectIds = projects
            .filter(p => p.owner_id === userId || (p.members && p.members.includes(userId)))
            .map(p => p.id);

        // Filter tasks by user's projects
        const userTasks = tasks.filter(t => userProjectIds.includes(t.project_id));

        res.json(userTasks);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch tasks' });
    }
});

// Get single task
app.get('/api/tasks/:id', requireAuth, (req, res) => {
    try {
        const tasks = readJSON(TASKS_FILE);
        const task = tasks.find(t => t.id === req.params.id);

        if (!task) {
            return res.status(404).json({ error: 'Task not found' });
        }

        // Check if user has access to the project
        if (!isProjectMember(req.session.userId, task.project_id)) {
            return res.status(403).json({ error: 'Access denied' });
        }

        res.json(task);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch task' });
    }
});

// Create new task
app.post('/api/tasks', requireAuth, (req, res) => {
    try {
        const { name, description, date, project_id, assigned_to_id, status } = req.body;

        if (!name || !description || !date || !project_id || !assigned_to_id) {
            return res.status(400).json({
                error: 'Missing required fields: name, description, date, project_id, assigned_to_id'
            });
        }

        // Check if user is member of the project
        if (!isProjectMember(req.session.userId, project_id)) {
            return res.status(403).json({ error: 'You are not a member of this project' });
        }

        // Check if assigned user is member of the project
        if (!isProjectMember(assigned_to_id, project_id)) {
            return res.status(400).json({ error: 'Assigned user is not a member of this project' });
        }

        const tasks = readJSON(TASKS_FILE);

        const newTask = {
            id: generateId('task'),
            name,
            description,
            date,
            project_id,
            assigned_to_id,
            created_by_id: req.session.userId,
            status: status || 'pending',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        };

        tasks.push(newTask);
        writeJSON(TASKS_FILE, tasks);

        logActivity(req.session.userId, 'task_created', `Task "${name}" created`, newTask.id, project_id);

        res.status(201).json(newTask);
    } catch (error) {
        res.status(500).json({ error: 'Failed to create task' });
    }
});

// Update task
app.put('/api/tasks/:id', requireAuth, (req, res) => {
    try {
        const tasks = readJSON(TASKS_FILE);
        const taskIndex = tasks.findIndex(t => t.id === req.params.id);

        if (taskIndex === -1) {
            return res.status(404).json({ error: 'Task not found' });
        }

        // Check if user is member of the project
        if (!isProjectMember(req.session.userId, tasks[taskIndex].project_id)) {
            return res.status(403).json({ error: 'Access denied' });
        }

        const { name, description, date, assigned_to_id, status } = req.body;

        // If changing assigned user, verify they're in the project
        if (assigned_to_id && !isProjectMember(assigned_to_id, tasks[taskIndex].project_id)) {
            return res.status(400).json({ error: 'Assigned user is not a member of this project' });
        }

        const oldStatus = tasks[taskIndex].status;

        tasks[taskIndex] = {
            ...tasks[taskIndex],
            name: name || tasks[taskIndex].name,
            description: description || tasks[taskIndex].description,
            date: date || tasks[taskIndex].date,
            assigned_to_id: assigned_to_id || tasks[taskIndex].assigned_to_id,
            status: status || tasks[taskIndex].status,
            updated_at: new Date().toISOString()
        };

        writeJSON(TASKS_FILE, tasks);

        logActivity(req.session.userId, 'task_updated', `Task "${tasks[taskIndex].name}" updated`, req.params.id, tasks[taskIndex].project_id);

        // Return status change info for celebration
        res.json({
            ...tasks[taskIndex],
            _statusChanged: oldStatus !== tasks[taskIndex].status,
            _wasCompleted: oldStatus !== 'completed' && tasks[taskIndex].status === 'completed'
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed to update task' });
    }
});

// Delete task
app.delete('/api/tasks/:id', requireAuth, (req, res) => {
    try {
        const tasks = readJSON(TASKS_FILE);
        const taskIndex = tasks.findIndex(t => t.id === req.params.id);

        if (taskIndex === -1) {
            return res.status(404).json({ error: 'Task not found' });
        }

        // Check if user is member of the project
        if (!isProjectMember(req.session.userId, tasks[taskIndex].project_id)) {
            return res.status(403).json({ error: 'Access denied' });
        }

        const deletedTask = tasks.splice(taskIndex, 1)[0];
        writeJSON(TASKS_FILE, tasks);

        logActivity(req.session.userId, 'task_deleted', `Task "${deletedTask.name}" deleted`, req.params.id, deletedTask.project_id);

        res.json({ message: 'Task deleted successfully', task: deletedTask });
    } catch (error) {
        res.status(500).json({ error: 'Failed to delete task' });
    }
});

// ==================== ACTIVITY LOG ROUTES ====================

// Get activity log
app.get('/api/activity', requireAuth, (req, res) => {
    try {
        const activities = readJSON(ACTIVITY_FILE);
        const projects = readJSON(PROJECTS_FILE);
        const userId = req.session.userId;

        // Get user's project IDs
        const userProjectIds = projects
            .filter(p => p.owner_id === userId || (p.members && p.members.includes(userId)))
            .map(p => p.id);

        // Filter activities by user's projects or own activities
        const userActivities = activities.filter(a =>
            a.user_id === userId ||
            (a.project_id && userProjectIds.includes(a.project_id))
        );

        // Return last 50 activities
        res.json(userActivities.slice(-50).reverse());
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch activity' });
    }
});

// Serve frontend
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start server
app.listen(PORT, () => {
    console.log(`\n🚀 Task Manager server running on http://localhost:${PORT}`);
    console.log(`\n📝 Default login credentials:`);
    console.log(`   Username: admin`);
    console.log(`   Password: admin123\n`);
});
