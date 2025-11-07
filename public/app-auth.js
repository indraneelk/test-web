// Authentication-enabled Task Manager Frontend

// State
let currentUser = null;
let tasks = [];
let projects = [];
let users = [];
let currentView = 'all';
let currentProjectId = null;
let currentFilters = {
    status: '',
    search: ''
};
let taskToDelete = null;
let currentProjectForSettings = null;

// API URLs
const API_AUTH = '/api/auth';
const API_USERS = '/api/users';
const API_PROJECTS = '/api/projects';
const API_TASKS = '/api/tasks';

// Initialize app
document.addEventListener('DOMContentLoaded', async () => {
    const isAuthenticated = await checkAuth();
    if (!isAuthenticated) {
        return; // Stop execution if not authenticated
    }
    setupEventListeners();
    await loadData();
});

// Check authentication
async function checkAuth() {
    try {
        const response = await fetch(`${API_AUTH}/me`, {
            credentials: 'include'
        });

        if (!response.ok) {
            window.location.href = '/login.html';
            return false;
        }

        const data = await response.json();
        currentUser = data.user;
        updateUserInfo();
        return true;
    } catch (error) {
        console.error('Auth check failed:', error);
        window.location.href = '/login.html';
        return false;
    }
}

// Update user info display
function updateUserInfo() {
    document.getElementById('userName').textContent = currentUser.name;
}

// Logout
async function logout() {
    try {
        await fetch(`${API_AUTH}/logout`, {
            method: 'POST',
            credentials: 'include'
        });
        window.location.href = '/login.html';
    } catch (error) {
        console.error('Logout error:', error);
    }
}

// Setup event listeners
function setupEventListeners() {
    document.getElementById('addTaskBtn').addEventListener('click', openTaskModal);
    document.getElementById('taskForm').addEventListener('submit', handleTaskSubmit);
    document.getElementById('projectForm').addEventListener('submit', handleProjectSubmit);

    document.getElementById('statusFilter').addEventListener('change', (e) => {
        currentFilters.status = e.target.value;
        renderTasks(filterTasks());
    });

    document.getElementById('searchInput').addEventListener('input', (e) => {
        currentFilters.search = e.target.value.toLowerCase();
        renderTasks(filterTasks());
    });

    // Close modals on escape
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeTaskModal();
            closeProjectModal();
            closeProjectSettingsModal();
            closeDeleteModal();
        }
    });
}

// Load all data
async function loadData() {
    await Promise.all([
        loadUsers(),
        loadProjects(),
        loadTasks()
    ]);
    updateUI();
}

// Load users
async function loadUsers() {
    try {
        const response = await fetch(API_USERS, {
            credentials: 'include'
        });
        users = await response.json();
    } catch (error) {
        console.error('Failed to load users:', error);
    }
}

// Load projects
async function loadProjects() {
    try {
        const response = await fetch(API_PROJECTS, {
            credentials: 'include'
        });
        projects = await response.json();
        renderProjectsNav();
    } catch (error) {
        console.error('Failed to load projects:', error);
    }
}

// Load tasks
async function loadTasks() {
    try {
        const response = await fetch(API_TASKS, {
            credentials: 'include'
        });
        tasks = await response.json();
    } catch (error) {
        console.error('Failed to load tasks:', error);
    }
}

// Switch view
function switchView(view) {
    currentView = view;
    currentProjectId = null;

    // Update nav items
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.remove('active');
        if (item.dataset.view === view) {
            item.classList.add('active');
        }
    });

    // Update project nav
    document.querySelectorAll('.project-nav-item').forEach(item => {
        item.classList.remove('active');
    });

    // Show/hide views
    if (view === 'projects') {
        document.getElementById('tasksView').style.display = 'none';
        document.getElementById('projectsView').style.display = 'block';
        document.getElementById('pageTitle').textContent = 'Projects';
        document.getElementById('addTaskBtn').style.display = 'none';
        renderProjectsGrid();
    } else {
        document.getElementById('tasksView').style.display = 'block';
        document.getElementById('projectsView').style.display = 'none';
        document.getElementById('addTaskBtn').style.display = 'flex';

        if (view === 'all') {
            document.getElementById('pageTitle').textContent = 'All Tasks';
        } else if (view === 'my-tasks') {
            document.getElementById('pageTitle').textContent = 'My Tasks';
        }

        renderTasks(filterTasks());
    }

    updateStats();
}

