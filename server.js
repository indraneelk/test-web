const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Data storage file
const DATA_FILE = path.join(__dirname, 'tasks.json');

// Initialize data file if it doesn't exist
if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify([]));
}

// Helper functions
const readTasks = () => {
    try {
        const data = fs.readFileSync(DATA_FILE, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        return [];
    }
};

const writeTasks = (tasks) => {
    fs.writeFileSync(DATA_FILE, JSON.stringify(tasks, null, 2));
};

// Generate unique ID
const generateId = () => {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
};

// API Routes

// Get all tasks
app.get('/api/tasks', (req, res) => {
    try {
        const tasks = readTasks();
        res.json(tasks);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch tasks' });
    }
});

// Get single task by ID
app.get('/api/tasks/:id', (req, res) => {
    try {
        const tasks = readTasks();
        const task = tasks.find(t => t.id === req.params.id);

        if (!task) {
            return res.status(404).json({ error: 'Task not found' });
        }

        res.json(task);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch task' });
    }
});

// Create new task
app.post('/api/tasks', (req, res) => {
    try {
        const { name, description, date, project, poc, status } = req.body;

        // Validation
        if (!name || !description || !date || !project || !poc) {
            return res.status(400).json({
                error: 'Missing required fields: name, description, date, project, poc'
            });
        }

        const tasks = readTasks();
        const newTask = {
            id: generateId(),
            name,
            description,
            date,
            project,
            poc,
            status: status || 'pending',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        tasks.push(newTask);
        writeTasks(tasks);

        res.status(201).json(newTask);
    } catch (error) {
        res.status(500).json({ error: 'Failed to create task' });
    }
});

// Update task
app.put('/api/tasks/:id', (req, res) => {
    try {
        const tasks = readTasks();
        const taskIndex = tasks.findIndex(t => t.id === req.params.id);

        if (taskIndex === -1) {
            return res.status(404).json({ error: 'Task not found' });
        }

        const { name, description, date, project, poc, status } = req.body;

        // Update task with new data
        tasks[taskIndex] = {
            ...tasks[taskIndex],
            name: name || tasks[taskIndex].name,
            description: description || tasks[taskIndex].description,
            date: date || tasks[taskIndex].date,
            project: project || tasks[taskIndex].project,
            poc: poc || tasks[taskIndex].poc,
            status: status || tasks[taskIndex].status,
            updatedAt: new Date().toISOString()
        };

        writeTasks(tasks);
        res.json(tasks[taskIndex]);
    } catch (error) {
        res.status(500).json({ error: 'Failed to update task' });
    }
});

// Delete task
app.delete('/api/tasks/:id', (req, res) => {
    try {
        const tasks = readTasks();
        const taskIndex = tasks.findIndex(t => t.id === req.params.id);

        if (taskIndex === -1) {
            return res.status(404).json({ error: 'Task not found' });
        }

        const deletedTask = tasks.splice(taskIndex, 1)[0];
        writeTasks(tasks);

        res.json({ message: 'Task deleted successfully', task: deletedTask });
    } catch (error) {
        res.status(500).json({ error: 'Failed to delete task' });
    }
});

// Get tasks by POC
app.get('/api/tasks/poc/:poc', (req, res) => {
    try {
        const tasks = readTasks();
        const pocTasks = tasks.filter(t =>
            t.poc.toLowerCase().includes(req.params.poc.toLowerCase())
        );
        res.json(pocTasks);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch tasks' });
    }
});

// Get tasks by project
app.get('/api/tasks/project/:project', (req, res) => {
    try {
        const tasks = readTasks();
        const projectTasks = tasks.filter(t =>
            t.project.toLowerCase().includes(req.params.project.toLowerCase())
        );
        res.json(projectTasks);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch tasks' });
    }
});

// Serve frontend
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start server
app.listen(PORT, () => {
    console.log(`Task Manager server running on http://localhost:${PORT}`);
});
