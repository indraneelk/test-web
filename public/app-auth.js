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
    search: '',
    priority: '',
    sort: '', // none (no sorting)
    showArchived: false
};
let taskToDelete = null;
let currentProjectForSettings = null;
let currentProjectDetailsId = null;
let projectToDelete = null;

// Date helpers (DD/MM/YYYY <-> ISO YYYY-MM-DD)
function formatDateToDMY(iso) {
    if (!iso) return '';
    const [y, m, d] = String(iso).split('-');
    if (!y || !m || !d) return '';
    return `${d.padStart(2,'0')}/${m.padStart(2,'0')}/${y}`;
}
function parseDMYToISO(dmy) {
    if (!dmy) return null;
    const parts = String(dmy).replace(/[^0-9/]/g,'').split('/');
    if (parts.length !== 3) return null;
    let [dd, mm, yyyy] = parts;
    if (!dd || !mm || !yyyy) return null;
    if (yyyy.length !== 4) return null;
    const d = parseInt(dd, 10), m = parseInt(mm, 10), y = parseInt(yyyy, 10);
    if (!(d>=1 && d<=31) || !(m>=1 && m<=12) || !(y>=1900)) return null;
    // Basic validity check using Date
    const iso = `${y.toString().padStart(4,'0')}-${m.toString().padStart(2,'0')}-${d.toString().padStart(2,'0')}`;
    const dt = new Date(iso + 'T00:00:00Z');
    if (isNaN(dt.getTime())) return null;
    return iso;
}

// API URLs
const API_AUTH = '/api/auth';
const API_USERS = '/api/users';
const API_PROJECTS = '/api/projects';
const API_TASKS = '/api/tasks';

// Supabase client + Bearer token helper
let supa = null;
async function ensureSupabase() {
    if (supa) return supa;
    try {
        const cfgResp = await fetch('/api/config/public', { credentials: 'include' });
        if (!cfgResp.ok) return null;
        const cfg = await cfgResp.json();
        if (window.supabase && cfg.supabaseUrl && cfg.supabaseAnonKey) {
            supa = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
        }
    } catch (_) {}
    return supa;
}

async function getAccessToken() {
    // Prefer supabase-js session; do not duplicate tokens in storage
    try {
        const client = await ensureSupabase();
        if (client) {
            const { data } = await client.auth.getSession();
            if (data?.session?.access_token) return data.session.access_token;
        }
    } catch (_) {}
    return null;
}

async function authFetch(url, options = {}) {
    const origOptions = { ...options };
    let token = await getAccessToken();
    let headers = new Headers(options.headers || {});
    if (token) headers.set('Authorization', `Bearer ${token}`);
    let resp = await fetch(url, { ...options, headers, credentials: token ? undefined : 'include' });
    if (resp.status !== 401) return resp;
    // Attempt one silent refresh via supabase-js and retry once
    try {
        const client = await ensureSupabase();
        if (client) {
            await client.auth.refreshSession();
            const { data } = await client.auth.getSession();
            const newToken = data?.session?.access_token || null;
            if (newToken && newToken !== token) {
                const retryHeaders = new Headers(origOptions.headers || {});
                retryHeaders.set('Authorization', `Bearer ${newToken}`);
                return await fetch(url, { ...origOptions, headers: retryHeaders, credentials: undefined });
            }
        }
    } catch (_) { /* ignore and fall through */ }
    return resp;
}

// Initialize app
document.addEventListener('DOMContentLoaded', async () => {
    const isAuthenticated = await checkAuth();
    if (!isAuthenticated) {
        return; // Stop execution if not authenticated
    }
    setupEventListeners();
    await loadData();
    initMobileUI();
    // Plan B: Supabase Realtime subscription (optional)
    try {
        const client = await ensureSupabase();
        if (client) {
            const ch = client.channel('task-updates');
            ch.on('broadcast', { event: 'task-created' }, () => loadData());
            ch.on('broadcast', { event: 'task-updated' }, () => loadData());
            ch.on('broadcast', { event: 'task-deleted' }, () => loadData());
            ch.on('broadcast', { event: 'project-created' }, () => loadData());
            ch.on('broadcast', { event: 'project-updated' }, () => loadData());
            ch.on('broadcast', { event: 'project-deleted' }, () => loadData());
            await ch.subscribe();
        }
    } catch (_) {}

    // Plan A: Polling for updates (every 60 seconds)
    setInterval(async () => {
        await loadData();
    }, 60000); // 60 seconds

    // Plan A: Refetch when tab becomes visible
    document.addEventListener('visibilitychange', async () => {
        if (!document.hidden) {
            await loadData();
        }
    });
});

// Check authentication
async function checkAuth() {
    try {
        const response = await authFetch(`${API_AUTH}/me`);

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
    document.getElementById('userName').textContent = currentUser.username || currentUser.name;
    const avatar = document.getElementById('userAvatar');
    if (avatar) {
        const initials = (currentUser.initials && currentUser.initials.trim())
            ? currentUser.initials.trim().toUpperCase()
            : (currentUser.username || currentUser.name).split(/\s+/).map(w => w[0]).slice(0,2).join('').toUpperCase();
        avatar.textContent = initials;
    }
    // Update mobile avatar
    const mobileAvatar = document.getElementById('mobileUserAvatar');
    if (mobileAvatar) {
        const initials = (currentUser.initials && currentUser.initials.trim())
            ? currentUser.initials.trim().toUpperCase()
            : (currentUser.username || currentUser.name).split(/\s+/).map(w => w[0]).slice(0,2).join('').toUpperCase();
        mobileAvatar.textContent = initials;
        // Set color if user has one
        if (currentUser.color) {
            mobileAvatar.style.backgroundColor = currentUser.color;
        }
    }

    // Show admin link for super admin
    const adminLink = document.getElementById('adminLink');
    if (adminLink && currentUser.email === 'Indraneel.kasmalkar@gmail.com') {
        adminLink.style.display = 'flex';
    }
}

// Logout
async function logout() {
    try {
        await authFetch(`${API_AUTH}/logout`, {
            method: 'POST',
            credentials: 'include'
        });
    } catch (error) {
        console.error('Logout error:', error);
    } finally {
        // Always redirect to login, even if API call failed
        window.location.href = '/login.html';
    }
}

// Setup event listeners
function setupEventListeners() {
    document.getElementById('addTaskBtn').addEventListener('click', openTaskModal);
    document.getElementById('taskForm').addEventListener('submit', handleTaskSubmit);
    document.getElementById('projectForm').addEventListener('submit', handleProjectSubmit);
    const userSettingsForm = document.getElementById('userSettingsForm');
    if (userSettingsForm) {
        userSettingsForm.addEventListener('submit', handleUserSettingsSubmit);
    }

    // Desktop avatar opens profile update
    const desktopAvatar = document.getElementById('userAvatar');
    if (desktopAvatar) {
        desktopAvatar.addEventListener('click', () => {
            window.location.href = '/profile-update.html';
        });
    }

    // Project dropdown change listener for task modal
    const taskProjectSelect = document.getElementById('taskProject');
    if (taskProjectSelect) {
        taskProjectSelect.addEventListener('change', (e) => {
            const assigneeSelect = document.getElementById('taskAssignee');
            if (e.target.value) {
                loadProjectMembers(e.target.value);
            } else {
                // Reset assignee if no project selected
                assigneeSelect.disabled = false;
                assigneeSelect.innerHTML = '<option value="">Select person...</option>';
            }
        });
    }

    const statusEl = document.getElementById('statusFilter');
    if (statusEl) {
        statusEl.addEventListener('change', (e) => {
            currentFilters.status = e.target.value;
            renderTasks(filterTasks());
        });
    }

    const priorityFilterEl = document.getElementById('priorityFilter');
    if (priorityFilterEl) {
        priorityFilterEl.addEventListener('change', (e) => {
            currentFilters.priority = e.target.value;
            renderTasks(filterTasks());
        });
    }

    const sortSelectEl = document.getElementById('sortSelect');
    if (sortSelectEl) {
        sortSelectEl.addEventListener('change', (e) => {
            currentFilters.sort = e.target.value;
            renderTasks(filterTasks());
        });
    }

    const showArchivedToggleEl = document.getElementById('showArchivedToggle');
    if (showArchivedToggleEl) {
        showArchivedToggleEl.addEventListener('change', (e) => {
            currentFilters.showArchived = e.target.checked;
            renderTasks(filterTasks());
        });
    }

    document.getElementById('searchInput').addEventListener('input', (e) => {
        currentFilters.search = e.target.value.toLowerCase();
        renderTasks(filterTasks());
    });

    // Close modals on escape
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeTaskDetailsModal();
            closeTaskModal();
            closeProjectModal();
            // Project Details modal deprecated
            closeProjectSettingsModal();
            closeDeleteModal();
        }
    });

    // Color preset buttons
    document.querySelectorAll('.color-preset').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const color = e.currentTarget.getAttribute('data-color');
            document.getElementById('projectColor').value = color;
            updateColorPresetSelection(color);
        });
    });
}

