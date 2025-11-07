// API Base URL
const API_URL = '/api/tasks';

// State
let tasks = [];
let currentFilters = {
    poc: '',
    project: '',
    status: '',
    search: ''
};
let taskToDelete = null;

// Initialize app
document.addEventListener('DOMContentLoaded', () => {
    setupEventListeners();
    loadTasks();
});

// Event Listeners
function setupEventListeners() {
    // Add Task Button
    document.getElementById('addTaskBtn').addEventListener('click', openTaskModal);

    // Task Form Submit
    document.getElementById('taskForm').addEventListener('submit', handleTaskSubmit);

    // Filters
    document.getElementById('pocFilter').addEventListener('change', (e) => {
        currentFilters.poc = e.target.value;
        filterTasks();
    });

    document.getElementById('projectFilter').addEventListener('change', (e) => {
        currentFilters.project = e.target.value;
        filterTasks();
    });

    document.getElementById('statusFilter').addEventListener('change', (e) => {
        currentFilters.status = e.target.value;
        filterTasks();
    });

    // Search
    document.getElementById('searchInput').addEventListener('input', (e) => {
        currentFilters.search = e.target.value.toLowerCase();
        filterTasks();
    });
}

// Load all tasks
async function loadTasks() {
    try {
        showLoading();
        const response = await fetch(API_URL);

        if (!response.ok) {
            throw new Error('Failed to fetch tasks');
        }

        tasks = await response.json();
        updateFilterOptions();
        renderTasks(tasks);
        updateStats();
    } catch (error) {
        console.error('Error loading tasks:', error);
        showError('Failed to load tasks. Please refresh the page.');
    }
}