// Switch to project view
function switchToProject(projectId) {
    currentView = 'project';
    currentProjectId = projectId;

    const project = projects.find(p => p.id === projectId);
    if (!project) return;

    // Update nav
    document.querySelectorAll('.nav-item').forEach(item => item.classList.remove('active'));
    document.querySelectorAll('.project-nav-item').forEach(item => {
        item.classList.remove('active');
        if (item.dataset.projectId === projectId) {
            item.classList.add('active');
        }
    });

    // Show tasks view
    document.getElementById('tasksView').style.display = 'block';
    document.getElementById('projectsView').style.display = 'none';
    document.getElementById('addTaskBtn').style.display = 'flex';
    document.getElementById('pageTitle').textContent = `📁 ${project.name}`;

    renderTasks(filterTasks());
    updateStats();
}

// Render projects navigation
function renderProjectsNav() {
    const nav = document.getElementById('projectsNav');
    if (projects.length === 0) {
        nav.innerHTML = '<p style="padding: 0.5rem 0.75rem; color: var(--text-secondary); font-size: 0.875rem;">No projects yet</p>';
        return;
    }

    nav.innerHTML = projects.map(project => {
        const taskCount = tasks.filter(t => t.project_id === project.id).length;
        return `
            <button class="project-nav-item" data-project-id="${project.id}" onclick="switchToProject('${project.id}')">
                <span>
                    <span class="project-icon">📁</span>
                    ${escapeHtml(project.name)}
                </span>
                <span class="project-badge">${taskCount}</span>
            </button>
        `;
    }).join('');
}