// MOBILE UI FUNCTIONS
function initMobileUI() {
    // Mobile project dropdown
    const mobileProjectSelect = document.getElementById('mobileProjectSelect');
    if (mobileProjectSelect) {
        renderMobileProjectOptions();
        mobileProjectSelect.addEventListener('change', (e) => {
            const value = e.target.value;
            if (value === 'add-project') {
                openProjectModal();
                // Reset to current selection
                e.target.value = currentProjectId || '';
                return;
            }
            if (!value) {
                switchView('all');
            } else {
                switchToProject(value);
            }
        });
    }

    // Mobile project settings button
    const mobileProjectSettingsBtn = document.getElementById('mobileProjectSettingsBtn');
    if (mobileProjectSettingsBtn) {
        mobileProjectSettingsBtn.addEventListener('click', () => {
            if (currentProjectId) {
                openProjectSettings(currentProjectId);
            } else {
                openProjectModal();
            }
        });
    }

    // Mobile user avatar click
    const mobileUserAvatar = document.getElementById('mobileUserAvatar');
    if (mobileUserAvatar) {
        mobileUserAvatar.addEventListener('click', () => {
            window.location.href = '/profile-update.html';
        });
    }

    // Mobile create task button
    const mobileCreateTaskBtn = document.getElementById('mobileCreateTaskBtn');
    if (mobileCreateTaskBtn) {
        mobileCreateTaskBtn.addEventListener('click', openTaskModal);
    }

    // Mobile sort dropdown
    const mobileSortSelect = document.getElementById('mobileSortSelect');
    if (mobileSortSelect) {
        mobileSortSelect.value = currentFilters.sort || '';
        mobileSortSelect.addEventListener('change', (e) => {
            currentFilters.sort = e.target.value;
            renderTasks(filterTasks());
        });
    }

    // Mobile priority filter dropdown
    const mobilePriorityFilter = document.getElementById('mobilePriorityFilter');
    if (mobilePriorityFilter) {
        mobilePriorityFilter.value = currentFilters.priority || '';
        mobilePriorityFilter.addEventListener('change', (e) => {
            currentFilters.priority = e.target.value;
            renderTasks(filterTasks());
        });
    }

    // Mobile archived toggle
    const mobileShowArchived = document.getElementById('mobileShowArchived');
    if (mobileShowArchived) {
        mobileShowArchived.checked = !!currentFilters.showArchived;
        mobileShowArchived.addEventListener('change', (e) => {
            currentFilters.showArchived = e.target.checked;
            renderTasks(filterTasks());
        });
    }

    // Compact footer selects when space is tight: hide text, keep arrow only
    function updateFooterCompact() {
        document.querySelectorAll('.mobile-footer .custom-select-trigger').forEach(tr => {
            const w = tr.clientWidth || 0;
            if (w > 0 && w < 140) {
                tr.classList.add('compact');
            } else {
                tr.classList.remove('compact');
            }
        });
    }
    setTimeout(updateFooterCompact, 0);
    window.addEventListener('resize', updateFooterCompact, { passive: true });
}

function renderMobileProjectOptions() {
    const select = document.getElementById('mobileProjectSelect');
    if (!select) return;

    const options = [
        `<option value="">All Tasks</option>`,
        ...projects.map(p => `<option value="${p.id}" ${currentProjectId === p.id ? 'selected' : ''}>${escapeHtml(p.name)}</option>`),
        `<option value="add-project">+ Add Project</option>`
    ];

    select.innerHTML = options.join('');

    // Ensure correct selection
    if (!currentProjectId) {
        select.value = '';
    }

    // Refresh custom select UI (mobile topbar) to match the app aesthetic
    if (select._customSelect) {
        select._customSelect.refresh();
    } else if (typeof initCustomSelects === 'function') {
        setTimeout(initCustomSelects, 0);
    }
}

// USER SETTINGS
function openUserSettings() {
    if (!currentUser) {
        console.error('Cannot open user settings: currentUser is null');
        console.log('Attempting to reload user data...');
        checkAuth().then(() => {
            if (currentUser) {
                openUserSettings(); // Retry after loading
            } else {
                alert('Unable to load user data. Please refresh the page.');
            }
        });
        return;
    }
    document.getElementById('userId').value = currentUser.id || '';
    document.getElementById('profileUsername').value = currentUser.username || '';
    document.getElementById('profileName').value = currentUser.name || '';
    document.getElementById('profileEmail').value = currentUser.email || '';
    document.getElementById('profileInitials').value = currentUser.initials || '';
    document.getElementById('profilePassword').value = '';
    document.getElementById('userSettingsModal').classList.add('active');
}

function closeUserSettings() {
    document.getElementById('userSettingsModal').classList.remove('active');
}