// Create or Update Task
async function handleTaskSubmit(e) {
    e.preventDefault();

    const taskId = document.getElementById('taskId').value;
    const previousStatus = taskId ? tasks.find(t => t.id === taskId)?.status : null;
    const taskData = {
        name: document.getElementById('taskName').value,
        description: document.getElementById('taskDescription').value,
        date: document.getElementById('taskDate').value,
        project: document.getElementById('taskProject').value,
        poc: document.getElementById('taskPoc').value,
        status: document.getElementById('taskStatus').value
    };

    try {
        let response;

        if (taskId) {
            // Update existing task
            response = await fetch(`${API_URL}/${taskId}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(taskData)
            });
        } else {
            // Create new task
            response = await fetch(API_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(taskData)
            });
        }

        if (!response.ok) {
            throw new Error('Failed to save task');
        }

        closeTaskModal();
        await loadTasks();

        // Check if task was just completed
        if (taskData.status === 'completed' && previousStatus !== 'completed') {
            celebrate();
            showSuccess('🎉 Awesome! Task completed!');
        } else {
            showSuccess(taskId ? 'Task updated successfully!' : 'Task created successfully!');
        }
    } catch (error) {
        console.error('Error saving task:', error);
        showError('Failed to save task. Please try again.');
    }
}

// Delete Task
async function deleteTask(id) {
    taskToDelete = id;
    document.getElementById('deleteModal').classList.add('active');
}

async function confirmDelete() {
    if (!taskToDelete) return;

    try {
        const response = await fetch(`${API_URL}/${taskToDelete}`, {
            method: 'DELETE'
        });

        if (!response.ok) {
            throw new Error('Failed to delete task');
        }

        closeDeleteModal();
        await loadTasks();
        showSuccess('Task deleted successfully!');
        taskToDelete = null;
    } catch (error) {
        console.error('Error deleting task:', error);
        showError('Failed to delete task. Please try again.');
    }
}

// Edit Task
function editTask(id) {
    const task = tasks.find(t => t.id === id);
    if (!task) return;

    document.getElementById('taskId').value = task.id;
    document.getElementById('taskName').value = task.name;
    document.getElementById('taskDescription').value = task.description;
    document.getElementById('taskDate').value = task.date;
    document.getElementById('taskProject').value = task.project;
    document.getElementById('taskPoc').value = task.poc;
    document.getElementById('taskStatus').value = task.status;

    document.getElementById('modalTitle').textContent = 'Edit Task';
    document.getElementById('submitBtnText').textContent = 'Update Task';

    openTaskModal();
}

// Render Tasks
function renderTasks(tasksToRender) {
    const taskList = document.getElementById('taskList');
    const emptyState = document.getElementById('emptyState');

    if (!tasksToRender || tasksToRender.length === 0) {
        taskList.innerHTML = '';
        emptyState.style.display = 'block';
        return;
    }

    emptyState.style.display = 'none';
    taskList.innerHTML = tasksToRender.map(task => createTaskCard(task)).join('');
}

// Create Task Card HTML
function createTaskCard(task) {
    const dueDate = new Date(task.date);
    const formattedDate = dueDate.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
    });

    const isOverdue = new Date() > dueDate && task.status !== 'completed';
    const isCompleted = task.status === 'completed';

    return `
        <div class="task-card ${task.status}">
            <div class="task-header">
                <div class="task-checkbox ${isCompleted ? 'checked' : ''}"
                     onclick="quickCompleteTask('${task.id}', ${!isCompleted})"
                     title="${isCompleted ? 'Mark as incomplete' : 'Mark as complete'}">
                </div>
                <div class="task-title-section">
                    <h3 class="task-title">${escapeHtml(task.name)}</h3>
                    <div class="task-project">📁 ${escapeHtml(task.project)}</div>
                </div>
                <div class="task-actions">
                    <button class="task-btn" onclick="editTask('${task.id}')" title="Edit task">✏️</button>
                    <button class="task-btn delete" onclick="deleteTask('${task.id}')" title="Delete task">🗑️</button>
                </div>
            </div>

            <p class="task-description">${escapeHtml(task.description)}</p>

            <div class="task-meta">
                <div class="task-meta-item">
                    <span class="task-meta-label">👤 POC:</span>
                    <span class="task-meta-value">${escapeHtml(task.poc)}</span>
                </div>
                <div class="task-meta-item">
                    <span class="task-meta-label">📅 Due:</span>
                    <span class="task-meta-value" style="${isOverdue ? 'color: var(--danger-color);' : ''}">${formattedDate}</span>
                </div>
            </div>

            <div class="task-footer">
                <span class="task-status ${task.status}">${task.status.replace('-', ' ')}</span>
            </div>
        </div>
    `;
}

// Filter Tasks
function filterTasks() {
    let filteredTasks = [...tasks];

    // Filter by POC
    if (currentFilters.poc) {
        filteredTasks = filteredTasks.filter(task =>
            task.poc.toLowerCase().includes(currentFilters.poc.toLowerCase())
        );
    }

    // Filter by Project
    if (currentFilters.project) {
        filteredTasks = filteredTasks.filter(task =>
            task.project.toLowerCase().includes(currentFilters.project.toLowerCase())
        );
    }

    // Filter by Status
    if (currentFilters.status) {
        filteredTasks = filteredTasks.filter(task =>
            task.status === currentFilters.status
        );
    }

    // Filter by Search
    if (currentFilters.search) {
        filteredTasks = filteredTasks.filter(task =>
            task.name.toLowerCase().includes(currentFilters.search) ||
            task.description.toLowerCase().includes(currentFilters.search) ||
            task.project.toLowerCase().includes(currentFilters.search) ||
            task.poc.toLowerCase().includes(currentFilters.search)
        );
    }

    renderTasks(filteredTasks);
}

// Update Filter Options
function updateFilterOptions() {
    // Get unique POCs and Projects
    const pocs = [...new Set(tasks.map(task => task.poc))].sort();
    const projects = [...new Set(tasks.map(task => task.project))].sort();

    // Update POC filter
    const pocFilter = document.getElementById('pocFilter');
    pocFilter.innerHTML = '<option value="">All Members</option>' +
        pocs.map(poc => `<option value="${escapeHtml(poc)}">${escapeHtml(poc)}</option>`).join('');

    // Update Project filter
    const projectFilter = document.getElementById('projectFilter');
    projectFilter.innerHTML = '<option value="">All Projects</option>' +
        projects.map(project => `<option value="${escapeHtml(project)}">${escapeHtml(project)}</option>`).join('');
}

// Update Stats
function updateStats() {
    const total = tasks.length;
    const completed = tasks.filter(task => task.status === 'completed').length;
    const pending = tasks.filter(task => task.status === 'pending').length;

    document.getElementById('totalTasks').textContent = total;
    document.getElementById('completedTasks').textContent = completed;
    document.getElementById('pendingTasks').textContent = pending;
}

// Modal Functions
function openTaskModal() {
    // Reset form
    document.getElementById('taskForm').reset();
    document.getElementById('taskId').value = '';
    document.getElementById('modalTitle').textContent = 'Create New Task';
    document.getElementById('submitBtnText').textContent = 'Create Task';

    // Set default date to today
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('taskDate').value = today;

    document.getElementById('taskModal').classList.add('active');
}

function closeTaskModal() {
    document.getElementById('taskModal').classList.remove('active');
}

function closeDeleteModal() {
    document.getElementById('deleteModal').classList.remove('active');
    taskToDelete = null;
}

// Utility Functions
function escapeHtml(text) {
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    };
    return text.replace(/[&<>"']/g, m => map[m]);
}

function showLoading() {
    const taskList = document.getElementById('taskList');
    taskList.innerHTML = '<div class="loading">Loading tasks</div>';
}

function showError(message) {
    alert(message);
}

function showSuccess(message) {
    // Simple success notification
    const notification = document.createElement('div');
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background-color: var(--success-color);
        color: white;
        padding: 1rem 1.5rem;
        border-radius: 0.5rem;
        box-shadow: var(--shadow-lg);
        z-index: 10000;
        animation: slideInRight 0.3s;
    `;
    notification.textContent = message;

    document.body.appendChild(notification);

    setTimeout(() => {
        notification.style.animation = 'slideOutRight 0.3s';
        setTimeout(() => notification.remove(), 300);
    }, 3000);
}

// Close modals when clicking outside
document.addEventListener('click', (e) => {
    if (e.target.classList.contains('modal-backdrop')) {
        closeTaskModal();
        closeDeleteModal();
    }
});

// Close modals with Escape key
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        closeTaskModal();
        closeDeleteModal();
    }
});

