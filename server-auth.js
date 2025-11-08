require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const claudeService = require('./claude-service');
const dataService = require('./data-service');

const app = express();
const PORT = process.env.PORT || 3000;

// CORS Configuration
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',')
    : ['http://localhost:3000', 'http://127.0.0.1:3000'];

app.use(cors({
    origin: function (origin, callback) {
        // Allow requests with no origin (mobile apps, curl, etc.)
        if (!origin) return callback(null, true);

        if (ALLOWED_ORIGINS.includes(origin)) {
            callback(null, true);
        } else {
            console.warn(`⚠️  Blocked CORS request from origin: ${origin}`);
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true
}));
app.use(express.json());
app.use(cookieParser());
// Validate session secret
const SESSION_SECRET = process.env.SESSION_SECRET;
if (!SESSION_SECRET) {
    console.warn('⚠️  WARNING: SESSION_SECRET environment variable is not set!');
    console.warn('⚠️  Using a fallback secret for development only.');
    console.warn('⚠️  Set SESSION_SECRET in production for security!');
}

app.use(session({
    secret: SESSION_SECRET || 'dev-fallback-secret-change-in-production',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: process.env.NODE_ENV === 'production', // HTTPS only in production
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
}));
app.use(express.static('public'));

// Helper functions
const generateId = (prefix = 'id') => {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
};

const logActivity = async (userId, action, details, taskId = null, projectId = null) => {
    await dataService.logActivity({
        id: generateId('activity'),
        user_id: userId,
        task_id: taskId,
        project_id: projectId,
        action,
        details,
        timestamp: new Date().toISOString()
    });
};

// Validation helpers
const validateString = (str, minLength = 1, maxLength = 500) => {
    if (typeof str !== 'string') return false;
    const trimmed = str.trim();
    return trimmed.length >= minLength && trimmed.length <= maxLength;
};

const validateEmail = (email) => {
    if (!email) return true; // Email is optional
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
};

const validateUsername = (username) => {
    if (typeof username !== 'string') return false;
    const trimmed = username.trim();
    // Username: 3-30 chars, alphanumeric and underscores only
    return /^[a-zA-Z0-9_]{3,30}$/.test(trimmed);
};

const validatePassword = (password) => {
    if (typeof password !== 'string') return false;
    // Password: at least 6 characters
    return password.length >= 6;
};

const sanitizeString = (str) => {
    if (typeof str !== 'string') return '';
    return str.trim().slice(0, 1000); // Limit length and trim
};

// Authentication Middleware
const requireAuth = (req, res, next) => {
    if (!req.session || !req.session.userId) {
        return res.status(401).json({ error: 'Authentication required' });
    }
    next();
};

const requireAdmin = async (req, res, next) => {
    if (!req.session || !req.session.userId) {
        return res.status(401).json({ error: 'Authentication required' });
    }
    try {
        const user = await dataService.getUserById(req.session.userId);
        if (!user || !user.is_admin) {
            return res.status(403).json({ error: 'Admin access required' });
        }
        next();
    } catch (error) {
        return res.status(500).json({ error: 'Authentication check failed' });
    }
};

// Check if user is project member or owner
const isProjectMember = async (userId, projectId) => {
    try {
        const project = await dataService.getProjectById(projectId);
        if (!project) return false;
        if (project.owner_id === userId) return true;

        // In D1, members are in project_members table
        // In JSON, members are in project.members array
        if (Array.isArray(project.members)) {
            return project.members.includes(userId);
        } else {
            const members = await dataService.getProjectMembers(projectId);
            return members.some(m => m.id === userId || m.user_id === userId);
        }
    } catch (error) {
        console.error('isProjectMember error:', error);
        return false;
    }
};

// Check if user is project owner
const isProjectOwner = async (userId, projectId) => {
    try {
        const project = await dataService.getProjectById(projectId);
        return project && project.owner_id === userId;
    } catch (error) {
        console.error('isProjectOwner error:', error);
        return false;
    }
};

// ==================== AUTH ROUTES ====================

// Register new user
app.post('/api/auth/register', async (req, res) => {
    try {
        const { username, password, name, email } = req.body;

        // Validate required fields
        if (!username || !password || !name) {
            return res.status(400).json({ error: 'Username, password, and name are required' });
        }

        // Validate username format
        if (!validateUsername(username)) {
            return res.status(400).json({ error: 'Username must be 3-30 characters, alphanumeric and underscores only' });
        }

        // Validate password strength
        if (!validatePassword(password)) {
            return res.status(400).json({ error: 'Password must be at least 6 characters' });
        }

        // Validate name
        if (!validateString(name, 1, 100)) {
            return res.status(400).json({ error: 'Name must be 1-100 characters' });
        }

        // Validate email if provided
        if (email && !validateEmail(email)) {
            return res.status(400).json({ error: 'Invalid email format' });
        }

        // Check if username exists
        const existingUser = await dataService.getUserByUsername(username.trim());
        if (existingUser) {
            return res.status(400).json({ error: 'Username already exists' });
        }

        // Hash password
        const password_hash = bcrypt.hashSync(password, 10);

        const newUser = {
            id: generateId('user'),
            username: username.trim(),
            password_hash,
            name: sanitizeString(name),
            email: email ? sanitizeString(email) : null,
            is_admin: false,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        };

        await dataService.createUser(newUser);
        await logActivity(newUser.id, 'user_registered', `User ${newUser.name} registered`);

        // Create personal project for the new user
        const personalProject = {
            id: generateId('project'),
            name: `${newUser.name}'s Personal Tasks`,
            description: 'Personal tasks and to-dos',
            color: pickRandomProjectColor(),
            owner_id: newUser.id,
            members: [],
            is_personal: 1,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        };
        await dataService.createProject(personalProject);
        await logActivity(newUser.id, 'project_created', `Personal project created`, null, personalProject.id);

        // Return user without password
        const { password_hash: _, ...userWithoutPassword } = newUser;
        res.status(201).json({ user: userWithoutPassword });
    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({ error: 'Registration failed' });
    }
});

// Login
app.post('/api/auth/login', async (req, res) => {
    try {
        const { username, password } = req.body;

        // Validate required fields
        if (!username || !password) {
            return res.status(400).json({ error: 'Username and password are required' });
        }

        // Validate input types and lengths
        if (typeof username !== 'string' || typeof password !== 'string') {
            return res.status(400).json({ error: 'Invalid input format' });
        }

        if (username.length > 100 || password.length > 100) {
            return res.status(400).json({ error: 'Input too long' });
        }

        const user = await dataService.getUserByUsername(username.trim());

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
app.get('/api/auth/me', requireAuth, async (req, res) => {
    try {
        const user = await dataService.getUserById(req.session.userId);

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
app.get('/api/users', requireAuth, async (req, res) => {
    try {
        const users = await dataService.getUsers();
        const usersWithoutPasswords = users.map(({ password_hash, ...user }) => user);
        res.json(usersWithoutPasswords);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch users' });
    }
});

// Get user by ID
app.get('/api/users/:id', requireAuth, async (req, res) => {
    try {
        const user = await dataService.getUserById(req.params.id);

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        const { password_hash: _, ...userWithoutPassword } = user;
        res.json(userWithoutPassword);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch user' });
    }
});

// Update current user's profile
app.put('/api/auth/me', requireAuth, async (req, res) => {
    try {
        const { name, email, initials, password } = req.body || {};

        // Validate fields if provided
        if (name !== undefined && !validateString(name, 1, 100)) {
            return res.status(400).json({ error: 'Name must be 1-100 characters' });
        }
        if (email !== undefined && !validateEmail(email)) {
            return res.status(400).json({ error: 'Invalid email format' });
        }
        if (initials !== undefined) {
            const str = String(initials).trim();
            if (str && !/^[A-Za-z]{1,4}$/.test(str)) {
                return res.status(400).json({ error: 'Initials must be 1-4 letters' });
            }
        }
        if (password !== undefined && password !== null && password !== '') {
            if (!validatePassword(password)) {
                return res.status(400).json({ error: 'Password must be at least 6 characters' });
            }
        }

        const user = await dataService.getUserById(req.session.userId);
        if (!user) return res.status(404).json({ error: 'User not found' });

        const bcrypt = require('bcryptjs');
        const updates = {
            name: name !== undefined ? sanitizeString(name) : user.name,
            email: email !== undefined ? sanitizeString(email) : user.email,
            initials: initials !== undefined ? sanitizeString(initials || '') : (user.initials || null)
        };
        if (password) {
            updates.password_hash = bcrypt.hashSync(password, 10);
        }

        const updated = await dataService.updateUser(req.session.userId, updates);
        const { password_hash: _, ...withoutPass } = updated || {};
        res.json({ user: withoutPass });
    } catch (error) {
        console.error('Update profile error:', error);
        res.status(500).json({ error: 'Failed to update profile' });
    }
});

// Delete user (admin only)
app.delete('/api/users/:id', requireAdmin, async (req, res) => {
    try {
        const user = await dataService.getUserById(req.params.id);

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Note: Delete user functionality needs to be added to dataService
        // For now, just return an error
        res.status(501).json({ error: 'User deletion not yet implemented for data service' });

        // TODO: Implement deleteUser in dataService
        // await dataService.deleteUser(req.params.id);
        // await logActivity(req.session.userId, 'user_deleted', `User ${user.name} deleted`);
        // res.json({ message: 'User deleted successfully' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to delete user' });
    }
});

// ==================== PROJECT ROUTES ====================

// Get all projects for current user
app.get('/api/projects', requireAuth, async (req, res) => {
    try {
        const projects = await dataService.getProjects();
        const userId = req.session.userId;

        // Return projects where user is owner or member
        const userProjects = [];
        for (const p of projects) {
            if (p.owner_id === userId || await isProjectMember(userId, p.id)) {
                userProjects.push(p);
            }
        }

        res.json(userProjects);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch projects' });
    }
});

// Get single project
app.get('/api/projects/:id', requireAuth, async (req, res) => {
    try {
        const project = await dataService.getProjectById(req.params.id);

        if (!project) {
            return res.status(404).json({ error: 'Project not found' });
        }

        // Check if user has access
        if (!(await isProjectMember(req.session.userId, project.id))) {
            return res.status(403).json({ error: 'Access denied' });
        }

        res.json(project);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch project' });
    }
});

// Create new project
// Helper to pick a stable random color for personal projects
function pickRandomProjectColor() {
    const colors = ['#f06a6a', '#ffc82c', '#13ce66', '#667eea', '#764ba2', '#f093fb', '#4facfe', '#43e97b'];
    return colors[Math.floor(Math.random() * colors.length)];
}

app.post('/api/projects', requireAuth, async (req, res) => {
    try {
        const { name, description, color } = req.body;

        // Validate required fields
        if (!name) {
            return res.status(400).json({ error: 'Project name is required' });
        }

        // Validate project name
        if (!validateString(name, 1, 100)) {
            return res.status(400).json({ error: 'Project name must be 1-100 characters' });
        }

        // Validate description if provided
        if (description && !validateString(description, 0, 1000)) {
            return res.status(400).json({ error: 'Description must be less than 1000 characters' });
        }

        // Validate color if provided
        let projectColor = '#f06a6a';
        if (typeof color === 'string' && color.trim() !== '') {
            const hex = color.trim();
            const isValidHex = /^#([0-9A-Fa-f]{6})$/.test(hex);
            if (!isValidHex) {
                return res.status(400).json({ error: 'Invalid color. Use 6-digit hex like #f06a6a' });
            }
            projectColor = hex.toLowerCase();
        }

        const projects = await dataService.getProjects();

        // Check for duplicate name
        if (projects.find(p => p.name.trim().toLowerCase() === name.trim().toLowerCase())) {
            return res.status(400).json({ error: 'Project name already exists' });
        }

        const newProject = {
            id: generateId('project'),
            name: sanitizeString(name),
            description: description ? sanitizeString(description) : '',
            color: projectColor,
            is_personal: 0,
            owner_id: req.session.userId,
            members: [],
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        };

        await dataService.createProject(newProject);

        await logActivity(req.session.userId, 'project_created', `Project "${newProject.name}" created`, null, newProject.id);

        res.status(201).json(newProject);
    } catch (error) {
        res.status(500).json({ error: 'Failed to create project' });
    }
});

// Update project
app.put('/api/projects/:id', requireAuth, async (req, res) => {
    try {
        const project = await dataService.getProjectById(req.params.id);

        if (!project) {
            return res.status(404).json({ error: 'Project not found' });
        }

        // Check if user is owner
        if (!(await isProjectOwner(req.session.userId, req.params.id))) {
            return res.status(403).json({ error: 'Only project owner can update project' });
        }

        const { name, description, color } = req.body;

        // Validate name if provided
        if (project.is_personal) {
            return res.status(403).json({ error: 'Personal projects cannot be edited' });
        }
        
        // Validate name if provided
        if (name !== undefined && !validateString(name, 1, 100)) {
            return res.status(400).json({ error: 'Project name must be 1-100 characters' });
        }

        // Validate description if provided
        if (description !== undefined && description !== null && !validateString(description, 0, 1000)) {
            return res.status(400).json({ error: 'Description must be less than 1000 characters' });
        }

        // Validate color if provided
        let updateColor = project.color || '#f06a6a';
        if (color !== undefined && color !== null) {
            const hex = String(color).trim();
            const isValidHex = /^#([0-9A-Fa-f]{6})$/.test(hex);
            if (!isValidHex) {
                return res.status(400).json({ error: 'Invalid color. Use 6-digit hex like #f06a6a' });
            }
            updateColor = hex.toLowerCase();
        }

        const updates = {
            name: name ? sanitizeString(name) : project.name,
            description: description !== undefined ? sanitizeString(description || '') : project.description,
            color: updateColor
        };

        const updatedProject = await dataService.updateProject(req.params.id, updates);

        await logActivity(req.session.userId, 'project_updated', `Project "${updatedProject.name}" updated`, null, req.params.id);

        res.json(updatedProject);
    } catch (error) {
        res.status(500).json({ error: 'Failed to update project' });
    }
});

// Delete project
app.delete('/api/projects/:id', requireAuth, async (req, res) => {
    try {
        const project = await dataService.getProjectById(req.params.id);

        if (!project) {
            return res.status(404).json({ error: 'Project not found' });
        }

        // Check if user is owner
        if (!(await isProjectOwner(req.session.userId, req.params.id))) {
            return res.status(403).json({ error: 'Only project owner can delete project' });
        }

        // Prevent deletion of personal projects
        if (project.is_personal) {
            return res.status(403).json({ error: 'Cannot delete personal project' });
        }

        await dataService.deleteProject(req.params.id);

        await logActivity(req.session.userId, 'project_deleted', `Project "${project.name}" deleted`, null, req.params.id);

        res.json({ message: 'Project deleted successfully', project: project });
    } catch (error) {
        res.status(500).json({ error: 'Failed to delete project' });
    }
});

// Add member to project
app.post('/api/projects/:id/members', requireAuth, async (req, res) => {
    try {
        const { user_id } = req.body;

        if (!user_id) {
            return res.status(400).json({ error: 'User ID is required' });
        }

        const project = await dataService.getProjectById(req.params.id);

        if (!project) {
            return res.status(404).json({ error: 'Project not found' });
        }

        // Check if current user is owner
        if (!(await isProjectOwner(req.session.userId, req.params.id))) {
            return res.status(403).json({ error: 'Only project owner can add members' });
        }

        // Prevent adding members to personal projects
        if (project.is_personal) {
            return res.status(403).json({ error: 'Cannot add members to personal project' });
        }

        // Check if user exists
        const userToAdd = await dataService.getUserById(user_id);
        if (!userToAdd) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Check if already owner
        if (project.owner_id === user_id) {
            return res.status(400).json({ error: 'User is already the project owner' });
        }

        // Check if already member
        if (await isProjectMember(user_id, req.params.id)) {
            return res.status(400).json({ error: 'User is already a member' });
        }

        await dataService.addProjectMember(req.params.id, user_id);

        await logActivity(req.session.userId, 'member_added', `${userToAdd.name} added to project "${project.name}"`, null, req.params.id);

        const updatedProject = await dataService.getProjectById(req.params.id);
        res.json(updatedProject);
    } catch (error) {
        res.status(500).json({ error: 'Failed to add member' });
    }
});

// Remove member from project
app.delete('/api/projects/:id/members/:userId', requireAuth, async (req, res) => {
    try {
        const project = await dataService.getProjectById(req.params.id);

        if (!project) {
            return res.status(404).json({ error: 'Project not found' });
        }

        // Check if current user is owner
        if (!(await isProjectOwner(req.session.userId, req.params.id))) {
            return res.status(403).json({ error: 'Only project owner can remove members' });
        }

        // Prevent removing members from personal projects
        if (project.is_personal) {
            return res.status(403).json({ error: 'Cannot remove members from personal project' });
        }

        // Check if user is actually a member
        if (!(await isProjectMember(req.params.userId, req.params.id))) {
            return res.status(404).json({ error: 'Member not found' });
        }

        await dataService.removeProjectMember(req.params.id, req.params.userId);

        const removedUser = await dataService.getUserById(req.params.userId);

        await logActivity(req.session.userId, 'member_removed', `${removedUser?.name || 'User'} removed from project "${project.name}"`, null, req.params.id);

        const updatedProject = await dataService.getProjectById(req.params.id);
        res.json(updatedProject);
    } catch (error) {
        res.status(500).json({ error: 'Failed to remove member' });
    }
});

// ==================== TASK ROUTES ====================

// Get all tasks (filtered by user's projects)
app.get('/api/tasks', requireAuth, async (req, res) => {
    try {
        const tasks = await dataService.getTasks();
        const projects = await dataService.getProjects();
        const userId = req.session.userId;

        // Get user's project IDs
        const userProjectIds = [];
        for (const p of projects) {
            if (p.owner_id === userId || await isProjectMember(userId, p.id)) {
                userProjectIds.push(p.id);
            }
        }

        // Filter tasks by user's projects
        const userTasks = tasks.filter(t => userProjectIds.includes(t.project_id));

        res.json(userTasks);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch tasks' });
    }
});

// Get single task
app.get('/api/tasks/:id', requireAuth, async (req, res) => {
    try {
        const task = await dataService.getTaskById(req.params.id);

        if (!task) {
            return res.status(404).json({ error: 'Task not found' });
        }

        // Check if user has access to the project
        if (!(await isProjectMember(req.session.userId, task.project_id))) {
            return res.status(403).json({ error: 'Access denied' });
        }

        res.json(task);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch task' });
    }
});

// Create new task
app.post('/api/tasks', requireAuth, async (req, res) => {
    try {
        const { name, description, date, project_id, assigned_to_id, priority } = req.body;

        // Validate required fields
        if (!name || !description || !date || !project_id || !assigned_to_id) {
            return res.status(400).json({
                error: 'Missing required fields: name, description, date, project_id, assigned_to_id'
            });
        }

        // Validate task name
        if (!validateString(name, 1, 200)) {
            return res.status(400).json({ error: 'Task name must be 1-200 characters' });
        }

        // Validate description
        if (!validateString(description, 0, 2000)) {
            return res.status(400).json({ error: 'Description must be less than 2000 characters' });
        }

        // Validate date format
        const dateObj = new Date(date);
        if (isNaN(dateObj.getTime())) {
            return res.status(400).json({ error: 'Invalid date format' });
        }

        // Validate priority
        const validPriorities = ['none', 'low', 'medium', 'high'];
        if (priority && !validPriorities.includes(priority)) {
            return res.status(400).json({ error: 'Invalid priority. Must be: none, low, medium, or high' });
        }

        // Check if user is member of the project
        if (!(await isProjectMember(req.session.userId, project_id))) {
            return res.status(403).json({ error: 'You are not a member of this project' });
        }

        // Check if assigned user is member of the project
        if (!(await isProjectMember(assigned_to_id, project_id))) {
            return res.status(400).json({ error: 'Assigned user is not a member of this project' });
        }

        const newTask = {
            id: generateId('task'),
            name: sanitizeString(name),
            description: sanitizeString(description),
            date: date,
            project_id: project_id,
            assigned_to_id: assigned_to_id,
            created_by_id: req.session.userId,
            status: 'pending',
            priority: priority || 'none',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        };

        await dataService.createTask(newTask);

        await logActivity(req.session.userId, 'task_created', `Task "${newTask.name}" created`, newTask.id, project_id);

        res.status(201).json(newTask);
    } catch (error) {
        res.status(500).json({ error: 'Failed to create task' });
    }
});

// Update task
app.put('/api/tasks/:id', requireAuth, async (req, res) => {
    try {
        const task = await dataService.getTaskById(req.params.id);

        if (!task) {
            return res.status(404).json({ error: 'Task not found' });
        }

        // Check if user is member of the project
        if (!(await isProjectMember(req.session.userId, task.project_id))) {
            return res.status(403).json({ error: 'Access denied' });
        }

        const { name, description, date, assigned_to_id, status, priority } = req.body;

        // Validate name if provided
        if (name !== undefined && !validateString(name, 1, 200)) {
            return res.status(400).json({ error: 'Task name must be 1-200 characters' });
        }

        // Validate description if provided
        if (description !== undefined && !validateString(description, 0, 2000)) {
            return res.status(400).json({ error: 'Description must be less than 2000 characters' });
        }

        // Validate date if provided
        if (date !== undefined) {
            const dateObj = new Date(date);
            if (isNaN(dateObj.getTime())) {
                return res.status(400).json({ error: 'Invalid date format' });
            }
        }

        // Validate status if provided (for checkbox completion)
        const validStatuses = ['pending', 'in-progress', 'completed'];
        if (status !== undefined && !validStatuses.includes(status)) {
            return res.status(400).json({ error: 'Invalid status. Must be: pending, in-progress, or completed' });
        }

        // Validate priority if provided
        const validPriorities = ['none', 'low', 'medium', 'high'];
        if (priority !== undefined && !validPriorities.includes(priority)) {
            return res.status(400).json({ error: 'Invalid priority. Must be: none, low, medium, or high' });
        }

        // If changing assigned user, verify they're in the project
        if (assigned_to_id && !(await isProjectMember(assigned_to_id, task.project_id))) {
            return res.status(400).json({ error: 'Assigned user is not a member of this project' });
        }

        const oldStatus = task.status;

        const updates = {
            name: name ? sanitizeString(name) : task.name,
            description: description !== undefined ? sanitizeString(description) : task.description,
            date: date || task.date,
            assigned_to_id: assigned_to_id || task.assigned_to_id,
            status: status !== undefined ? status : task.status,
            priority: priority !== undefined ? priority : (task.priority || 'none')
        };

        const updatedTask = await dataService.updateTask(req.params.id, updates);

        await logActivity(req.session.userId, 'task_updated', `Task "${updatedTask.name}" updated`, req.params.id, updatedTask.project_id);

        // Return status change info for celebration
        res.json({
            ...updatedTask,
            _statusChanged: oldStatus !== updatedTask.status,
            _wasCompleted: oldStatus !== 'completed' && updatedTask.status === 'completed'
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed to update task' });
    }
});

// Delete task
app.delete('/api/tasks/:id', requireAuth, async (req, res) => {
    try {
        const task = await dataService.getTaskById(req.params.id);

        if (!task) {
            return res.status(404).json({ error: 'Task not found' });
        }

        // Check if user is member of the project
        if (!(await isProjectMember(req.session.userId, task.project_id))) {
            return res.status(403).json({ error: 'Access denied' });
        }

        await dataService.deleteTask(req.params.id);

        await logActivity(req.session.userId, 'task_deleted', `Task "${task.name}" deleted`, req.params.id, task.project_id);

        res.json({ message: 'Task deleted successfully', task: task });
    } catch (error) {
        res.status(500).json({ error: 'Failed to delete task' });
    }
});

// ==================== ACTIVITY LOG ROUTES ====================

// Get activity log
app.get('/api/activity', requireAuth, async (req, res) => {
    try {
        const activities = await dataService.getActivityLog();
        const projects = await dataService.getProjects();
        const userId = req.session.userId;

        // Get user's project IDs
        const userProjectIds = [];
        for (const p of projects) {
            if (p.owner_id === userId || await isProjectMember(userId, p.id)) {
                userProjectIds.push(p.id);
            }
        }

        // Filter activities by user's projects or own activities
        const userActivities = activities.filter(a =>
            a.user_id === userId ||
            (a.project_id && userProjectIds.includes(a.project_id))
        );

        res.json(userActivities);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch activity' });
    }
});

// ==================== CLAUDE AI ROUTES ====================

// Ask Claude a question about tasks
app.post('/api/claude/ask', requireAuth, async (req, res) => {
    try {
        const { question } = req.body;

        if (!question) {
            return res.status(400).json({ error: 'Question is required' });
        }

        // Validate question length
        if (!validateString(question, 1, 500)) {
            return res.status(400).json({ error: 'Question must be 1-500 characters' });
        }

        const userId = req.session.userId;

        // Get user's data
        const tasks = await dataService.getTasks();
        const projects = await dataService.getProjects();
        const users = await dataService.getUsers();

        // Filter to user's accessible data
        const userProjectIds = [];
        for (const p of projects) {
            if (p.owner_id === userId || await isProjectMember(userId, p.id)) {
                userProjectIds.push(p.id);
            }
        }

        const userTasks = tasks.filter(t => userProjectIds.includes(t.project_id));
        const userProjects = projects.filter(p => userProjectIds.includes(p.id));

        // Query Claude
        const response = await claudeService.ask(question, userTasks, userProjects, users);

        res.json({
            question: question,
            answer: response,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('Claude query error:', error);
        res.status(500).json({
            error: 'Failed to get response from Claude',
            details: error.message
        });
    }
});

// Get task summary from Claude
app.get('/api/claude/summary', requireAuth, async (req, res) => {
    try {
        const userId = req.session.userId;

        const tasks = await dataService.getTasks();
        const projects = await dataService.getProjects();
        const users = await dataService.getUsers();

        const userProjectIds = [];
        for (const p of projects) {
            if (p.owner_id === userId || await isProjectMember(userId, p.id)) {
                userProjectIds.push(p.id);
            }
        }

        const userTasks = tasks.filter(t => userProjectIds.includes(t.project_id));
        const userProjects = projects.filter(p => userProjectIds.includes(p.id));

        const summary = await claudeService.getSummary(userTasks, userProjects, users);

        res.json({
            summary: summary,
            taskCount: userTasks.length,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('Claude summary error:', error);
        res.status(500).json({
            error: 'Failed to get summary from Claude',
            details: error.message
        });
    }
});

// Get task priorities from Claude
app.get('/api/claude/priorities', requireAuth, async (req, res) => {
    try {
        const userId = req.session.userId;

        const tasks = await dataService.getTasks();
        const projects = await dataService.getProjects();
        const users = await dataService.getUsers();

        const userProjectIds = [];
        for (const p of projects) {
            if (p.owner_id === userId || await isProjectMember(userId, p.id)) {
                userProjectIds.push(p.id);
            }
        }

        const userTasks = tasks.filter(t => userProjectIds.includes(t.project_id));
        const userProjects = projects.filter(p => userProjectIds.includes(p.id));

        const priorities = await claudeService.getPriorities(userTasks, userProjects, users);

        res.json({
            priorities: priorities,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('Claude priorities error:', error);
        res.status(500).json({
            error: 'Failed to get priorities from Claude',
            details: error.message
        });
    }
});

// Check Claude service status
app.get('/api/claude/status', requireAuth, (req, res) => {
    const stats = claudeService.getStats();
    res.json(stats);
});

// Serve frontend
app.get('/', (req, res) => {
    // Serve authenticated app (it will redirect to login if not authenticated)
    res.sendFile(path.join(__dirname, 'public', 'app-auth.html'));
});

// Start Claude service (only if API key is configured)
if (process.env.ANTHROPIC_API_KEY) {
    claudeService.start();

    claudeService.on('ready', () => {
        console.log('🤖 Claude AI assistant is ready to help with your tasks!\n');
    });

    claudeService.on('error', (error) => {
        console.error('❌ Claude service error:', error);
    });
} else {
    console.log('⚠️  Claude AI not configured. Claude features will be disabled.');
    console.log('   Add ANTHROPIC_API_KEY to .env to enable AI features.\n');
}

// Start server
app.listen(PORT, () => {
    console.log(`\n🚀 Task Manager server running on http://localhost:${PORT}`);
    console.log(`\n📝 Access the app:`);
    console.log(`   Main app: http://localhost:${PORT}/`);
    console.log(`   Login page: http://localhost:${PORT}/login.html`);
    console.log(`\n🔑 Default credentials:`);
    console.log(`   Username: admin`);
    console.log(`   Password: admin123`);
    console.log(`\n🤖 Claude AI endpoints:`);
    console.log(`   POST /api/claude/ask - Ask Claude anything`);
    console.log(`   GET  /api/claude/summary - Get task summary`);
    console.log(`   GET  /api/claude/priorities - Get priority suggestions\n`);
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n\n👋 Shutting down gracefully...');
    if (process.env.ANTHROPIC_API_KEY) {
        claudeService.stop();
    }
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('\n\n👋 Shutting down gracefully...');
    if (process.env.ANTHROPIC_API_KEY) {
        claudeService.stop();
    }
    process.exit(0);
});