// Render projects grid
function renderProjectsGrid() {
    const grid = document.getElementById('projectsGrid');
    const emptyState = document.getElementById('projectsEmptyState');

    if (projects.length === 0) {
        grid.innerHTML = '';
        emptyState.style.display = 'block';
        return;
    }

    emptyState.style.display = 'none';
    grid.innerHTML = projects.map(project => {
        const isOwner = project.owner_id === currentUser.id;
        const projectTasks = tasks.filter(t => t.project_id === project.id);
        const completedCount = projectTasks.filter(t => t.status === 'completed').length;
        const memberCount = (project.members?.length || 0) + 1; // +1 for owner

        return `
            <div class="project-card" onclick="switchToProject('${project.id}')">
                <div class="project-card-header">
                    <div>
                        <h3 class="project-card-title">${escapeHtml(project.name)}</h3>
                        ${isOwner ? '<span class="project-owner-badge">Owner</span>' : ''}
                    </div>
                    ${isOwner ? `
                        <button class="icon-btn" onclick="event.stopPropagation(); openProjectSettings('${project.id}')" title="Settings">⚙️</button>
                    ` : ''}
                </div>
                <p class="project-card-description">${escapeHtml(project.description || 'No description')}</p>
                <div class="project-card-stats">
                    <div class="project-stat">
                        <span>📝</span>
                        <span><span class="project-stat-number">${projectTasks.length}</span> tasks</span>
                    </div>
                    <div class="project-stat">
                        <span>✅</span>
                        <span><span class="project-stat-number">${completedCount}</span> done</span>
                    </div>
                    <div class="project-stat">
                        <span>👥</span>
                        <span><span class="project-stat-number">${memberCount}</span> members</span>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

// Filter tasks based on view and filters
function filterTasks() {
    let filtered = [...tasks];

    // Filter by view
    if (currentView === 'my-tasks') {
        filtered = filtered.filter(t => t.assigned_to_id === currentUser.id);
    } else if (currentView === 'project' && currentProjectId) {
        filtered = filtered.filter(t => t.project_id === currentProjectId);
    }

    // Filter by status
    if (currentFilters.status) {
        filtered = filtered.filter(t => t.status === currentFilters.status);
    }

    // Filter by search
    if (currentFilters.search) {
        filtered = filtered.filter(t =>
            t.name.toLowerCase().includes(currentFilters.search) ||
            t.description.toLowerCase().includes(currentFilters.search)
        );
    }

    return filtered;
}

// Render tasks
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

// Create task card HTML
function createTaskCard(task) {
    const dueDate = new Date(task.date);
    const formattedDate = dueDate.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
    });

    const isOverdue = new Date() > dueDate && task.status !== 'completed';
    const isCompleted = task.status === 'completed';

    const assignee = users.find(u => u.id === task.assigned_to_id);
    const creator = users.find(u => u.id === task.created_by_id);
    const project = projects.find(p => p.id === task.project_id);

    return `
        <div class="task-card ${task.status}">
            <div class="task-header">
                <div class="task-checkbox ${isCompleted ? 'checked' : ''}"
                     onclick="quickCompleteTask('${task.id}', ${!isCompleted})"
                     title="${isCompleted ? 'Mark as incomplete' : 'Mark as complete'}">
                </div>
                <div class="task-title-section">
                    <h3 class="task-title">${escapeHtml(task.name)}</h3>
                    ${project ? `<div class="task-project">📁 ${escapeHtml(project.name)}</div>` : ''}
                    ${creator ? `<div class="task-creator">Created by ${escapeHtml(creator.name)}</div>` : ''}
                </div>
                <div class="task-actions">
                    <button class="task-btn" onclick="editTask('${task.id}')" title="Edit task">✏️</button>
                    <button class="task-btn delete" onclick="deleteTask('${task.id}')" title="Delete task">🗑️</button>
                </div>
            </div>

            <p class="task-description">${escapeHtml(task.description)}</p>

            <div class="task-meta">
                <div class="task-meta-item">
                    <span class="assigned-to-badge">
                        👤 ${assignee ? escapeHtml(assignee.name) : 'Unknown'}
                    </span>
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

// Update stats
function updateStats() {
    const filtered = filterTasks();
    const total = filtered.length;
    const completed = filtered.filter(t => t.status === 'completed').length;
    const pending = filtered.filter(t => t.status === 'pending').length;

    document.getElementById('totalTasks').textContent = total;
    document.getElementById('completedTasks').textContent = completed;
    document.getElementById('pendingTasks').textContent = pending;
}

// Update UI
function updateUI() {
    if (currentView === 'projects') {
        renderProjectsGrid();
    } else {
        renderTasks(filterTasks());
    }
    updateStats();
}

// Open task modal
function openTaskModal() {
    document.getElementById('taskForm').reset();
    document.getElementById('taskId').value = '';
    document.getElementById('taskModalTitle').textContent = 'Create New Task';
    document.getElementById('taskSubmitBtnText').textContent = 'Create Task';

    // Set default date
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('taskDate').value = today;

    // Populate project dropdown
    const projectSelect = document.getElementById('taskProject');
    projectSelect.innerHTML = '<option value="">Select project...</option>' +
        projects.map(p => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('');

    // Pre-select current project if in project view
    if (currentProjectId) {
        projectSelect.value = currentProjectId;
        loadProjectMembers(currentProjectId);
    }

    // Listen for project changes
    projectSelect.addEventListener('change', (e) => {
        if (e.target.value) {
            loadProjectMembers(e.target.value);
        }
    });

    document.getElementById('taskModal').classList.add('active');
}

// Load project members for assignee dropdown
function loadProjectMembers(projectId) {
    const project = projects.find(p => p.id === projectId);
    if (!project) return;

    const assigneeSelect = document.getElementById('taskAssignee');
    const memberIds = [project.owner_id, ...(project.members || [])];
    const projectMembers = users.filter(u => memberIds.includes(u.id));

    assigneeSelect.innerHTML = '<option value="">Select person...</option>' +
        projectMembers.map(u => `<option value="${u.id}">${escapeHtml(u.name)}</option>`).join('');
}

// Close task modal
function closeTaskModal() {
    document.getElementById('taskModal').classList.remove('active');
}

// Edit task
function editTask(id) {
    const task = tasks.find(t => t.id === id);
    if (!task) return;

    document.getElementById('taskId').value = task.id;
    document.getElementById('taskName').value = task.name;
    document.getElementById('taskDescription').value = task.description;
    document.getElementById('taskDate').value = task.date;
    document.getElementById('taskStatus').value = task.status;

    // Populate dropdowns
    const projectSelect = document.getElementById('taskProject');
    projectSelect.innerHTML = '<option value="">Select project...</option>' +
        projects.map(p => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('');
    projectSelect.value = task.project_id;

    // Load project members and set assignee
    loadProjectMembers(task.project_id);
    document.getElementById('taskAssignee').value = task.assigned_to_id;

    document.getElementById('taskModalTitle').textContent = 'Edit Task';
    document.getElementById('taskSubmitBtnText').textContent = 'Update Task';

    openTaskModal();
}

// Handle task submit
async function handleTaskSubmit(e) {
    e.preventDefault();

    const submitBtn = e.target.querySelector('button[type="submit"]');
    const submitBtnText = document.getElementById('taskSubmitBtnText');
    const originalText = submitBtnText.textContent;

    // Disable form
    submitBtn.disabled = true;
    submitBtnText.textContent = 'Saving...';

    const taskId = document.getElementById('taskId').value;
    const previousTask = taskId ? tasks.find(t => t.id === taskId) : null;

    const taskData = {
        name: document.getElementById('taskName').value,
        description: document.getElementById('taskDescription').value,
        date: document.getElementById('taskDate').value,
        project_id: document.getElementById('taskProject').value,
        assigned_to_id: document.getElementById('taskAssignee').value,
        status: document.getElementById('taskStatus').value
    };

    try {
        const url = taskId ? `${API_TASKS}/${taskId}` : API_TASKS;
        const method = taskId ? 'PUT' : 'POST';

        const response = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(taskData)
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to save task');
        }

        const result = await response.json();

        closeTaskModal();
        await loadTasks();
        updateUI();

        // Check for celebration
        if (result._wasCompleted || (taskData.status === 'completed' && previousTask?.status !== 'completed')) {
            celebrate();
            showSuccess('🎉 Awesome! Task completed!');
        } else {
            showSuccess(taskId ? 'Task updated successfully!' : 'Task created successfully!');
        }
    } catch (error) {
        showError(error.message);
    } finally {
        // Re-enable form
        submitBtn.disabled = false;
        submitBtnText.textContent = originalText;
    }
}

// Quick complete task
async function quickCompleteTask(id, checked) {
    const task = tasks.find(t => t.id === id);
    if (!task) return;

    // Prevent multiple clicks
    const checkbox = event.target.closest('.task-checkbox');
    if (checkbox.dataset.loading === 'true') return;
    checkbox.dataset.loading = 'true';

    const newStatus = checked ? 'completed' : 'pending';

    try {
        const response = await fetch(`${API_TASKS}/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ ...task, status: newStatus })
        });

        if (!response.ok) throw new Error('Failed to update task');

        await loadTasks();
        updateUI();

        if (newStatus === 'completed') {
            celebrate();
            showSuccess('🎉 Awesome! Task completed!');
        }
    } catch (error) {
        showError('Failed to update task');
    } finally {
        checkbox.dataset.loading = 'false';
    }
}

// Delete task
function deleteTask(id) {
    taskToDelete = id;
    document.getElementById('deleteModal').classList.add('active');
}

function closeDeleteModal() {
    document.getElementById('deleteModal').classList.remove('active');
    taskToDelete = null;
}

async function confirmDelete() {
    if (!taskToDelete) return;

    const deleteBtn = document.querySelector('#deleteModal button.danger');
    const cancelBtn = document.querySelector('#deleteModal button:not(.danger)');

    // Disable buttons
    deleteBtn.disabled = true;
    cancelBtn.disabled = true;
    deleteBtn.textContent = 'Deleting...';

    try {
        const response = await fetch(`${API_TASKS}/${taskToDelete}`, {
            method: 'DELETE',
            credentials: 'include'
        });

        if (!response.ok) throw new Error('Failed to delete task');

        closeDeleteModal();
        await loadTasks();
        updateUI();
        showSuccess('Task deleted successfully');
    } catch (error) {
        showError('Failed to delete task');
    } finally {
        // Re-enable buttons
        deleteBtn.disabled = false;
        cancelBtn.disabled = false;
        deleteBtn.textContent = 'Delete';
    }
}

// PROJECT MANAGEMENT

// Open project modal
function openProjectModal() {
    document.getElementById('projectForm').reset();
    document.getElementById('projectId').value = '';
    document.getElementById('projectModalTitle').textContent = 'Create New Project';
    document.getElementById('projectSubmitBtnText').textContent = 'Create Project';
    document.getElementById('projectModal').classList.add('active');
}

// Close project modal
function closeProjectModal() {
    document.getElementById('projectModal').classList.remove('active');
}

// Handle project submit
async function handleProjectSubmit(e) {
    e.preventDefault();

    const submitBtn = e.target.querySelector('button[type="submit"]');
    const submitBtnText = document.getElementById('projectSubmitBtnText');
    const originalText = submitBtnText.textContent;

    // Disable form
    submitBtn.disabled = true;
    submitBtnText.textContent = 'Saving...';

    const projectId = document.getElementById('projectId').value;
    const projectData = {
        name: document.getElementById('projectName').value,
        description: document.getElementById('projectDescription').value
    };

    try {
        const url = projectId ? `${API_PROJECTS}/${projectId}` : API_PROJECTS;
        const method = projectId ? 'PUT' : 'POST';

        const response = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(projectData)
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to save project');
        }

        closeProjectModal();
        await loadProjects();
        renderProjectsGrid();
        showSuccess(projectId ? 'Project updated successfully!' : 'Project created successfully!');
    } catch (error) {
        showError(error.message);
    } finally {
        // Re-enable form
        submitBtn.disabled = false;
        submitBtnText.textContent = originalText;
    }
}

// Open project settings
function openProjectSettings(projectId) {
    currentProjectForSettings = projectId;
    const project = projects.find(p => p.id === projectId);
    if (!project) return;

    const owner = users.find(u => u.id === project.owner_id);

    document.getElementById('settingsProjectName').textContent = project.name;
    document.getElementById('settingsProjectOwner').textContent = owner?.name || 'Unknown';

    // Render members
    renderMembersList(project);

    // Populate add member dropdown
    const memberIds = [project.owner_id, ...(project.members || [])];
    const availableUsers = users.filter(u => !memberIds.includes(u.id));

    const select = document.getElementById('newMemberSelect');
    select.innerHTML = '<option value="">Add team member...</option>' +
        availableUsers.map(u => `<option value="${u.id}">${escapeHtml(u.name)}</option>`).join('');

    document.getElementById('projectSettingsModal').classList.add('active');
}

// Render members list
function renderMembersList(project) {
    const membersList = document.getElementById('membersList');
    const memberIds = project.members || [];
    const members = users.filter(u => memberIds.includes(u.id));

    if (members.length === 0) {
        membersList.innerHTML = '<p style="color: var(--text-secondary); font-size: 0.875rem;">No members yet. Add team members below.</p>';
        return;
    }

    membersList.innerHTML = members.map(member => `
        <div class="member-item">
            <div class="member-info">
                <div class="member-avatar"></div>
                <div class="member-details">
                    <div class="member-name">${escapeHtml(member.name)}</div>
                    <div class="member-role">Member</div>
                </div>
            </div>
            <div class="member-actions">
                <button onclick="removeMember('${member.id}')">Remove</button>
            </div>
        </div>
    `).join('');
}

// Add member
async function addMember() {
    const userId = document.getElementById('newMemberSelect').value;
    if (!userId || !currentProjectForSettings) return;

    const select = document.getElementById('newMemberSelect');
    const addBtn = event.target;

    // Disable controls
    select.disabled = true;
    addBtn.disabled = true;
    addBtn.textContent = 'Adding...';

    try {
        const response = await fetch(`${API_PROJECTS}/${currentProjectForSettings}/members`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ user_id: userId })
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to add member');
        }

        await loadProjects();
        const project = projects.find(p => p.id === currentProjectForSettings);
        renderMembersList(project);

        // Update dropdown
        const memberIds = [project.owner_id, ...(project.members || [])];
        const availableUsers = users.filter(u => !memberIds.includes(u.id));
        select.innerHTML = '<option value="">Add team member...</option>' +
            availableUsers.map(u => `<option value="${u.id}">${escapeHtml(u.name)}</option>`).join('');

        showSuccess('Member added successfully');
    } catch (error) {
        showError(error.message);
    } finally {
        // Re-enable controls
        select.disabled = false;
        addBtn.disabled = false;
        addBtn.textContent = 'Add';
    }
}

// Remove member
async function removeMember(userId) {
    if (!currentProjectForSettings) return;

    const removeBtn = event.target;
    const originalText = removeBtn.textContent;

    // Disable button
    removeBtn.disabled = true;
    removeBtn.textContent = 'Removing...';

    try {
        const response = await fetch(`${API_PROJECTS}/${currentProjectForSettings}/members/${userId}`, {
            method: 'DELETE',
            credentials: 'include'
        });

        if (!response.ok) throw new Error('Failed to remove member');

        await loadProjects();
        const project = projects.find(p => p.id === currentProjectForSettings);
        renderMembersList(project);

        // Update dropdown
        const memberIds = [project.owner_id, ...(project.members || [])];
        const availableUsers = users.filter(u => !memberIds.includes(u.id));
        const select = document.getElementById('newMemberSelect');
        select.innerHTML = '<option value="">Add team member...</option>' +
            availableUsers.map(u => `<option value="${u.id}">${escapeHtml(u.name)}</option>`).join('');

        showSuccess('Member removed successfully');
    } catch (error) {
        showError('Failed to remove member');
        // Re-enable button on error
        removeBtn.disabled = false;
        removeBtn.textContent = originalText;
    }
}

// Close project settings modal
function closeProjectSettingsModal() {
    document.getElementById('projectSettingsModal').classList.remove('active');
    currentProjectForSettings = null;
}

// Delete current project
async function deleteCurrentProject() {
    if (!currentProjectForSettings) return;

    if (!confirm('Are you sure you want to delete this project? All tasks will be deleted. This cannot be undone.')) {
        return;
    }

    const deleteBtn = event.target;
    const originalText = deleteBtn.textContent;

    // Disable button
    deleteBtn.disabled = true;
    deleteBtn.textContent = 'Deleting...';

    try {
        const response = await fetch(`${API_PROJECTS}/${currentProjectForSettings}`, {
            method: 'DELETE',
            credentials: 'include'
        });

        if (!response.ok) throw new Error('Failed to delete project');

        closeProjectSettingsModal();
        await Promise.all([loadProjects(), loadTasks()]);

        // Switch to all tasks view if we're viewing the deleted project
        if (currentProjectId === currentProjectForSettings) {
            switchView('all');
        } else {
            updateUI();
        }

        showSuccess('Project deleted successfully');
    } catch (error) {
        showError('Failed to delete project');
        // Re-enable button on error
        deleteBtn.disabled = false;
        deleteBtn.textContent = originalText;
    }
}

// CELEBRATION ANIMATION
function celebrate() {
    const duration = 3000;
    const animationEnd = Date.now() + duration;

    function randomInRange(min, max) {
        return Math.random() * (max - min) + min;
    }

    const interval = setInterval(function() {
        const timeLeft = animationEnd - Date.now();
        if (timeLeft <= 0) {
            return clearInterval(interval);
        }

        const particleCount = 50 * (timeLeft / duration);
        for (let i = 0; i < particleCount; i++) {
            createConfetti(randomInRange(0.1, 0.9), randomInRange(0.1, 0.3));
        }
    }, 250);
}

function createConfetti(x, y) {
    const confetti = document.createElement('div');
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

// UTILITY FUNCTIONS
function escapeHtml(text) {
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    };
    return String(text).replace(/[&<>"']/g, m => map[m]);
}

function showSuccess(message) {
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

function showError(message) {
    const notification = document.createElement('div');
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background-color: var(--danger-color);
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

// Add animations CSS
const style = document.createElement('style');
style.textContent = `
    @keyframes slideInRight {
        from { transform: translateX(100%); opacity: 0; }
        to { transform: translateX(0); opacity: 1; }
    }
    @keyframes slideOutRight {
        from { transform: translateX(0); opacity: 1; }
        to { transform: translateX(100%); opacity: 0; }
    }
    @keyframes confetti-fall {
        0% { transform: translateY(0) rotate(0deg); opacity: 1; }
        100% { transform: translateY(100vh) rotate(720deg); opacity: 0; }
    }
`;
document.head.appendChild(style);