async function handleUserSettingsSubmit(e) {
    e.preventDefault();
    const btn = e.target.querySelector('button[type="submit"]');
    const original = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Saving...';

    const payload = {
        username: document.getElementById('profileUsername').value,
        name: document.getElementById('profileName').value,
        email: document.getElementById('profileEmail').value,
        initials: document.getElementById('profileInitials').value,
        password: document.getElementById('profilePassword').value
    };
    if (!payload.password) delete payload.password;

    try {
        const resp = await authFetch(`${API_AUTH}/me`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await resp.json();
        if (!resp.ok) throw new Error(data.error || 'Failed to update profile');
        currentUser = data.user;
        updateUserInfo();
        closeUserSettings();
        showSuccess('Profile updated');
    } catch (err) {
        showError(err.message);
    } finally {
        btn.disabled = false;
        btn.textContent = original;
    }
}

// Highlight selected color preset with a black border
function updateColorPresetSelection(selectedColor) {
    document.querySelectorAll('.color-preset').forEach(btn => {
        const c = btn.getAttribute('data-color');
        btn.classList.toggle('selected', c?.toLowerCase() === selectedColor?.toLowerCase());
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
        const response = await authFetch(API_USERS);
        users = await response.json();
    } catch (error) {
        console.error('Failed to load users:', error);
    }
}

// Load projects
async function loadProjects() {
    try {
        const response = await authFetch(API_PROJECTS);
        projects = await response.json();
        renderProjectsNav();
        renderMobileProjectOptions();
    } catch (error) {
        console.error('Failed to load projects:', error);
    }
}

// Load tasks
async function loadTasks() {
    try {
        const response = await authFetch(API_TASKS);
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
    renderMobileProjectOptions();
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
    // Show project color dot in the header title instead of folder emoji
    const titleEl = document.getElementById('pageTitle');
    const projectColor = project.color || '#f06a6a';
    titleEl.innerHTML = `
        <span class=\"project-color-dot\" style=\"width:10px;height:10px;background-color:${projectColor};display:inline-block;vertical-align:middle;\"></span>
        ${escapeHtml(project.name)}
        <button class=\"icon-btn title-gear\" type=\"button\" onclick=\"openProjectSettings('${project.id}')\" title=\"Project settings\">⚙️</button>
    `;

    renderTasks(filterTasks());
    updateStats();
    renderMobileProjectOptions();
}

// Render projects navigation
function renderProjectsNav() {
    const nav = document.getElementById('projectsNav');
    if (projects.length === 0) {
        nav.innerHTML = '<p style="padding: 0.5rem 0.75rem; color: var(--text-secondary); font-size: 0.875rem;">No projects yet</p>';
        return;
    }

    nav.innerHTML = projects.map(project => {
        const projectColor = project.color || '#f06a6a';
        return `
            <button class="project-nav-item" data-project-id="${project.id}" onclick="switchToProject('${project.id}')">
                <span style="display: flex; align-items: center; gap: 0.5rem;">
                    <span class="project-color-indicator" style="background-color: ${projectColor}"></span>
                    ${escapeHtml(project.name)}
                </span>
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
            <div class=\"project-card\" onclick=\"openProjectSettings('${project.id}')\">
                <div class="project-card-header">
                    <div>
                        <h3 class="project-card-title">
                            <span class="project-color-indicator" style="background-color: ${project.color || '#f06a6a'}; margin-right: 6px;"></span>
                            ${escapeHtml(project.name)}
                        </h3>
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

    // Filter by status (legacy; no UI currently sets this)
    if (currentFilters.status) {
        filtered = filtered.filter(t => t.status === currentFilters.status);
    }

    // Filter by priority
    if (currentFilters.priority) {
        filtered = filtered.filter(t => (t.priority || 'none').toLowerCase() === currentFilters.priority);
    }

    // Filter archived tasks (exclude by default unless showArchived is true)
    if (!currentFilters.showArchived) {
        filtered = filtered.filter(t => !t.archived);
    }

    // Filter by search
    if (currentFilters.search) {
        filtered = filtered.filter(t =>
            t.name.toLowerCase().includes(currentFilters.search) ||
            t.description.toLowerCase().includes(currentFilters.search)
        );
    }

    // Sort
    const sortMode = currentFilters.sort || '';
    if (sortMode === 'priority') {
        const rank = { high: 1, medium: 2, low: 3, none: 4 };
        filtered.sort((a, b) => {
            const ra = rank[(a.priority || 'none').toLowerCase()] ?? 99;
            const rb = rank[(b.priority || 'none').toLowerCase()] ?? 99;
            if (ra !== rb) return ra - rb;
            const ad = new Date(a.date || a.created_at || 0).getTime();
            const bd = new Date(b.date || b.created_at || 0).getTime();
            return bd - ad;
        });
    } else if (sortMode === 'due') {
        filtered.sort((a, b) => {
            // Ascending by due date (earliest first). Missing dates go last.
            const ad = new Date(a.date || 0).getTime();
            const bd = new Date(b.date || 0).getTime();
            const aDue = isNaN(ad) ? Infinity : ad;
            const bDue = isNaN(bd) ? Infinity : bd;
            if (aDue !== bDue) return aDue - bDue;
            // Tie-breaker: newest created first
            const ac = new Date(a.created_at || 0).getTime();
            const bc = new Date(b.created_at || 0).getTime();
            return bc - ac;
        });
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
        // Hide mobile create button when showing empty state button to avoid duplicates
        const mobileCreate = document.querySelector('.mobile-create-wrap');
        if (mobileCreate) mobileCreate.style.display = 'none';
        return;
    }

    emptyState.style.display = 'none';
    taskList.innerHTML = tasksToRender.map(task => createTaskCard(task)).join('');
    // Show mobile create button when there are tasks
    const mobileCreate = document.querySelector('.mobile-create-wrap');
    if (mobileCreate) mobileCreate.style.display = '';
}

// Create task card HTML
function createTaskCard(task) {
    const dueDate = new Date(task.date);
    const formattedDate = dueDate.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric'
    });

    const isOverdue = new Date() > dueDate && task.status !== 'completed';
    const isCompleted = task.status === 'completed';

    const project = projects.find(p => p.id === task.project_id);

    // Generate project abbreviation (max 8 characters)
    let projectAbbr = '';
    let projectColor = '#cccccc';
    if (project) {
        // Special case for personal projects
        if (project.name.toLowerCase().includes('personal')) {
            projectAbbr = 'Personal';
        } else {
            // Use project name, truncated to 8 characters with first letter capitalized
            const name = project.name.substring(0, 8);
            projectAbbr = name.charAt(0).toUpperCase() + name.slice(1);
        }
        projectColor = project.color || '#f06a6a';
    }

    // Priority indicator colors (normalize value)
    const priority = (typeof task.priority === 'string' ? task.priority : 'none').toLowerCase().trim();
    const priorityColors = {
        'high': '#ef4444',      // red
        'medium': '#f59e0b',    // orange/yellow
        'low': '#10b981'        // green
    };
    const priorityColor = priorityColors[priority];
    const showPriorityTriangle = priority !== 'none' && priorityColor;

    // Get assignee and use their profile initials and color
    const assignee = users.find(u => u.id === task.assigned_to_id);
    let assigneeInitials = '';
    let assigneeColor = '#667eea';
    if (assignee) {
        // Use the initials from the user's profile
        assigneeInitials = assignee.initials || '';

        // Use the color from the user's profile
        assigneeColor = assignee.color || '#667eea';
    }

    return `
        <div class="task-card-compact ${task.status}" onclick="viewTaskDetails('${task.id}')" style="border-left-color: ${projectColor};">
            ${showPriorityTriangle ? `<div class="priority-triangle" style="border-color: transparent ${priorityColor} transparent transparent;" title="Priority: ${priority}"></div>` : ''}
            <div class="task-card-main">
                <button class="task-checkbox ${isCompleted ? 'checked' : ''}"
                        onclick="event.stopPropagation(); quickCompleteTask('${task.id}', ${!isCompleted})"
                        title="${isCompleted ? 'Mark as incomplete' : 'Mark as complete'}">
                    ${isCompleted ? '<span class="checkmark">✓</span>' : ''}
                </button>
                <h3 class="task-title-compact">${escapeHtml(task.name)}</h3>
            </div>
            <div class="task-card-footer">
                <div class="task-footer-left">
                    ${assignee ? `
                        <div class="assignee-circle" style="background-color: ${assigneeColor}" title="${escapeHtml(assignee.name)}">
                            ${assigneeInitials}
                        </div>
                    ` : ''}
                    <span class="task-due ${isOverdue ? 'overdue' : ''}">${formattedDate}</span>
                </div>
                ${project ? `
                    <div class="task-project-badge">
                        <span class="project-abbr">${projectAbbr}</span>
                        <span class="project-color-dot" style="background-color: ${projectColor}"></span>
                    </div>
                ` : ''}
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

    // Set default date (DD/MM/YYYY)
    const now = new Date();
    const dd = String(now.getDate()).padStart(2,'0');
    const mm = String(now.getMonth()+1).padStart(2,'0');
    const yyyy = String(now.getFullYear());
    document.getElementById('taskDate').value = `${dd}/${mm}/${yyyy}`;

    // Ensure priority default reflects in custom select UI
    const prioritySelect = document.getElementById('taskPriority');
    if (prioritySelect) {
        prioritySelect.value = 'none';
        prioritySelect.dispatchEvent(new Event('change', { bubbles: true }));
    }

    // Populate project dropdown
    const projectSelect = document.getElementById('taskProject');
    projectSelect.innerHTML = '<option value="">Select project...</option>' +
        projects.map(p => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('');

    // Reset assignee dropdown to default state
    const assigneeSelect = document.getElementById('taskAssignee');
    assigneeSelect.disabled = false;
    assigneeSelect.innerHTML = '<option value="">Select person...</option>';

    // Pre-select current project if in project view
    if (currentProjectId) {
        projectSelect.value = currentProjectId;
        loadProjectMembers(currentProjectId);
    }

    document.getElementById('taskModal').classList.add('active');
}

// Ensure global access for inline handlers used in HTML (e.g., empty-state button, close X)
window.openTaskModal = window.openTaskModal || openTaskModal;
window.closeTaskModal = window.closeTaskModal || closeTaskModal;

// Load project members for assignee dropdown
function loadProjectMembers(projectId) {
    const project = projects.find(p => p.id === projectId);
    if (!project) return;

    const assigneeSelect = document.getElementById('taskAssignee');
    const memberIds = [project.owner_id, ...(project.members || [])];
    const projectMembers = users.filter(u => memberIds.includes(u.id));

    // For personal projects, disable the dropdown and auto-select the owner
    if (project.is_personal) {
        assigneeSelect.disabled = true;
        assigneeSelect.innerHTML = projectMembers.map(u => `<option value="${u.id}">${escapeHtml(u.name)}</option>`).join('');
        assigneeSelect.value = project.owner_id;
    } else {
        assigneeSelect.disabled = false;
        assigneeSelect.innerHTML = '<option value="">Select person...</option>' +
            projectMembers.map(u => `<option value="${u.id}">${escapeHtml(u.name)}</option>`).join('');
    }
}

// Close task modal
function closeTaskModal() {
    document.getElementById('taskModal').classList.remove('active');
}

// Edit task
function editTask(id) {
    try {
        const task = tasks.find(t => t.id === id);
        if (!task) {
            showError('Task not found');
            return;
        }

        document.getElementById('taskId').value = task.id;
        document.getElementById('taskName').value = task.name || '';
        document.getElementById('taskDescription').value = task.description || '';
        document.getElementById('taskDate').value = formatDateToDMY(task.date) || '';
        const prioSel = document.getElementById('taskPriority');
        if (prioSel) {
            prioSel.value = (typeof task.priority === 'string' ? task.priority : 'none').toLowerCase().trim();
            prioSel.dispatchEvent(new Event('change', { bubbles: true }));
        }

        // Populate dropdowns
        const projectSelect = document.getElementById('taskProject');
        projectSelect.innerHTML = '<option value="">Select project...</option>' +
            projects.map(p => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('');
        projectSelect.value = task.project_id || '';

        // Load project members and set assignee
        if (task.project_id) {
            loadProjectMembers(task.project_id);
            // Set assignee after a brief delay to ensure dropdown is populated
            setTimeout(() => {
                document.getElementById('taskAssignee').value = task.assigned_to_id || '';
            }, 0);
        }

        document.getElementById('taskModalTitle').textContent = 'Edit Task';
        document.getElementById('taskSubmitBtnText').textContent = 'Update Task';

        // Open modal without resetting form
        document.getElementById('taskModal').classList.add('active');
    } catch (error) {
        console.error('Error in editTask:', error);
        showError('Failed to open edit modal');
    }
}

// View task details
let currentTaskDetailsId = null;

function viewTaskDetails(id) {
    const task = tasks.find(t => t.id === id);
    if (!task) {
        return;
    }

    currentTaskDetailsId = id;

    const assignee = users.find(u => u.id === task.assigned_to_id);
    const project = projects.find(p => p.id === task.project_id);

    const dueDate = new Date(task.date);
    const formattedDate = dueDate.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });

    // Priority display with triangle marker
    const priority = (typeof task.priority === 'string' ? task.priority : 'none').toLowerCase().trim();
    const priorityColors = { high: '#ef4444', medium: '#f59e0b', low: '#10b981' };
    const pColor = priorityColors[priority];
    const priorityDisplay = pColor && priority !== 'none'
        ? `<span class="priority-triangle-inline" style="border-left-color: ${pColor}; margin-right: 6px;"></span>${priority.charAt(0).toUpperCase() + priority.slice(1)}`
        : `<span class="priority-triangle-inline" style="border-left-color: transparent; margin-right: 6px;"></span>${priority.charAt(0).toUpperCase() + priority.slice(1)}`;

    document.getElementById('detailsTaskName').textContent = task.name;
    document.getElementById('detailsTaskDescription').textContent = task.description || 'No description';
    const projColor = project ? (project.color || '#f06a6a') : '#cccccc';
    document.getElementById('detailsTaskProject').innerHTML = project
        ? `<span class="project-color-dot" style="background-color: ${projColor}; margin-right: 6px;"></span>${escapeHtml(project.name)}`
        : 'No project';
    document.getElementById('detailsTaskAssignee').textContent = assignee ? (assignee.username || assignee.name) : 'Unassigned';
    document.getElementById('detailsTaskDate').textContent = formattedDate;
    document.getElementById('detailsTaskPriority').innerHTML = priorityDisplay;

    const statusBadge = document.getElementById('detailsTaskStatus');
    statusBadge.textContent = task.status.replace('-', ' ');
    statusBadge.className = `task-status ${task.status}`;

    document.getElementById('taskDetailsModal').classList.add('active');
}

// Close task details modal
function closeTaskDetailsModal() {
    document.getElementById('taskDetailsModal').classList.remove('active');
    currentTaskDetailsId = null;
}

// Edit task from details modal
function editTaskFromDetails() {
    if (!currentTaskDetailsId) return;
    const taskId = currentTaskDetailsId; // Store ID before closing modal
    closeTaskDetailsModal();
    editTask(taskId);
}

// Delete task from details modal
async function deleteTaskFromDetails() {
    if (!currentTaskDetailsId) return;
    const taskId = currentTaskDetailsId; // Store ID before closing modal
    closeTaskDetailsModal();
    await deleteTask(taskId);
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

    const prioSelect = document.getElementById('taskPriority');
    const selectedPriority = prioSelect && prioSelect._customSelect
        ? prioSelect._customSelect.selectedValue
        : (prioSelect ? prioSelect.value : 'none');
    const normalizedPriority = (typeof selectedPriority === 'string' ? selectedPriority : 'none').toLowerCase().trim();

    // Convert UI date (DD/MM/YYYY) to ISO for API
    const isoDate = parseDMYToISO(document.getElementById('taskDate').value);
    if (!isoDate) {
        showError('Please enter a valid date in DD/MM/YYYY format');
        submitBtn.disabled = false;
        submitBtnText.textContent = originalText;
        return;
    }

    const taskData = {
        name: document.getElementById('taskName').value,
        description: document.getElementById('taskDescription').value,
        date: isoDate,
        project_id: document.getElementById('taskProject').value,
        assigned_to_id: document.getElementById('taskAssignee').value,
        priority: normalizedPriority
    };

    try {
        const url = taskId ? `${API_TASKS}/${taskId}` : API_TASKS;
        const method = taskId ? 'PUT' : 'POST';

        const response = await authFetch(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(taskData)
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to save task');
        }

        const result = await response.json();

        closeTaskModal();
        // Also ensure details modal is closed and return to All Tasks view
        closeTaskDetailsModal();
        await loadTasks();
        if (typeof switchView === 'function') {
            switchView('all');
        } else {
            updateUI();
        }

        // Ensure both modals are closed to return to the main list view
        closeTaskDetailsModal();

        // Success message (celebration only happens via checkbox)
        showSuccess(taskId ? 'Task updated successfully!' : 'Task created successfully!');
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
        const response = await authFetch(`${API_TASKS}/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
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

    const deleteBtn = document.querySelector('#deleteModal button.btn-danger');
    const cancelBtn = document.querySelector('#deleteModal button.btn-secondary');

    // Disable buttons
    deleteBtn.disabled = true;
    cancelBtn.disabled = true;
    deleteBtn.textContent = 'Deleting...';

    try {
        const response = await authFetch(`${API_TASKS}/${taskToDelete}`, {
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
    document.getElementById('projectColor').value = '#f06a6a';
    updateColorPresetSelection('#f06a6a');
    document.getElementById('projectModalTitle').textContent = 'Create New Project';
    document.getElementById('projectSubmitBtnText').textContent = 'Create Project';

    // No delete button in create/edit modal per new UI

    // Show create mode for members (checkbox list)
    document.getElementById('projectMembersCreateMode').style.display = 'block';
    document.getElementById('projectMembersEditMode').style.display = 'none';

    // Populate member checkboxes with all users except current user
    renderProjectMembersCheckboxes();

    document.getElementById('projectModal').classList.add('active');
}

// Render member checkboxes for project creation
function renderProjectMembersCheckboxes() {
    const container = document.getElementById('projectMembersCheckboxList');
    // Filter out current user since they'll be the owner
    const availableUsers = users.filter(u => u.id !== currentUser.id);

    if (availableUsers.length === 0) {
        container.innerHTML = '<p style="color: var(--text-secondary); font-size: 0.875rem; margin: 0;">No other users available</p>';
        return;
    }

    container.innerHTML = availableUsers.map(user => `
        <label style="display: flex; align-items: center; padding: 0.5rem; cursor: pointer; border-radius: 0.25rem; transition: background 0.15s;">
            <input type="checkbox" name="projectMember" value="${user.id}" style="margin-right: 0.75rem; cursor: pointer;">
            <span style="flex: 1;">${escapeHtml(user.name)}</span>
        </label>
    `).join('');
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
        description: document.getElementById('projectDescription').value,
        color: document.getElementById('projectColor').value
    };

    // If creating a new project, collect selected members from checkboxes
    if (!projectId) {
        const checkedBoxes = document.querySelectorAll('input[name="projectMember"]:checked');
        projectData.members = Array.from(checkedBoxes).map(cb => cb.value);
    }

    try {
        const url = projectId ? `${API_PROJECTS}/${projectId}` : API_PROJECTS;
        const method = projectId ? 'PUT' : 'POST';

        const response = await authFetch(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
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
    // Fallback to currently selected project if none passed
    if (!projectId) projectId = currentProjectId;
    if (!projectId) { showError('Please select a project first'); return; }
    currentProjectForSettings = projectId;
    let project = projects.find(p => p.id === projectId);
    if (!project) {
        // Fallback: reload projects then try again; if still missing, fetch directly
        // This guards against stale local state after create/update
        // and mismatches between dev/prod backends.
        console.warn('Project not found locally. Reloading projects...');
        // Note: loadProjects returns a promise; we sync via then to avoid making this function async broadly
        // eslint-disable-next-line no-undef
        return loadProjects().then(async () => {
            project = projects.find(p => p.id === projectId);
            if (!project) {
                const resp = await authFetch(`${API_PROJECTS}/${projectId}`);
                if (resp.ok) {
                    const fresh = await resp.json();
                    projects.push(fresh);
                    return openProjectSettings(projectId);
                }
                showError('Project not found');
                return;
            }
            return openProjectSettings(projectId);
        });
    }

    const owner = users.find(u => u.id === project.owner_id);
    const isOwner = project.owner_id === currentUser.id || !!currentUser.is_admin;

    document.getElementById('settingsProjectName').textContent = project.name;
    document.getElementById('settingsProjectOwner').textContent = owner ? (owner.username || owner.name) : 'Unknown';
    document.getElementById('settingsProjectDescription').textContent = project.description || 'No description provided';
    // Show project color in Project Information
    const colorRowId = 'settingsProjectColor';
    let colorRowEl = document.getElementById(colorRowId);
    if (!colorRowEl) {
        // If the row doesn't exist, create it under the existing info rows
        const infoContainer = document.querySelector('#projectSettingsModal .settings-section');
        if (infoContainer) {
            const row = document.createElement('div');
            row.className = 'info-row';
            const label = document.createElement('span');
            label.className = 'info-label';
            label.textContent = 'Color:';
            const value = document.createElement('span');
            value.className = 'info-value';
            value.id = colorRowId;
            row.appendChild(label);
            row.appendChild(value);
            infoContainer.appendChild(row);
            colorRowEl = value;
        }
    }
    if (colorRowEl) {
        const color = project.color || '#f06a6a';
        colorRowEl.innerHTML = `<span class="project-color-dot project-color-dot-lg" style="background-color:${color};" title="Project color"></span>`;
    }

    // Controls visibility based on ownership and personal flag
    const editBtn = document.getElementById('editProjectSettingsBtn');
    const membersSectionEl = document.getElementById('settingsTeamMembersSection');
    const dangerZoneEl = document.getElementById('settingsDangerZone');
    const addMemberSection = document.querySelector('#projectSettingsModal .add-member-section');

    if (editBtn) editBtn.style.display = isOwner && !project.is_personal ? '' : 'none';
    if (membersSectionEl) membersSectionEl.style.display = project.is_personal ? 'none' : '';
    if (dangerZoneEl) dangerZoneEl.style.display = isOwner && !project.is_personal ? '' : 'none';
    if (addMemberSection) addMemberSection.style.display = isOwner && !project.is_personal ? '' : 'none';

    // Render members (for non-personal)
    if (!project.is_personal) {
        renderMembersList(project);
    } else {
        const membersList = document.getElementById('membersList');
        if (membersList) membersList.innerHTML = '';
    }

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
    const isOwner = project.owner_id === currentUser.id || !!currentUser.is_admin;

    if (members.length === 0) {
        membersList.innerHTML = '<p style="color: var(--text-secondary); font-size: 0.875rem;">No members yet. Add team members below.</p>';
        return;
    }

    // Sort members so current user is first
    const sortedMembers = [...members].sort((a, b) => {
        if (a.id === currentUser.id) return -1;
        if (b.id === currentUser.id) return 1;
        return 0;
    });

    membersList.innerHTML = sortedMembers.map(member => {
        const isCurrentUser = member.id === currentUser.id;
        const showLeaveButton = isCurrentUser && !isOwner;
        const showRemoveButton = isOwner && !isCurrentUser;

        return `
            <div class=\"member-item\">
                <div class=\"member-info\">
                    <div class=\"member-avatar\"></div>
                    <div class=\"member-details\">
                        <div class=\"member-name\">${escapeHtml(member.name)}</div>
                        <div class=\"member-role\">Member</div>
                    </div>
                </div>
                <div class=\"member-actions\">
                    ${showLeaveButton ? `<button class="btn btn-danger" onclick=\"leaveProject()\">Leave</button>` : ''}
                    ${showRemoveButton ? `<button onclick=\"removeMember('${member.id}')\">Remove</button>` : ''}
                </div>
            </div>
        `;
    }).join('');
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
        const response = await authFetch(`${API_PROJECTS}/${currentProjectForSettings}/members`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
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
        const response = await authFetch(`${API_PROJECTS}/${currentProjectForSettings}/members/${userId}`, {
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

// Leave project (for non-owners)
async function leaveProject() {
    if (!currentProjectForSettings || !currentUser) return;

    if (!confirm('Are you sure you want to leave this project? You will lose access to all its tasks.')) {
        return;
    }

    const leaveBtn = event.target;
    const originalText = leaveBtn.textContent;

    // Disable button
    leaveBtn.disabled = true;
    leaveBtn.textContent = 'Leaving...';

    try {
        const response = await authFetch(`${API_PROJECTS}/${currentProjectForSettings}/members/${currentUser.id}`, {
            method: 'DELETE',
            credentials: 'include'
        });

        if (!response.ok) throw new Error('Failed to leave project');

        await loadProjects();

        // Close modal and reset view
        closeProjectSettingsModal();

        // Switch to first available project or clear view
        if (projects.length > 0) {
            currentProjectId = projects[0].id;
            loadTasks();
        } else {
            currentProjectId = null;
            renderTasks();
        }

        showSuccess('Left project successfully');
    } catch (error) {
        showError('Failed to leave project');
        // Re-enable button on error
        leaveBtn.disabled = false;
        leaveBtn.textContent = originalText;
    }
}

// Close project settings modal
function closeProjectSettingsModal() {
    document.getElementById('projectSettingsModal').classList.remove('active');
    currentProjectForSettings = null;
}

// Edit project from settings modal
function editProjectFromSettings() {
    if (!currentProjectForSettings) return;
    const projectId = currentProjectForSettings;
    closeProjectSettingsModal();
    editProject(projectId);
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
        const response = await authFetch(`${API_PROJECTS}/${currentProjectForSettings}`, {
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

// Legacy Project Details UI removed. All project management now uses Project Settings modal.

function openProjectDeleteModal(projectId) {
    projectToDelete = projectId;
    const proj = projects.find(p => p.id === projectId);
    const nameEl = document.getElementById('projectDeleteName');
    if (nameEl) nameEl.textContent = proj ? (proj.name || '') : '';
    const modal = document.getElementById('projectDeleteModal');
    if (modal) modal.classList.add('active');
}

function closeProjectDeleteModal() {
    const modal = document.getElementById('projectDeleteModal');
    if (modal) modal.classList.remove('active');
    projectToDelete = null;
}

async function confirmDeleteProject() {
    if (!projectToDelete) return;
    const id = projectToDelete;
    const modal = document.getElementById('projectDeleteModal');
    const deleteBtn = modal ? modal.querySelector('button.btn-danger') : null;
    const cancelBtn = modal ? modal.querySelector('button.btn-secondary') : null;
    if (deleteBtn) deleteBtn.disabled = true;
    if (cancelBtn) cancelBtn.disabled = true;
    if (deleteBtn) deleteBtn.textContent = 'Deleting...';
    try {
        const resp = await authFetch(`${API_PROJECTS}/${id}`, { method: 'DELETE' });
        if (!resp.ok) throw new Error('Failed');
        closeProjectDeleteModal();
        // Also close settings/details modals if open
        try { closeProjectSettingsModal(); } catch(_) {}
        if (typeof closeProjectDetailsModal === 'function') {
            try { closeProjectDetailsModal(); } catch(_) {}
        }
        // Refresh data and go back to All Tasks if needed
        await Promise.all([loadProjects(), loadTasks()]);
        if (currentProjectId === id) {
            switchView('all');
        } else {
            updateUI();
        }
        showSuccess('Project deleted successfully');
    } catch (err) {
        showError('Failed to delete project');
        if (deleteBtn) deleteBtn.disabled = false;
        if (cancelBtn) cancelBtn.disabled = false;
        if (deleteBtn) deleteBtn.textContent = 'Delete';
    }
}

// Edit project
function editProject(projectId) {
    // Fallback to currently selected project if none passed
    if (!projectId) projectId = currentProjectId;
    if (!projectId) { showError('Please select a project first'); return; }
    let project = projects.find(p => p.id === projectId);
    if (!project) {
        console.warn('Project not found locally. Reloading projects...');
        return loadProjects().then(async () => {
            project = projects.find(p => p.id === projectId);
            if (!project) {
                const resp = await authFetch(`${API_PROJECTS}/${projectId}`);
                if (resp.ok) {
                    const fresh = await resp.json();
                    projects.push(fresh);
                    return editProject(projectId);
                }
                showError('Project not found');
                return;
            }
            return editProject(projectId);
        });
    }

    if (project.is_personal) {
        showError('Personal projects cannot be edited');
        return;
    }

    // Check if current user is the owner
    if (project.owner_id !== currentUser.id && !currentUser.is_admin) {
        // Non-owners should see read-only view
        viewProjectInfo(projectId);
        return;
    }

    document.getElementById('projectId').value = project.id;
    document.getElementById('projectName').value = project.name || '';
    document.getElementById('projectDescription').value = project.description || '';
    const colorVal = project.color || '#f06a6a';
    document.getElementById('projectColor').value = colorVal;
    updateColorPresetSelection(colorVal);
    document.getElementById('projectModalTitle').textContent = 'Edit Project';
    document.getElementById('projectSubmitBtnText').textContent = 'Update Project';

    // No delete button in edit modal per new UI
    // Member management removed from edit modal - now only in project settings

    document.getElementById('projectModal').classList.add('active');
}

// Legacy Project Details UI removed (use Project Settings)

// closeProjectDetailsModal deprecated

// editProjectFromDetails deprecated

// deleteProjectFromDetails deprecated

// Legacy leaveProjectFromDetails removed with Project Details UI.
// Old leaveProject(projectId) function removed - now using the one in Project Settings section

// These functions are deprecated - member management moved to project settings modal only
// Keeping commented for reference
/*
// Render project members list in edit modal
function renderProjectMembersList(project) {
    const membersList = document.getElementById('projectMembersList');
    const memberIds = project.members || [];
    const members = users.filter(u => memberIds.includes(u.id));

    if (members.length === 0) {
        membersList.innerHTML = '<p style="color: var(--text-secondary); font-size: 0.875rem; margin: 0.5rem 0;">No members yet</p>';
        return;
    }

    membersList.innerHTML = members.map(member => `
        <div class="member-item-inline">
            <span>${escapeHtml(member.name)}</span>
            <button type="button" class="remove-member-btn" onclick="removeProjectMember('${member.id}')" title="Remove member">×</button>
        </div>
    `).join('');
}

// Add project member (when editing)
async function addProjectMember() {
    const userId = document.getElementById('projectNewMemberSelect').value;
    const projectId = document.getElementById('projectId').value;

    if (!userId || !projectId) return;

    const select = document.getElementById('projectNewMemberSelect');
    const addBtn = event.target;

    // Disable controls
    select.disabled = true;
    addBtn.disabled = true;
    addBtn.textContent = 'Adding...';

    try {
        const response = await authFetch(`${API_PROJECTS}/${projectId}/members`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_id: userId })
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to add member');
        }

        await loadProjects();
        const project = projects.find(p => p.id === projectId);
        renderProjectMembersList(project);

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

// Remove project member (when editing)
async function removeProjectMember(userId) {
    const projectId = document.getElementById('projectId').value;
    if (!projectId) return;

    const removeBtn = event.target;
    const originalText = removeBtn.textContent;

    // Disable button
    removeBtn.disabled = true;
    removeBtn.textContent = 'Removing...';

    try {
        const response = await authFetch(`${API_PROJECTS}/${projectId}/members/${userId}`, {
            method: 'DELETE'
        });

        if (!response.ok) throw new Error('Failed to remove member');

        await loadProjects();
        const project = projects.find(p => p.id === projectId);
        renderProjectMembersList(project);

        // Update dropdown
        const memberIds = [project.owner_id, ...(project.members || [])];
        const availableUsers = users.filter(u => !memberIds.includes(u.id));
        const select = document.getElementById('projectNewMemberSelect');
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
*/

// Delete project from edit modal removed per new UI

// CELEBRATION ANIMATION
function celebrate() {
    function randomInRange(min, max) {
        return Math.random() * (max - min) + min;
    }

    // Create one burst of confetti
    for (let i = 0; i < 30; i++) {
        createConfetti(randomInRange(0.1, 0.9), randomInRange(0.1, 0.3));
    }
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
        animation: confetti-fall 0.5s linear forwards;
        z-index: 10000;
        border-radius: ${Math.random() > 0.5 ? '50%' : '0'};
    `;

    document.body.appendChild(confetti);
    setTimeout(() => confetti.remove(), 500);
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
        background-color: rgba(19, 206, 102, 0.8);
        color: white;
        padding: 1rem 1.5rem;
        border-radius: 0.5rem;
        box-shadow: var(--shadow-lg);
        z-index: 10000;
        animation: slideInRight 0.3s;
        backdrop-filter: blur(10px);
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
        background-color: rgba(255, 73, 73, 0.8);
        color: white;
        padding: 1rem 1.5rem;
        border-radius: 0.5rem;
        box-shadow: var(--shadow-lg);
        z-index: 10000;
        animation: slideInRight 0.3s;
        backdrop-filter: blur(10px);
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

// CUSTOM SELECT DROPDOWN
class CustomSelect {
    constructor(selectElement) {
        this.selectElement = selectElement;
        this.selectedValue = selectElement.value;
        this.isOpen = false;
        this.create();
        this.addEventListeners();
        // mark and expose instance for potential refreshes
        this.selectElement.dataset.customized = 'true';
        this.selectElement._customSelect = this;
        this.scroller = null;
        this._onResize = null;
        this._onScroll = null;
    }

    create() {
        // Create custom select container
        this.container = document.createElement('div');
        this.container.className = 'custom-select';

        // Create trigger button
        this.trigger = document.createElement('button');
        this.trigger.type = 'button';
        this.trigger.className = 'custom-select-trigger';

        // Create selected content (dot + text for priority select)
        this.selectedContainer = document.createElement('span');
        this.selectedContainer.className = 'selected-container';
        this.selectedContainer.style.display = 'inline-flex';
        this.selectedContainer.style.alignItems = 'center';
        this.selectedContainer.style.gap = '0.5rem';

        this.selectedDot = document.createElement('span');
        this.selectedDot.className = 'priority-triangle-inline';
        this.selectedDot.style.display = 'none';

        // Create selected text span
        this.selectedText = document.createElement('span');
        this.updateSelectedText();

        this.selectedContainer.appendChild(this.selectedDot);
        this.selectedContainer.appendChild(this.selectedText);
        this.trigger.appendChild(this.selectedContainer);

        // Create arrow
        const arrow = document.createElement('span');
        arrow.className = 'arrow';
        this.trigger.appendChild(arrow);

        // Create dropdown
        this.dropdown = document.createElement('div');
        this.dropdown.className = 'custom-select-dropdown';

        // Create options
        this.createOptions();

        // Assemble
        this.container.appendChild(this.trigger);
        this.container.appendChild(this.dropdown);

        // Replace original select
        this.selectElement.style.display = 'none';
        this.selectElement.parentNode.insertBefore(this.container, this.selectElement);
    }

    createOptions() {
        this.dropdown.innerHTML = '';
        const options = Array.from(this.selectElement.options);

        options.forEach(option => {
            const optionBtn = document.createElement('button');
            optionBtn.type = 'button';
            optionBtn.className = 'custom-select-option';

            // If this is the priority select, add colored dot
            if (this.selectElement.id === 'taskPriority') {
                const tri = document.createElement('span');
                tri.className = 'priority-triangle-inline';
                const color = this.getPriorityColor(option.value);
                if (color) tri.style.borderLeftColor = color;
                optionBtn.appendChild(tri);
                const label = document.createElement('span');
                label.textContent = option.textContent;
                optionBtn.appendChild(label);
            } else {
                optionBtn.textContent = option.textContent;
            }
            optionBtn.dataset.value = option.value;

            if (option.value === this.selectedValue) {
                optionBtn.classList.add('selected');
            }

            optionBtn.addEventListener('click', () => this.selectOption(option.value));
            this.dropdown.appendChild(optionBtn);
        });
    }

    updateSelectedText() {
        const selectedOption = this.selectElement.options[this.selectElement.selectedIndex];
        if (selectedOption && selectedOption.value) {
            this.selectedText.textContent = selectedOption.textContent;
            this.selectedText.classList.remove('placeholder');
            // If this is the priority select, show color dot
            if (this.selectElement.id === 'taskPriority') {
                const value = selectedOption.value;
                const color = this.getPriorityColor(value);
                if (color && value !== 'none') {
                    this.selectedDot.style.display = 'inline-block';
                    this.selectedDot.style.borderLeftColor = color;
                } else {
                    this.selectedDot.style.display = 'none';
                }
            } else {
                this.selectedDot.style.display = 'none';
            }
        } else {
            this.selectedText.textContent = this.selectElement.options[0]?.textContent || 'Select...';
            this.selectedText.classList.add('placeholder');
            this.selectedDot.style.display = 'none';
        }
    }

    selectOption(value) {
        this.selectedValue = value;
        this.selectElement.value = value;

        // Trigger change event on original select
        const event = new Event('change', { bubbles: true });
        this.selectElement.dispatchEvent(event);

        // Update UI
        this.updateSelectedText();
        this.dropdown.querySelectorAll('.custom-select-option').forEach(opt => {
            opt.classList.toggle('selected', opt.dataset.value === value);
        });

        this.close();
    }

    toggle() {
        this.isOpen ? this.close() : this.open();
    }

    open() {
        this.isOpen = true;
        this.container.classList.add('open');
        // position dropdown based on available space in nearest scroll container
        this.scroller = this.getScrollContainer();
        this.positionDropdown();
        // Reposition on resize/scroll
        this._onResize = () => this.positionDropdown();
        window.addEventListener('resize', this._onResize);
        if (this.scroller) {
            this._onScroll = () => this.positionDropdown();
            this.scroller.addEventListener('scroll', this._onScroll, { passive: true });
        }
    }

    close() {
        this.isOpen = false;
        this.container.classList.remove('open');
        this.container.classList.remove('open-up');
        if (this._onResize) {
            window.removeEventListener('resize', this._onResize);
            this._onResize = null;
        }
        if (this.scroller && this._onScroll) {
            this.scroller.removeEventListener('scroll', this._onScroll);
            this._onScroll = null;
        }
    }

    refresh() {
        this.createOptions();
        this.updateSelectedText();
    }

    addEventListeners() {
        this.trigger.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.toggle();
        });

        // Close when clicking outside
        document.addEventListener('click', (e) => {
            if (!this.container.contains(e.target)) {
                this.close();
            }
        });

        // Keep UI in sync when the original select's value changes programmatically
        this.selectElement.addEventListener('change', () => {
            this.selectedValue = this.selectElement.value;
            this.updateSelectedText();
            // update option highlight state
            if (this.dropdown) {
                this.dropdown.querySelectorAll('.custom-select-option').forEach(opt => {
                    opt.classList.toggle('selected', opt.dataset.value === this.selectedValue);
                });
            }
        });

        // Observe changes to the original select options
        const observer = new MutationObserver(() => {
            this.refresh();
        });
        observer.observe(this.selectElement, { childList: true, subtree: true });
    }

    // Find nearest scrollable ancestor to compute available space
    getScrollContainer() {
        let el = this.container.parentElement;
        while (el && el !== document.body) {
            const style = window.getComputedStyle(el);
            const overflowY = style.overflowY;
            if (overflowY === 'auto' || overflowY === 'scroll') {
                return el;
            }
            el = el.parentElement;
        }
        return window; // fallback to viewport
    }

    // Position dropdown above or below based on available space
    positionDropdown() {
        const gap = 8;
        const desiredMax = 250;
        const triggerRect = this.trigger.getBoundingClientRect();
        const containerRect = this.container.getBoundingClientRect();
        let spaceAbove, spaceBelow;

        if (this.scroller === window) {
            const viewportTop = 0;
            const viewportBottom = window.innerHeight;
            spaceAbove = triggerRect.top - viewportTop - gap;
            spaceBelow = viewportBottom - triggerRect.bottom - gap;
        } else {
            const scrollRect = this.scroller.getBoundingClientRect();
            spaceAbove = triggerRect.top - scrollRect.top - gap;
            spaceBelow = scrollRect.bottom - triggerRect.bottom - gap;
        }

        const openUp = spaceBelow < Math.min(180, desiredMax) && spaceAbove > spaceBelow;
        this.container.classList.toggle('open-up', openUp);

        const maxForDirection = Math.max(120, Math.min(desiredMax, openUp ? spaceAbove : spaceBelow));
        this.dropdown.style.maxHeight = `${maxForDirection}px`;

        // Expand dropdown width for very narrow triggers (mobile readability)
        const inMobileContext = !!(this.container.closest('.mobile-topbar') || this.container.closest('.mobile-footer'));
        const triggerIsNarrow = triggerRect.width < 160;
        if (inMobileContext && triggerIsNarrow) {
            const viewportW = window.innerWidth;
            const margin = 12; // viewport margin
            const minW = 220;  // minimum readable width
            const maxW = Math.max(minW, Math.min(360, viewportW - margin * 2));
            const desiredW = Math.min(maxW, Math.max(minW, triggerRect.width));
            // Center dropdown relative to trigger, clamped to viewport
            let leftDesired = triggerRect.left + (triggerRect.width / 2) - (desiredW / 2);
            leftDesired = Math.max(margin, Math.min(leftDesired, viewportW - margin - desiredW));
            // Convert to container-local offset
            const leftOffset = leftDesired - containerRect.left;
            // Apply explicit width and left; clear right to allow expansion
            this.dropdown.style.width = `${desiredW}px`;
            this.dropdown.style.left = `${leftOffset}px`;
            this.dropdown.style.right = 'auto';
        } else {
            // Reset to default: stretch to container width
            this.dropdown.style.width = '';
            this.dropdown.style.left = '';
            this.dropdown.style.right = '';
        }
    }
}

// Helper for priority colors used by CustomSelect
CustomSelect.prototype.getPriorityColor = function(value) {
    const map = { high: '#ef4444', medium: '#f59e0b', low: '#3b82f6' };
    const key = (typeof value === 'string' ? value : '').toLowerCase().trim();
    return map[key] || '';
};

// Initialize custom selects
function initCustomSelects() {
    const selects = document.querySelectorAll('.form-select');
    selects.forEach(select => {
        if (!select.dataset.customized) {
            new CustomSelect(select);
        } else if (select._customSelect) {
            // refresh to reflect any programmatic value changes
            select._customSelect.refresh();
        }
    });
}

// Call after DOM is ready and whenever modals open
document.addEventListener('DOMContentLoaded', () => {
    setTimeout(initCustomSelects, 100);
});

const originalOpenTaskModal = openTaskModal;
window.openTaskModal = function() {
    originalOpenTaskModal();
    setTimeout(initCustomSelects, 50);
};

// Expose all close functions on window for inline onclick handlers
window.closeTaskModal = closeTaskModal;
window.closeTaskDetailsModal = closeTaskDetailsModal;
window.closeUserSettings = closeUserSettings;
window.closeProjectModal = closeProjectModal;
window.closeProjectSettingsModal = closeProjectSettingsModal;
window.closeDeleteModal = closeDeleteModal;

// Expose open functions
window.openUserSettings = openUserSettings;

// Expose other inline handler functions
window.switchView = switchView;
window.editTaskFromDetails = editTaskFromDetails;
window.deleteTaskFromDetails = deleteTaskFromDetails;
// window.addProjectMember - removed (deprecated function)
// window.deleteProjectFromEdit - removed (deprecated function)

const originalOpenProjectModal = openProjectModal;
window.openProjectModal = function() {
    originalOpenProjectModal();
    setTimeout(initCustomSelects, 50);
};

const originalOpenProjectSettings = openProjectSettings;
window.openProjectSettings = function(projectId) {
    originalOpenProjectSettings(projectId);
    setTimeout(initCustomSelects, 50);
};

const originalEditTask = editTask;
window.editTask = function(id) {
    originalEditTask(id);
    setTimeout(initCustomSelects, 50);
};

const originalEditProject = editProject;
window.editProject = function(projectId) {
    originalEditProject(projectId);
    setTimeout(initCustomSelects, 50);
};

// Expose project delete modal helpers
window.openProjectDeleteModal = openProjectDeleteModal;
window.closeProjectDeleteModal = closeProjectDeleteModal;
window.confirmDeleteProject = confirmDeleteProject;