// Quick complete task (from checkbox in card)
async function quickCompleteTask(id, checked) {
    const task = tasks.find(t => t.id === id);
    if (!task) return;

    const newStatus = checked ? 'completed' : 'pending';

    try {
        const response = await fetch(`${API_URL}/${id}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                ...task,
                status: newStatus
            })
        });

        if (!response.ok) {
            throw new Error('Failed to update task');
        }

        await loadTasks();

        if (newStatus === 'completed') {
            celebrate();
            showSuccess('🎉 Awesome! Task completed!');
        }
    } catch (error) {
        console.error('Error updating task:', error);
        showError('Failed to update task. Please try again.');
    }
}

// Celebration animation (confetti effect)
function celebrate() {
    const duration = 3000;
    const animationEnd = Date.now() + duration;
    const defaults = { startVelocity: 30, spread: 360, ticks: 60, zIndex: 10000 };

    function randomInRange(min, max) {
        return Math.random() * (max - min) + min;
    }

    const interval = setInterval(function() {
        const timeLeft = animationEnd - Date.now();

        if (timeLeft <= 0) {
            return clearInterval(interval);
        }

        const particleCount = 50 * (timeLeft / duration);

        // Create confetti particles
        for (let i = 0; i < particleCount; i++) {
            createConfetti(
                randomInRange(0.1, 0.3),
                randomInRange(0.1, 0.3)
            );
        }
    }, 250);
}

function createConfetti(x, y) {
    const confetti = document.createElement('div');
    confetti.className = 'confetti';

    const colors = ['#f06a6a', '#13ce66', '#ffc82c', '#4f46e5', '#ff4949'];
    const color = colors[Math.floor(Math.random() * colors.length)];

    confetti.style.cssText = `
        position: fixed;
        width: 10px;
        height: 10px;
        background-color: ${color};
        left: ${x * 100}%;
        top: ${y * 100}%;
        opacity: 1;
        transform: rotate(0deg);
        animation: confetti-fall ${2 + Math.random() * 2}s linear forwards;
        z-index: 10000;
        border-radius: ${Math.random() > 0.5 ? '50%' : '0'};
    `;

    document.body.appendChild(confetti);

    setTimeout(() => confetti.remove(), 4000);
}

// Add animations to CSS dynamically
const style = document.createElement('style');
style.textContent = `
    @keyframes slideInRight {
        from {
            transform: translateX(100%);
            opacity: 0;
        }
        to {
            transform: translateX(0);
            opacity: 1;
        }
    }

    @keyframes slideOutRight {
        from {
            transform: translateX(0);
            opacity: 1;
        }
        to {
            transform: translateX(100%);
            opacity: 0;
        }
    }

    @keyframes confetti-fall {
        0% {
            transform: translateY(0) rotate(0deg);
            opacity: 1;
        }
        100% {
            transform: translateY(100vh) rotate(720deg);
            opacity: 0;
        }
    }

    .task-checkbox {
        width: 20px;
        height: 20px;
        border: 2px solid var(--border-color);
        border-radius: 50%;
        cursor: pointer;
        transition: all 0.2s;
        flex-shrink: 0;
    }

    .task-checkbox:hover {
        border-color: var(--success-color);
        transform: scale(1.1);
    }

    .task-checkbox.checked {
        background-color: var(--success-color);
        border-color: var(--success-color);
        position: relative;
    }

    .task-checkbox.checked::after {
        content: '✓';
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        color: white;
        font-size: 14px;
        font-weight: bold;
    }

    .task-card.completed .task-title {
        text-decoration: line-through;
        opacity: 0.7;
    }
`;
document.head.appendChild(style);
