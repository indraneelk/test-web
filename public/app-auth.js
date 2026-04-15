// Task Manager Frontend — Supabase direct (no Express API)

const GENERAL_PROJECT_ID = 'a0000000-0000-0000-0000-000000000001';

// Configuration

// Loading Spinner Control
function updateLoadingText(text) {
    const subtextEl = document.getElementById('loadingSubtext');
    if (subtextEl) subtextEl.textContent = text;
}

function hideLoadingSpinner() {
    const overlay = document.getElementById('loadingOverlay');
    if (overlay) {
        overlay.classList.add('hidden');
        setTimeout(() => {
            if (overlay.parentNode) {
                overlay.parentNode.removeChild(overlay);
            }
        }, 300);
    }
}

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
    sort: ''
};

function saveFilters() {
    const { showArchived: _, ...persistable } = currentFilters;
    localStorage.setItem('tm_filters', JSON.stringify(persistable));
}

function loadSavedFilters() {
    try {
        const saved = localStorage.getItem('tm_filters');
        if (saved) Object.assign(currentFilters, JSON.parse(saved));
    } catch (_) {}
}

function syncFilterUI() {
    const pf = document.getElementById('priorityFilter');
    if (pf) pf.value = currentFilters.priority || '';
    const ss = document.getElementById('sortSelect');
    if (ss) ss.value = currentFilters.sort || '';
    const si = document.getElementById('searchInput');
    if (si) si.value = currentFilters.search || '';
    updateFilterBadge();
}

function updateFilterBadge() {
    const badge = document.getElementById('activeFilterBadge');
    if (!badge) return;
    const isActive = !!(
        currentFilters.priority ||
        currentFilters.sort ||
        currentFilters.search
    );
    badge.style.display = isActive ? 'inline-flex' : 'none';
}

function clearAllFilters() {
    currentFilters.priority = '';
    currentFilters.sort = '';
    currentFilters.search = '';
    saveFilters();
    syncFilterUI();
    updateFilterBadge();
    renderTasks(filterTasks());
}
window.clearAllFilters = clearAllFilters;
let taskToDelete = null;
let currentProjectForSettings = null;
let currentProjectDetailsId = null;
let projectToDelete = null;

// Confirmation modal functions
function showConfirmModal(title, message, onConfirm) {
    document.getElementById('confirmModalTitle').textContent = title;
    document.getElementById('confirmModalMessage').textContent = message;
    const okBtn = document.getElementById('confirmModalOkBtn');
    const fresh = okBtn.cloneNode(true);
    okBtn.parentNode.replaceChild(fresh, okBtn);
    fresh.addEventListener('click', () => {
        closeConfirmModal();
        onConfirm();
    });
    document.getElementById('confirmModal').style.display = 'flex';
}

function closeConfirmModal() {
    document.getElementById('confirmModal').style.display = 'none';
}

// Safe date formatter — returns null if invalid, avoids "Invalid Date" strings
function formatDateSafe(iso, opts) {
    if (!iso) return null;
    const d = new Date(iso);
    if (isNaN(d.getTime())) return null;
    return d.toLocaleDateString('en-US', opts);
}

// Supabase client helper
function ensureSupabase() {
    return window.getSupabaseClient ? window.getSupabaseClient() : null;
}

let _pollingInterval = null;
let _visibilityHandler = null;

function stopPolling() {
    if (_pollingInterval !== null) {
        clearInterval(_pollingInterval);
        _pollingInterval = null;
    }
    if (_visibilityHandler !== null) {
        document.removeEventListener('visibilitychange', _visibilityHandler);
        _visibilityHandler = null;
    }
}

function startPolling() {
    stopPolling();
    _visibilityHandler = async () => {
        if (!document.hidden) await loadData();
    };
    document.addEventListener('visibilitychange', _visibilityHandler);
    _pollingInterval = setInterval(async () => {
        await loadData();
    }, 60000);
}

// Initialize app
document.addEventListener('DOMContentLoaded', async () => {
    const isAuthenticated = await checkAuth();
    if (!isAuthenticated) {
        return;
    }

    updateLoadingText('Loading projects and tasks...');

    loadSavedFilters();
    setupEventListeners();
    syncFilterUI();

    hideLoadingSpinner();

    initMobileUI();

    // Supabase Realtime subscription
    try {
        const client = ensureSupabase();
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

    startPolling();
});

// Check authentication via Supabase session
async function checkAuth() {
    try {
        const client = ensureSupabase();
        if (!client) {
            window.location.href = '/login.html';
            return false;
        }

        const { data: { session } } = await client.auth.getSession();
        if (!session) {
            window.location.href = '/login.html';
            return false;
        }

        const profilePromise = client
            .from('profiles')
            .select('*')
            .eq('id', session.user.id)
            .single();

        const dataPromise = loadData();

        const [{ data: profile, error }] = await Promise.all([profilePromise, dataPromise]);

        if (error || !profile) {
            console.error('Failed to load profile:', error);
            window.location.href = '/login.html';
            return false;
        }

        currentUser = profile;
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
        avatar.textContent = getInitials(currentUser);
        if (currentUser.color) {
            avatar.style.backgroundColor = currentUser.color;
        }
    }
    const mobileAvatar = document.getElementById('mobileUserAvatar');
    if (mobileAvatar) {
        mobileAvatar.textContent = getInitials(currentUser);
        if (currentUser.color) {
            mobileAvatar.style.backgroundColor = currentUser.color;
        }
    }

    const adminLink = document.getElementById('adminLink');
    if (adminLink && currentUser.is_admin) {
        adminLink.style.display = 'flex';
    }
}

// Logout
async function logout() {
    stopPolling();
    try {
        const client = ensureSupabase();
        if (client) {
            await client.auth.signOut();
        }
    } catch (error) {
        console.error('Logout error:', error);
    } finally {
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
        document.getElementById('profileName').addEventListener('input', function() {
            const parts = this.value.trim().split(/\s+/);
            const initials = parts.length === 1
                ? parts[0].substring(0, 2)
                : (parts[0][0] + parts[parts.length - 1][0]);
            document.getElementById('profileInitials').value = initials.toUpperCase();
        });
    }

    const desktopAvatar = document.getElementById('userAvatar');
    if (desktopAvatar) {
        desktopAvatar.addEventListener('click', () => {
            window.location.href = '/profile-update.html';
        });
    }

    const taskProjectSelect = document.getElementById('taskProject');
    if (taskProjectSelect) {
        taskProjectSelect.addEventListener('change', (e) => {
            const assigneeSelect = document.getElementById('taskAssignee');
            if (e.target.value) {
                loadProjectMembers(e.target.value);
            } else {
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
            saveFilters();
            updateFilterBadge();
            renderTasks(filterTasks());
        });
    }

    const sortSelectEl = document.getElementById('sortSelect');
    if (sortSelectEl) {
        sortSelectEl.addEventListener('change', (e) => {
            currentFilters.sort = e.target.value;
            saveFilters();
            updateFilterBadge();
            renderTasks(filterTasks());
        });
    }

    document.getElementById('searchInput').addEventListener('input', (e) => {
        currentFilters.search = e.target.value.toLowerCase();
        saveFilters();
        updateFilterBadge();
        renderTasks(filterTasks());
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeTaskDetailsModal();
            closeTaskModal();
            closeProjectModal();
            closeProjectSettingsModal();
            closeDeleteModal();
        }
    });

    document.querySelectorAll('.color-preset').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const color = e.currentTarget.getAttribute('data-color');
            document.getElementById('projectColor').value = color;
            updateColorPresetSelection(color);
        });
    });

    ['taskName', 'taskDate'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('input', () => el.classList.remove('input-error'));
    });
}

// MOBILE UI FUNCTIONS
function initMobileUI() {
    const mobileProjectSelect = document.getElementById('mobileProjectSelect');
    if (mobileProjectSelect) {
        renderMobileProjectOptions();
        mobileProjectSelect.addEventListener('change', (e) => {
            const value = e.target.value;
            if (value === 'add-project') {
                openProjectModal();
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

    const mobileUserAvatar = document.getElementById('mobileUserAvatar');
    if (mobileUserAvatar) {
        mobileUserAvatar.addEventListener('click', () => {
            window.location.href = '/profile-update.html';
        });
    }

    const mobileCreateTaskBtn = document.getElementById('mobileCreateTaskBtn');
    if (mobileCreateTaskBtn) {
        mobileCreateTaskBtn.addEventListener('click', openTaskModal);
    }

    const mobileSortSelect = document.getElementById('mobileSortSelect');
    if (mobileSortSelect) {
        mobileSortSelect.value = currentFilters.sort || '';
        mobileSortSelect.addEventListener('change', (e) => {
            currentFilters.sort = e.target.value;
            saveFilters();
            updateFilterBadge();
            renderTasks(filterTasks());
        });
    }

    const mobilePriorityFilter = document.getElementById('mobilePriorityFilter');
    if (mobilePriorityFilter) {
        mobilePriorityFilter.value = currentFilters.priority || '';
        mobilePriorityFilter.addEventListener('change', (e) => {
            currentFilters.priority = e.target.value;
            saveFilters();
            updateFilterBadge();
            renderTasks(filterTasks());
        });
    }



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
        '<option value="">All Tasks</option>',
        ...projects.map(p => '<option value="' + p.id + '"' + (currentProjectId === p.id ? ' selected' : '') + '>' + escapeHtml(p.name) + '</option>'),
        '<option value="add-project">+ Add Project</option>'
    ];

    select.innerHTML = options.join('');

    if (!currentProjectId) {
        select.value = '';
    }

    if (select._customSelect) {
        select._customSelect.refresh();
    } else if (typeof initCustomSelects === 'function') {
        setTimeout(initCustomSelects, 0);
    }
}

// USER SETTINGS
async function openUserSettings() {
    if (!currentUser) {
        checkAuth().then(() => {
            if (currentUser) {
                openUserSettings();
            } else {
                alert('Unable to load user data. Please refresh the page.');
            }
        });
        return;
    }
    document.getElementById('userId').value = currentUser.id || '';
    document.getElementById('profileName').value = currentUser.name || '';
    document.getElementById('profileInitials').value = currentUser.initials || '';

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
        name: document.getElementById('profileName').value.trim(),
        initials: document.getElementById('profileInitials').value.trim().toUpperCase()
    };

    try {
        const client = ensureSupabase();
        if (!client) throw new Error('Not connected');

        const { data: updatedProfile, error: profileError } = await client
            .from('profiles')
            .update(payload)
            .eq('id', currentUser.id)
            .select()
            .single();

        if (profileError) throw new Error(profileError.message);

        currentUser = { ...currentUser, ...updatedProfile };
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

// Highlight selected color preset
function updateColorPresetSelection(selectedColor) {
    document.querySelectorAll('.color-preset').forEach(btn => {
        const c = btn.getAttribute('data-color');
        btn.classList.toggle('selected', c && selectedColor && c.toLowerCase() === selectedColor.toLowerCase());
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

// Load users (profiles)
async function loadUsers() {
    try {
        const client = ensureSupabase();
        if (!client) return;
        const { data, error } = await client
            .from('profiles')
            .select('id, name, email, username, color, avatar_url');
        if (error) {
            console.error('Failed to load users:', error);
            showError('Failed to load users: ' + (error.message || error));
            return;
        }
        users = data || [];
    } catch (error) {
        console.error('Failed to load users:', error);
        showError('Failed to load users: ' + (error.message || error));
    }
}

// Load projects (with members via join)
async function loadProjects() {
    try {
        const client = ensureSupabase();
        if (!client) return;
        const { data, error } = await client
            .from('projects')
            .select('*, project_members(user_id, role, profiles(id, name, username, color, avatar_url))');
        if (error) {
            console.error('Failed to load projects:', error);
            showError('Failed to load projects: ' + (error.message || error));
            return;
        }
        projects = data || [];
        renderProjectsNav();
        renderMobileProjectOptions();
    } catch (error) {
        console.error('Failed to load projects:', error);
        showError('Failed to load projects: ' + (error.message || error));
    }
}

// Load tasks
async function loadTasks() {
    try {
        const client = ensureSupabase();
        if (!client) return;
        const { data, error } = await client
            .from('tasks')
            .select('*')
            .order('created_at', { ascending: false });
        if (error) {
            console.error('Failed to load tasks:', error);
            showError('Failed to load tasks: ' + (error.message || error));
            return;
        }
        tasks = data || [];
    } catch (error) {
        console.error('Failed to load tasks:', error);
        showError('Failed to load tasks: ' + (error.message || error));
    }
}

// Helper: get member user_ids from a project (from project_members join)
function getProjectMemberIds(project) {
    if (!project) return [];
    const memberIds = [];
    if (project.owner_id) memberIds.push(project.owner_id);
    if (Array.isArray(project.project_members)) {
        project.project_members.forEach(pm => {
            if (pm.user_id && !memberIds.includes(pm.user_id)) {
                memberIds.push(pm.user_id);
            }
        });
    }
    return memberIds;
}

// Get project display color from the projects table
function getProjectColor(project) {
    if (!project) return '#f06a6a';
    return project.color || '#f06a6a';
}

// Switch view
function switchView(view) {
    currentView = view;
    currentProjectId = null;

    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.remove('active');
        if (item.dataset.view === view) {
            item.classList.add('active');
        }
    });

    document.querySelectorAll('.project-nav-item').forEach(item => {
        item.classList.remove('active');
    });

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

    document.querySelectorAll('.nav-item').forEach(item => item.classList.remove('active'));
    document.querySelectorAll('.project-nav-item').forEach(item => {
        item.classList.remove('active');
        if (item.dataset.projectId === projectId) {
            item.classList.add('active');
        }
    });

    document.getElementById('tasksView').style.display = 'block';
    document.getElementById('projectsView').style.display = 'none';
    document.getElementById('addTaskBtn').style.display = 'flex';
    const titleEl = document.getElementById('pageTitle');
    const projectColor = getProjectColor(project);
    // Build title using safe DOM manipulation
    titleEl.textContent = '';
    const dot = document.createElement('span');
    dot.className = 'project-color-dot';
    dot.style.cssText = 'width:10px;height:10px;background-color:' + projectColor + ';display:inline-block;vertical-align:middle;';
    const nameText = document.createTextNode(' ' + project.name + ' ');
    const gearBtn = document.createElement('button');
    gearBtn.className = 'icon-btn title-gear';
    gearBtn.type = 'button';
    gearBtn.setAttribute('onclick', "openProjectSettings('" + project.id + "')");
    gearBtn.title = 'Project settings';
    gearBtn.textContent = '\u2699\uFE0F';
    titleEl.appendChild(dot);
    titleEl.appendChild(nameText);
    titleEl.appendChild(gearBtn);

    renderTasks(filterTasks());
    updateStats();
    renderMobileProjectOptions();
}

// Render projects navigation
function renderProjectsNav() {
    const nav = document.getElementById('projectsNav');
    if (projects.length === 0) {
        nav.textContent = '';
        const p = document.createElement('p');
        p.style.cssText = 'padding: 0.5rem 0.75rem; color: var(--text-secondary); font-size: 0.875rem;';
        p.textContent = 'No projects yet';
        nav.appendChild(p);
        return;
    }

    nav.textContent = '';
    projects.forEach(project => {
        const projectColor = getProjectColor(project);
        const btn = document.createElement('button');
        btn.className = 'project-nav-item';
        btn.dataset.projectId = project.id;
        btn.setAttribute('onclick', "switchToProject('" + project.id + "')");

        const span = document.createElement('span');
        span.style.cssText = 'display: flex; align-items: center; gap: 0.5rem;';

        const colorDot = document.createElement('span');
        colorDot.className = 'project-color-indicator';
        colorDot.style.backgroundColor = projectColor;

        span.appendChild(colorDot);
        span.appendChild(document.createTextNode(project.name));
        btn.appendChild(span);
        nav.appendChild(btn);
    });
}

// Render projects grid
function renderProjectsGrid() {
    const grid = document.getElementById('projectsGrid');
    const emptyState = document.getElementById('projectsEmptyState');

    if (projects.length === 0) {
        grid.textContent = '';
        emptyState.style.display = 'block';
        return;
    }

    emptyState.style.display = 'none';
    // Build cards via innerHTML with escapeHtml — safe since all user data is escaped
    grid.innerHTML = projects.map(project => {
        const isOwner = project.owner_id === currentUser.id;
        const projectTasks = tasks.filter(t => t.project_id === project.id);
        const completedCount = projectTasks.filter(t => t.status === 'completed').length;
        const memberCount = getProjectMemberIds(project).length;
        const color = getProjectColor(project);

        return '<div class="project-card" onclick="openProjectSettings(\'' + project.id + '\')">' +
            '<div class="project-card-header">' +
            '<div>' +
            '<h3 class="project-card-title">' +
            '<span class="project-color-indicator" style="background-color: ' + color + '; margin-right: 6px;"></span>' +
            escapeHtml(project.name) +
            '</h3>' +
            (isOwner ? '<span class="project-owner-badge">Owner</span>' : '') +
            '</div>' +
            (isOwner ? '<button class="icon-btn" onclick="event.stopPropagation(); openProjectSettings(\'' + project.id + '\')" title="Settings">\u2699\uFE0F</button>' : '') +
            '</div>' +
            '<p class="project-card-description">' + escapeHtml(project.description || 'No description') + '</p>' +
            '<div class="project-card-stats">' +
            '<div class="project-stat"><span>\uD83D\uDCDD</span><span><span class="project-stat-number">' + projectTasks.length + '</span> tasks</span></div>' +
            '<div class="project-stat"><span>\u2705</span><span><span class="project-stat-number">' + completedCount + '</span> done</span></div>' +
            '<div class="project-stat"><span>\uD83D\uDC65</span><span><span class="project-stat-number">' + memberCount + '</span> members</span></div>' +
            '</div>' +
            '</div>';
    }).join('');
}

// Filter tasks
// Supabase schema: task.title, task.due_date, task.assigned_to
function filterTasks() {
    let filtered = [...tasks];

    if (currentView === 'my-tasks') {
        filtered = filtered.filter(t => t.assigned_to === currentUser.id);
    } else if (currentView === 'project' && currentProjectId) {
        filtered = filtered.filter(t => t.project_id === currentProjectId);
    }

    if (currentFilters.status) {
        filtered = filtered.filter(t => t.status === currentFilters.status);
    }

    if (currentFilters.priority) {
        filtered = filtered.filter(t => (t.priority || 'none').toLowerCase() === currentFilters.priority);
    }

    if (currentFilters.search) {
        filtered = filtered.filter(t =>
            (t.title || '').toLowerCase().includes(currentFilters.search) ||
            (t.description || '').toLowerCase().includes(currentFilters.search)
        );
    }

    const sortMode = currentFilters.sort || '';
    if (sortMode === 'priority') {
        const rank = { high: 1, medium: 2, low: 3, none: 4 };
        filtered.sort((a, b) => {
            const ra = rank[(a.priority || 'none').toLowerCase()] || 99;
            const rb = rank[(b.priority || 'none').toLowerCase()] || 99;
            if (ra !== rb) return ra - rb;
            const ad = new Date(a.due_date || a.created_at || 0).getTime();
            const bd = new Date(b.due_date || b.created_at || 0).getTime();
            return bd - ad;
        });
    } else if (sortMode === 'due') {
        filtered.sort((a, b) => {
            const ad = new Date(a.due_date || 0).getTime();
            const bd = new Date(b.due_date || 0).getTime();
            const aDue = isNaN(ad) ? Infinity : ad;
            const bDue = isNaN(bd) ? Infinity : bd;
            if (aDue !== bDue) return aDue - bDue;
            const ac = new Date(a.created_at || 0).getTime();
            const bc = new Date(b.created_at || 0).getTime();
            return bc - ac;
        });
    }

    // Pending before completed
    filtered.sort((a, b) => {
        const aCompleted = a.status === 'completed' ? 1 : 0;
        const bCompleted = b.status === 'completed' ? 1 : 0;
        return aCompleted - bCompleted;
    });

    return filtered;
}

// Render tasks
function renderTasks(tasksToRender) {
    const taskList = document.getElementById('taskList');
    const emptyState = document.getElementById('emptyState');

    if (!tasksToRender || tasksToRender.length === 0) {
        taskList.textContent = '';
        if (emptyState) {
            // Ensure the empty state always has a clear message
            const msgEl = emptyState.querySelector('.empty-state-text, p, h3') || emptyState;
            if (!msgEl.dataset.defaultText) {
                msgEl.dataset.defaultText = msgEl.textContent || 'No tasks yet';
            }
            emptyState.style.display = 'block';
        }
        const mobileCreate = document.querySelector('.mobile-create-wrap');
        if (mobileCreate) mobileCreate.style.display = 'none';
        return;
    }

    emptyState.style.display = 'none';
    taskList.innerHTML = tasksToRender.map(task => createTaskCard(task)).join('');
    const mobileCreate = document.querySelector('.mobile-create-wrap');
    if (mobileCreate) mobileCreate.style.display = '';
}

// Create task card HTML
// Supabase schema: task.title, task.due_date, task.assigned_to
function createTaskCard(task) {
    const dueDate = new Date(task.due_date);
    const formattedDate = formatDateSafe(task.due_date, { month: 'short', day: 'numeric' }) || 'No date';
    const isOverdue = !isNaN(dueDate.getTime()) && new Date() > dueDate && task.status !== 'completed';
    const isCompleted = task.status === 'completed';

    const project = projects.find(p => p.id === task.project_id);

    let projectLabel = '';
    let projectColor = '#cccccc';
    if (project) {
        projectLabel = project.name.toLowerCase();
        projectColor = getProjectColor(project);
    }

    const priority = (typeof task.priority === 'string' ? task.priority : 'none').toLowerCase().trim();
    const priorityColors = {
        'high': '#ef4444',
        'medium': '#f59e0b',
        'low': '#10b981'
    };
    const priorityColor = priorityColors[priority];
    const showPriorityTriangle = priority !== 'none' && priorityColor;

    const assignee = users.find(u => u.id === task.assigned_to);
    let assigneeInitials = '';
    let assigneeColor = '#667eea';
    if (assignee) {
        assigneeInitials = (assignee.username || assignee.name || '?')
            .split(/\s+/).map(w => w[0]).slice(0,2).join('').toUpperCase();
        assigneeColor = assignee.color || '#667eea';
    }

    return '<div class="task-card-compact ' + task.status + '" onclick="viewTaskDetails(\'' + task.id + '\')" style="border-left-color: ' + projectColor + ';">' +
        (showPriorityTriangle ? '<div class="priority-triangle" style="border-color: transparent ' + priorityColor + ' transparent transparent;" title="Priority: ' + priority + '"></div>' : '') +
        '<div class="task-card-main">' +
        '<div class="task-status-icon ' + (task.status || 'not_started') + '"' +
            ' onclick="showStatusDropdown(event, \'' + task.id + '\')"' +
            ' title="Click to change status"' +
            ' style="border-radius:50%;width:24px;height:24px;min-width:24px;min-height:24px;display:inline-flex;align-items:center;justify-content:center;font-size:12px;line-height:1;padding:0;box-sizing:border-box;">' +
            getStatusIcon(task.status) +
        '</div>' +
        '<h3 class="task-title-compact">' + escapeHtml(task.title || '') + '</h3>' +
        '</div>' +
        '<div class="task-card-footer">' +
        '<div class="task-footer-left">' +
        (assignee ?
            '<div class="assignee-circle" style="background-color: ' + assigneeColor + '" title="' + escapeHtml(assignee.name || assignee.username || '') + '">' +
            escapeHtml(assigneeInitials) +
            '</div>'
            : '') +
        '<span class="task-due ' + (isOverdue ? 'overdue' : '') + '">' + formattedDate + '</span>' +
        '</div>' +
        (project ?
            '<div class="task-project-badge">' +
            '<span class="project-color-dot" style="background-color: ' + projectColor + '"></span>' +
            '<span class="project-name-label">' + escapeHtml(projectLabel) + '</span>' +
            '</div>'
            : '') +
        '</div>' +
        '</div>';
}

// Update stats
function updateStats() {
    const filtered = filterTasks();
    const total = filtered.length;
    const completed = filtered.filter(t => t.status === 'completed').length;
    // Pending = not_started + in_progress + blocked + paused
    const pending = filtered.filter(t => t.status && t.status !== 'completed').length;

    document.getElementById('totalTasks').textContent = total;
    document.getElementById('completedTasks').textContent = completed;
    document.getElementById('pendingTasks').textContent = pending;
}

// Update UI
function updateUI() {
    const filtered = filterTasks();
    const total = filtered.length;
    const done = filtered.filter(t => t.status === 'completed').length;
    const pending = total - done;

    const mTotal = document.getElementById('mobileStatTotal');
    const mDone = document.getElementById('mobileStatDone');
    const mPending = document.getElementById('mobileStatPending');
    if (mTotal) mTotal.textContent = total;
    if (mDone) mDone.textContent = done;
    if (mPending) mPending.textContent = pending;

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
    const createMarkDoneBtn = document.getElementById('markDoneFromEditBtn');
    if (createMarkDoneBtn) createMarkDoneBtn.style.display = 'none';

    document.getElementById('taskDate').value = new Date().toISOString().split('T')[0];

    const prioritySelect = document.getElementById('taskPriority');
    if (prioritySelect) {
        prioritySelect.value = 'none';
        prioritySelect.dispatchEvent(new Event('change', { bubbles: true }));
    }

    const statusSelect = document.getElementById('taskStatus');
    if (statusSelect) {
        statusSelect.value = 'not_started';
        if (statusSelect._customSelect) {
            statusSelect._customSelect.selectedValue = 'not_started';
            const label = statusSelect._customSelect.container.querySelector('.select-label');
            if (label) label.textContent = '⏹ Not Started';
        }
    }

    const projectSelect = document.getElementById('taskProject');
    projectSelect.innerHTML = '<option value="">Select project...</option>' +
        projects.map(p => '<option value="' + p.id + '" data-color="' + getProjectColor(p) + '">' + escapeHtml(p.name) + '</option>').join('');

    const assigneeSelect = document.getElementById('taskAssignee');
    assigneeSelect.disabled = false;
    assigneeSelect.innerHTML = '<option value="">Select person...</option>';

    if (currentProjectId) {
        projectSelect.value = currentProjectId;
        loadProjectMembers(currentProjectId);
    }

    document.getElementById('taskModal').classList.add('active');
}

window.openTaskModal = window.openTaskModal || openTaskModal;
window.closeTaskModal = window.closeTaskModal || closeTaskModal;

// Load project members for assignee dropdown
function loadProjectMembers(projectId) {
    const project = projects.find(p => p.id === projectId);
    if (!project) return;

    const assigneeSelect = document.getElementById('taskAssignee');
    const memberIds = getProjectMemberIds(project);
    const projectMembers = users.filter(u => memberIds.includes(u.id));

    if (project.is_personal) {
        assigneeSelect.disabled = true;
        assigneeSelect.innerHTML = projectMembers.map(u =>
            '<option value="' + u.id + '">' + escapeHtml(u.username || u.name) + '</option>'
        ).join('');
        assigneeSelect.value = project.owner_id;
    } else {
        assigneeSelect.disabled = false;
        assigneeSelect.innerHTML = '<option value="">Select person...</option>' +
            projectMembers.map(u =>
                '<option value="' + u.id + '">' + escapeHtml(u.username || u.name) + '</option>'
            ).join('');
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
        document.getElementById('taskName').value = task.title || '';
        document.getElementById('taskDescription').value = task.description || '';
        document.getElementById('taskDate').value = task.due_date ? task.due_date.split('T')[0] : '';
        const prioSel = document.getElementById('taskPriority');
        if (prioSel) {
            prioSel.value = (typeof task.priority === 'string' ? task.priority : 'none').toLowerCase().trim();
            prioSel.dispatchEvent(new Event('change', { bubbles: true }));
        }

        const statusSel = document.getElementById('taskStatus');
        if (statusSel) {
            statusSel.value = task.status || 'not_started';
            if (statusSel._customSelect && typeof statusSel._customSelect.refresh === 'function') {
                statusSel._customSelect.refresh();
            }
        }

        const projectSelect = document.getElementById('taskProject');
        projectSelect.innerHTML = '<option value="">Select project...</option>' +
            projects.map(p => '<option value="' + p.id + '" data-color="' + getProjectColor(p) + '">' + escapeHtml(p.name) + '</option>').join('');
        projectSelect.value = task.project_id || '';

        if (task.project_id) {
            loadProjectMembers(task.project_id);
            setTimeout(() => {
                document.getElementById('taskAssignee').value = task.assigned_to || '';
            }, 0);
        }

        document.getElementById('taskModalTitle').textContent = 'Edit Task';
        document.getElementById('taskSubmitBtnText').textContent = 'Update Task';
        const editMarkDoneBtn = document.getElementById('markDoneFromEditBtn');
        if (editMarkDoneBtn) editMarkDoneBtn.style.display = 'none';

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
    if (!task) return;

    currentTaskDetailsId = id;

    const assignee = users.find(u => u.id === task.assigned_to);
    const project = projects.find(p => p.id === task.project_id);

    const dueDate = new Date(task.due_date);
    const formattedDate = formatDateSafe(task.due_date, {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    }) || 'No date';

    const priority = (typeof task.priority === 'string' ? task.priority : 'none').toLowerCase().trim();
    const priorityColors = { high: '#ef4444', medium: '#f59e0b', low: '#10b981' };
    const pColor = priorityColors[priority];
    const priorityLabel = priority.charAt(0).toUpperCase() + priority.slice(1);

    document.getElementById('detailsTaskName').textContent = task.title || '';
    document.getElementById('detailsTaskDescription').textContent = task.description || 'No description';

    const projEl = document.getElementById('detailsTaskProject');
    if (project) {
        const projColor = getProjectColor(project);
        projEl.textContent = '';
        const colorDot = document.createElement('span');
        colorDot.className = 'project-color-dot';
        colorDot.style.cssText = 'background-color: ' + projColor + '; margin-right: 6px;';
        projEl.appendChild(colorDot);
        projEl.appendChild(document.createTextNode(project.name));
    } else {
        projEl.textContent = 'No project';
    }

    document.getElementById('detailsTaskAssignee').textContent = assignee
        ? (assignee.username || assignee.name)
        : 'Unassigned';
    document.getElementById('detailsTaskDate').textContent = formattedDate;

    const prioEl = document.getElementById('detailsTaskPriority');
    prioEl.textContent = '';
    const tri = document.createElement('span');
    tri.className = 'priority-triangle-inline';
    tri.style.cssText = 'border-left-color: ' + (pColor && priority !== 'none' ? pColor : 'transparent') + '; margin-right: 6px;';
    prioEl.appendChild(tri);
    prioEl.appendChild(document.createTextNode(priorityLabel));

    const statusBadge = document.getElementById('detailsTaskStatus');
    const taskStatus = task.status || 'not_started';
    const statusColor = getStatusColor(taskStatus);
    const statusIcon = getStatusIcon(taskStatus);
    const statusLabel = getStatusLabel(taskStatus);
    
    statusBadge.className = 'task-status ' + taskStatus;
    statusBadge.innerHTML = '';
    const statusSpan = document.createElement('span');
    statusSpan.className = 'status-badge-clickable';
    statusSpan.style.cssText = 'background-color:' + statusColor + '20;border:1px solid ' + statusColor + ';color:' + statusColor + ';';
    statusSpan.title = 'Click to change status';
    const iconSpan = document.createElement('span');
    iconSpan.className = 'status-icon';
    iconSpan.textContent = statusIcon;
    const labelSpan = document.createElement('span');
    labelSpan.className = 'status-label';
    labelSpan.textContent = statusLabel;
    statusSpan.appendChild(iconSpan);
    statusSpan.appendChild(labelSpan);
    statusSpan.addEventListener('click', (e) => showStatusDropdown(e, task.id));
    statusBadge.appendChild(statusSpan);

    const markDoneBtn = document.getElementById('markDoneFromDetailsBtn');
    if (markDoneBtn) markDoneBtn.style.display = 'none';

    document.getElementById('taskDetailsModal').classList.add('active');
}

function closeTaskDetailsModal() {
    document.getElementById('taskDetailsModal').classList.remove('active');
    currentTaskDetailsId = null;
}

function editTaskFromDetails() {
    if (!currentTaskDetailsId) return;
    const taskId = currentTaskDetailsId;
    closeTaskDetailsModal();
    editTask(taskId);
}

async function markTaskDoneFromDetails() {
    if (!currentTaskDetailsId) return;
    const taskId = currentTaskDetailsId;
    closeTaskDetailsModal();
    await markTaskDone(taskId);
}

async function markTaskDoneFromEdit() {
    const taskId = document.getElementById('taskId').value;
    if (!taskId) return;
    closeTaskModal();
    await markTaskDone(taskId);
}

async function markTaskDone(taskId) {
    const task = tasks.find(t => t.id === taskId);
    if (!task || task.status === 'completed') return;

    const originalStatus = task.status;
    task.status = 'completed';
    updateUI();

    try {
        const client = ensureSupabase();
        if (!client) throw new Error('Not connected');

        const { data: updatedTask, error } = await client
            .from('tasks')
            .update({ status: 'completed', updated_at: new Date().toISOString() })
            .eq('id', taskId)
            .select()
            .single();

        if (error) throw new Error(error.message);

        const idx = tasks.findIndex(t => t.id === taskId);
        if (idx !== -1) tasks[idx] = updatedTask;

        celebrate();
        showSuccess('\uD83C\uDF89 Awesome! Task completed!');
    } catch (err) {
        task.status = originalStatus;
        updateUI();
        showError(err.message);
    }
}

async function deleteTaskFromDetails() {
    if (!currentTaskDetailsId) return;
    const taskId = currentTaskDetailsId;
    closeTaskDetailsModal();
    await deleteTask(taskId);
}

function validateTaskForm() {
    let valid = true;

    document.querySelectorAll('#taskModal .form-input').forEach(el => {
        el.classList.remove('input-error');
    });

    const title = document.getElementById('taskName').value.trim();
    if (!title) {
        document.getElementById('taskName').classList.add('input-error');
        valid = false;
    }

    const projectId = document.getElementById('taskProject').value;
    const projectSelect = document.getElementById('taskProject');
    if (!projectId) {
        const trigger = projectSelect?.closest('.custom-select-wrapper')?.querySelector('.custom-select-trigger');
        if (trigger) trigger.classList.add('input-error');
        valid = false;
    }

    const dateVal = document.getElementById('taskDate').value;
    if (!dateVal) {
        document.getElementById('taskDate').classList.add('input-error');
        valid = false;
    }

    if (!valid) {
        showError('Please fill in all required fields');
    }

    return valid;
}

// Handle task submit
async function handleTaskSubmit(e) {
    e.preventDefault();

    if (!validateTaskForm()) return;

    const submitBtn = e.target.querySelector('button[type="submit"]');
    const submitBtnText = document.getElementById('taskSubmitBtnText');
    const originalText = submitBtnText.textContent;

    submitBtn.disabled = true;
    submitBtnText.textContent = 'Saving...';

    const taskId = document.getElementById('taskId').value;

    const prioSelect = document.getElementById('taskPriority');
    const selectedPriority = prioSelect && prioSelect._customSelect
        ? prioSelect._customSelect.selectedValue
        : (prioSelect ? prioSelect.value : 'none');
    const normalizedPriority = (typeof selectedPriority === 'string' ? selectedPriority : 'none').toLowerCase().trim();

    const isoDate = document.getElementById('taskDate').value || null;

    // Supabase schema: title, due_date, assigned_to
    const statusSelect = document.getElementById('taskStatus');
    const taskStatus = statusSelect ? statusSelect.value : 'not_started';

    const taskData = {
        title: document.getElementById('taskName').value,
        description: document.getElementById('taskDescription').value,
        due_date: isoDate,
        project_id: document.getElementById('taskProject').value || null,
        assigned_to: document.getElementById('taskAssignee').value || null,
        priority: normalizedPriority,
        status: taskStatus
    };

    try {
        const client = ensureSupabase();
        if (!client) throw new Error('Not connected');

        let result, error;

        if (taskId) {
            ({ data: result, error } = await client
                .from('tasks')
                .update({ ...taskData, updated_at: new Date().toISOString() })
                .eq('id', taskId)
                .select()
                .single());
        } else {
            ({ data: result, error } = await client
                .from('tasks')
                .insert({ ...taskData, created_by: currentUser.id })
                .select()
                .single());
        }

        if (error) throw new Error(error.message);

        // Log activity
        try {
            await client.from('activity_log').insert({
                user_id: currentUser.id,
                action: taskId ? 'task_updated' : 'task_created',
                details: { task_id: result.id, title: result.title }
            });
        } catch (_) {}

        closeTaskModal();
        closeTaskDetailsModal();
        await loadTasks();
        updateUI();

        showSuccess(taskId ? 'Task updated successfully!' : 'Task created successfully!');
    } catch (error) {
        showError(error.message);
    } finally {
        submitBtn.disabled = false;
        submitBtnText.textContent = originalText;
    }
}

// Status constants and helpers
const STATUS_ORDER = ['not_started', 'in_progress', 'blocked', 'paused', 'completed'];
const STATUS_COLORS = {
    'not_started': '#9ca3af',
    'in_progress': '#3b82f6',
    'blocked': '#ef4444',
    'paused': '#eab308',
    'completed': '#22c55e'
};
const STATUS_ICONS = {
    'not_started': '⏹',
    'in_progress': '▶',
    'blocked': '⛔',
    'paused': '⏸',
    'completed': '✓'
};
const STATUS_LABELS = {
    'not_started': 'Not Started',
    'in_progress': 'In Progress',
    'blocked': 'Blocked',
    'paused': 'Paused',
    'completed': 'Completed'
};

function getStatusIcon(status) {
    return STATUS_ICONS[status] || STATUS_ICONS['not_started'];
}

function getStatusLabel(status) {
    return STATUS_LABELS[status] || 'Unknown';
}

function getStatusColor(status) {
    return STATUS_COLORS[status] || '#9ca3af';
}

// Show status dropdown near the clicked element
function showStatusDropdown(event, id) {
    event.stopPropagation();

    const task = tasks.find(t => t.id === id);
    if (!task) return;

    // Remove any existing dropdown
    const existing = document.getElementById('statusDropdown');
    if (existing) existing.remove();

    const anchor = event.currentTarget;
    const rect = anchor.getBoundingClientRect();

    const dropdown = document.createElement('div');
    dropdown.id = 'statusDropdown';
    dropdown.className = 'status-dropdown';

    STATUS_ORDER.forEach(status => {
        const item = document.createElement('div');
        item.className = 'status-dropdown-item' + (status === (task.status || 'not_started') ? ' active' : '');

        const icon = document.createElement('span');
        icon.className = 'status-dropdown-icon';
        icon.style.color = getStatusColor(status);
        icon.textContent = getStatusIcon(status);

        const label = document.createElement('span');
        label.textContent = getStatusLabel(status);

        item.appendChild(icon);
        item.appendChild(label);

        item.addEventListener('click', (e) => {
            e.stopPropagation();
            dropdown.remove();
            document.removeEventListener('click', outsideClick);
            setTaskStatus(id, status);
        });

        dropdown.appendChild(item);
    });

    document.body.appendChild(dropdown);

    // Position below anchor; flip up if too close to bottom
    const dropH = STATUS_ORDER.length * 36 + 8;
    const fitsBelow = rect.bottom + dropH + 8 < window.innerHeight;
    dropdown.style.top = (fitsBelow ? rect.bottom + 4 : rect.top - dropH - 4) + 'px';
    dropdown.style.left = rect.left + 'px';

    function outsideClick() {
        dropdown.remove();
        document.removeEventListener('click', outsideClick);
    }
    setTimeout(() => document.addEventListener('click', outsideClick), 0);
}

// Set task status and persist to DB
async function setTaskStatus(id, newStatus) {
    const task = tasks.find(t => t.id === id);
    if (!task) return;

    const originalStatus = task.status;
    task.status = newStatus;
    updateUI();

    try {
        const client = ensureSupabase();
        if (!client) throw new Error('Not connected');

        const { data: updatedTask, error } = await client
            .from('tasks')
            .update({ status: newStatus, updated_at: new Date().toISOString() })
            .eq('id', id)
            .select()
            .single();

        if (error) throw new Error(error.message);

        const taskIndex = tasks.findIndex(t => t.id === id);
        if (taskIndex !== -1) tasks[taskIndex] = updatedTask;

        if (newStatus === 'completed') celebrate();
        showSuccess('Status changed to ' + getStatusLabel(newStatus));

        // Refresh details modal if open
        if (currentTaskDetailsId === id) viewTaskDetails(id);

    } catch (error) {
        console.error('Status update failed:', error);
        task.status = originalStatus;
        updateUI();
        showError('Failed to update status. Please try again.');
    }
}

// Quick complete task

async function quickCompleteTask(event, id, checked) {
    event.stopPropagation();

    const task = tasks.find(t => t.id === id);
    if (!task) return;

    const checkbox = event.target.closest('.task-checkbox');
    if (!checkbox) return;
    if (checkbox.dataset.loading === 'true') return;
    checkbox.dataset.loading = 'true';

    const newStatus = checked ? 'completed' : 'not_started';
    const originalStatus = task.status;

    // Optimistic update
    task.status = newStatus;
    checkbox.classList.add('updating');
    updateUI();

    try {
        const client = ensureSupabase();
        if (!client) throw new Error('Not connected');

        const { data: updatedTask, error } = await client
            .from('tasks')
            .update({ status: newStatus, updated_at: new Date().toISOString() })
            .eq('id', id)
            .select()
            .single();

        if (error) throw new Error(error.message);

        const taskIndex = tasks.findIndex(t => t.id === id);
        if (taskIndex !== -1) {
            tasks[taskIndex] = updatedTask;
        }

        checkbox.classList.remove('updating');

        if (newStatus === 'completed') {
            celebrate();
            showSuccess('\uD83C\uDF89 Awesome! Task completed!');
        }

    } catch (error) {
        console.error('Task update failed:', error);
        task.status = originalStatus;
        checkbox.classList.remove('updating');
        updateUI();
        showError('Failed to update task. Please try again.');
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

    deleteBtn.disabled = true;
    cancelBtn.disabled = true;
    deleteBtn.textContent = 'Deleting...';

    try {
        const client = ensureSupabase();
        if (!client) throw new Error('Not connected');

        const { error } = await client
            .from('tasks')
            .delete()
            .eq('id', taskToDelete);

        if (error) throw new Error(error.message);

        closeDeleteModal();
        const deletedId = taskToDelete;
        tasks = tasks.filter(t => t.id !== deletedId);
        renderTasks(filterTasks());
        updateStats();
        showSuccess('Task deleted successfully');
    } catch (error) {
        showError('Failed to delete task');
        await loadTasks();
    } finally {
        deleteBtn.disabled = false;
        cancelBtn.disabled = false;
        deleteBtn.textContent = 'Delete';
    }
}

// PROJECT MANAGEMENT

function openProjectModal() {
    document.getElementById('projectForm').reset();
    document.getElementById('projectId').value = '';
    document.getElementById('projectColor').value = '#f06a6a';
    updateColorPresetSelection('#f06a6a');
    document.getElementById('projectModalTitle').textContent = 'Create New Project';
    document.getElementById('projectSubmitBtnText').textContent = 'Create Project';

    renderProjectMembersCheckboxes();
    document.getElementById('projectModal').classList.add('active');
}

function renderProjectMembersCheckboxes() {
    const container = document.getElementById('projectMembersCheckboxList');
    if (!container) return;
    const availableUsers = users.filter(u => u.id !== currentUser.id);

    if (availableUsers.length === 0) {
        container.textContent = 'No other users available';
        return;
    }

    container.innerHTML = availableUsers.map(user =>
        '<label style="display: flex; align-items: center; padding: 0.5rem; cursor: pointer; border-radius: 0.25rem; transition: background 0.15s;">' +
        '<input type="checkbox" name="projectMember" value="' + user.id + '" style="margin-right: 0.75rem; cursor: pointer;">' +
        '<span style="flex: 1;">' + escapeHtml(user.name || user.username) + '</span>' +
        '</label>'
    ).join('');
}

function closeProjectModal() {
    document.getElementById('projectModal').classList.remove('active');
}

// Handle project submit
async function handleProjectSubmit(e) {
    e.preventDefault();

    const submitBtn = e.target.querySelector('button[type="submit"]');
    const submitBtnText = document.getElementById('projectSubmitBtnText');
    const originalText = submitBtnText.textContent;

    submitBtn.disabled = true;
    submitBtnText.textContent = 'Saving...';

    const projectId = document.getElementById('projectId').value;
    const projectColor = document.getElementById('projectColor').value || '#f06a6a';
    const projectData = {
        name: document.getElementById('projectName').value,
        description: document.getElementById('projectDescription').value,
        color: projectColor
    };

    try {
        const client = ensureSupabase();
        if (!client) throw new Error('Not connected');

        let result, error;

        if (projectId) {
            ({ data: result, error } = await client
                .from('projects')
                .update(projectData)
                .eq('id', projectId)
                .select()
                .single());
        } else {
            ({ data: result, error } = await client
                .from('projects')
                .insert({ ...projectData, owner_id: currentUser.id, is_personal: false })
                .select()
                .single());

            // Add owner as project member
            if (!error && result) {
                await client.from('project_members').insert({
                    project_id: result.id,
                    user_id: currentUser.id,
                    role: 'owner'
                });

                // Add selected members
                const selectedMembers = Array.from(document.querySelectorAll('input[name="projectMember"]:checked'))
                    .map(cb => cb.value);
                for (const memberId of selectedMembers) {
                    await client.from('project_members').insert({
                        project_id: result.id,
                        user_id: memberId,
                        role: 'member'
                    });
                }
            }
        }

        if (error) throw new Error(error.message);

        closeProjectModal();
        await loadProjects();
        renderProjectsGrid();

        if (projectId && currentView === 'project' && currentProjectId === projectId) {
            switchToProject(projectId);
        }

        showSuccess(projectId ? 'Project updated successfully!' : 'Project created successfully!');
    } catch (error) {
        showError(error.message);
    } finally {
        submitBtn.disabled = false;
        submitBtnText.textContent = originalText;
    }
}

// Open project settings
function openProjectSettings(projectId) {
    if (!projectId) projectId = currentProjectId;
    if (!projectId) { showError('Please select a project first'); return; }
    currentProjectForSettings = projectId;
    let project = projects.find(p => p.id === projectId);
    if (!project) {
        return loadProjects().then(() => {
            project = projects.find(p => p.id === projectId);
            if (!project) {
                showError('Project not found');
                return;
            }
            return openProjectSettings(projectId);
        });
    }

    const memberIds = getProjectMemberIds(project);
    const owner = users.find(u => u.id === project.owner_id);
    const isOwner = project.owner_id === currentUser.id;

    document.getElementById('settingsProjectName').textContent = project.name;
    document.getElementById('settingsProjectOwner').textContent = owner ? (owner.username || owner.name) : 'Unknown';
    document.getElementById('settingsProjectDescription').textContent = project.description || 'No description provided';

    const personalNotice = document.getElementById('personalProjectNotice') ||
        (() => {
            const el = document.createElement('p');
            el.id = 'personalProjectNotice';
            el.style.cssText = 'color:var(--text-secondary);font-size:0.875rem;font-style:italic;margin-top:0.5rem;';
            el.textContent = '';
            document.querySelector('#projectSettingsModal .settings-section')?.appendChild(el);
            return el;
        })();
    if (personalNotice) {
        const isGeneral = project.id === GENERAL_PROJECT_ID;
        if (project.is_personal) {
            personalNotice.textContent = 'This is your personal project. It cannot be edited or deleted.';
            personalNotice.style.display = 'block';
        } else if (isGeneral) {
            personalNotice.textContent = 'This is the shared General project. All team members are automatically included.';
            personalNotice.style.display = 'block';
        } else {
            personalNotice.style.display = 'none';
        }
    }

    const colorRowId = 'settingsProjectColor';
    let colorRowEl = document.getElementById(colorRowId);
    if (!colorRowEl) {
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
        const color = getProjectColor(project);
        colorRowEl.textContent = '';
        const dot = document.createElement('span');
        dot.className = 'project-color-dot project-color-dot-lg';
        dot.style.backgroundColor = color;
        dot.title = 'Project color';
        colorRowEl.appendChild(dot);
    }

    const editBtn = document.getElementById('editProjectSettingsBtn');
    const membersSectionEl = document.getElementById('settingsTeamMembersSection');
    const dangerZoneEl = document.getElementById('dangerZoneSection');
    const addMemberSection = document.querySelector('#projectSettingsModal .add-member-section');

    const isGeneral = project.id === GENERAL_PROJECT_ID;
    const canEdit = isOwner && !project.is_personal && !isGeneral;
    if (editBtn) editBtn.style.display = canEdit ? '' : 'none';
    if (membersSectionEl) membersSectionEl.style.display = project.is_personal ? 'none' : '';
    if (dangerZoneEl) dangerZoneEl.style.display = canEdit ? 'flex' : 'none';
    if (addMemberSection) addMemberSection.style.display = canEdit ? '' : 'none';

    if (!project.is_personal) {
        renderMembersList(project);
    } else {
        const membersList = document.getElementById('membersList');
        if (membersList) membersList.textContent = '';
    }

    // Populate add member dropdown — exclude current members
    const availableUsers = users.filter(u => !memberIds.includes(u.id));
    const select = document.getElementById('newMemberSelect');
    select.innerHTML = '<option value="">Add team member...</option>' +
        availableUsers.map(u =>
            '<option value="' + u.id + '">' + escapeHtml(u.name || u.username) + '</option>'
        ).join('');

    document.getElementById('projectSettingsModal').classList.add('active');
}

// Render members list
function renderMembersList(project) {
    const membersList = document.getElementById('membersList');
    const isOwner = project.owner_id === currentUser.id;

    // Build member objects from project_members join data
    let members = [];
    if (Array.isArray(project.project_members)) {
        members = project.project_members
            .filter(pm => pm.profiles)
            .map(pm => ({ ...pm.profiles, _role: pm.role }));
    }

    // Fallback to users array
    if (members.length === 0) {
        const memberIds = getProjectMemberIds(project);
        members = users.filter(u => memberIds.includes(u.id));
    }

    if (members.length === 0) {
        membersList.textContent = 'No members yet. Add team members below.';
        return;
    }

    const sortedMembers = [...members].sort((a, b) => {
        if (a.id === currentUser.id) return -1;
        if (b.id === currentUser.id) return 1;
        return 0;
    });

    const isGeneral = project.id === GENERAL_PROJECT_ID;
    membersList.innerHTML = sortedMembers.map(member => {
        const isCurrentUser = member.id === currentUser.id;
        const showLeaveButton = isCurrentUser && !isOwner && !isGeneral;
        const showRemoveButton = isOwner && !isCurrentUser && !isGeneral;

        const initials = getInitials(member);
        const avatarStyle = member.color ? 'style="background-color: ' + member.color + ';"' : '';

        return '<div class="member-item">' +
            '<div class="member-info">' +
            '<div class="member-avatar" ' + avatarStyle + '>' + escapeHtml(initials) + '</div>' +
            '<div class="member-details">' +
            '<div class="member-name">' + escapeHtml(member.username || member.name) + '</div>' +
            '<div class="member-role">' + escapeHtml(member._role || 'Member') + '</div>' +
            '</div>' +
            '</div>' +
            '<div class="member-actions">' +
            (showLeaveButton ? '<button class="leave-project-btn" onclick="leaveProject()" title="Leave project">\xD7</button>' : '') +
            (showRemoveButton ? '<button class="remove-member-btn" onclick="removeMember(\'' + member.id + '\')" title="Remove member">\xD7</button>' : '') +
            '</div>' +
            '</div>';
    }).join('');
}

// Add member by user_id (selected from dropdown)
async function addMember() {
    const userId = document.getElementById('newMemberSelect').value;
    if (!userId || !currentProjectForSettings) return;

    const select = document.getElementById('newMemberSelect');
    const addBtn = event.target;

    select.disabled = true;
    addBtn.disabled = true;
    addBtn.textContent = 'Adding...';

    try {
        const client = ensureSupabase();
        if (!client) throw new Error('Not connected');

        const { error } = await client
            .from('project_members')
            .insert({
                project_id: currentProjectForSettings,
                user_id: userId,
                role: 'member'
            });

        if (error) throw new Error(error.message);

        await loadProjects();
        const project = projects.find(p => p.id === currentProjectForSettings);
        renderMembersList(project);

        const memberIds = getProjectMemberIds(project);
        const availableUsers = users.filter(u => !memberIds.includes(u.id));
        select.innerHTML = '<option value="">Add team member...</option>' +
            availableUsers.map(u =>
                '<option value="' + u.id + '">' + escapeHtml(u.name || u.username) + '</option>'
            ).join('');

        showSuccess('Member added successfully');
    } catch (error) {
        showError(error.message);
    } finally {
        select.disabled = false;
        addBtn.disabled = false;
        addBtn.textContent = 'Add';
    }
}

// Remove member
async function removeMember(userId) {
    if (!currentProjectForSettings) return;
    if (currentProjectForSettings === GENERAL_PROJECT_ID) { showError('Cannot remove members from the General project'); return; }

    const memberUser = users.find(u => u.id === userId);
    const memberName = memberUser ? (memberUser.name || memberUser.username || 'this member') : 'this member';

    showConfirmModal(
        'Remove member',
        `Remove ${memberName} from this project? They will lose access to all tasks.`,
        () => _doRemoveMember(userId)
    );
}

async function _doRemoveMember(userId) {
    try {
        const client = ensureSupabase();
        if (!client) throw new Error('Not connected');

        const { error } = await client
            .from('project_members')
            .delete()
            .eq('project_id', currentProjectForSettings)
            .eq('user_id', userId);

        if (error) throw new Error(error.message);

        await loadProjects();
        const project = projects.find(p => p.id === currentProjectForSettings);
        renderMembersList(project);

        const memberIds = getProjectMemberIds(project);
        const availableUsers = users.filter(u => !memberIds.includes(u.id));
        const select = document.getElementById('newMemberSelect');
        select.innerHTML = '<option value="">Add team member...</option>' +
            availableUsers.map(u =>
                '<option value="' + u.id + '">' + escapeHtml(u.name || u.username) + '</option>'
            ).join('');

        showSuccess('Member removed successfully');
    } catch (error) {
        showError('Failed to remove member');
    }
}

// Leave project (for non-owners)
async function leaveProject() {
    if (!currentProjectForSettings || !currentUser) return;
    if (currentProjectForSettings === GENERAL_PROJECT_ID) { showError('Cannot leave the General project'); return; }
    showConfirmModal(
        'Leave project',
        'You will lose access to this project and all its tasks.',
        () => _doLeaveProject()
    );
}

async function _doLeaveProject() {
    const leaveBtn = document.querySelector('.leave-project-btn');
    const originalText = leaveBtn ? leaveBtn.textContent : '×';
    if (leaveBtn) { leaveBtn.disabled = true; leaveBtn.textContent = '...'; }

    try {
        const client = ensureSupabase();
        if (!client) throw new Error('Not connected');

        const { error } = await client
            .from('project_members')
            .delete()
            .eq('project_id', currentProjectForSettings)
            .eq('user_id', currentUser.id);

        if (error) throw new Error(error.message);

        closeProjectSettingsModal();
        await Promise.all([loadProjects(), loadTasks()]);
        if (currentProjectId === currentProjectForSettings) switchView('all');
        showSuccess('Left project successfully');
    } catch (error) {
        console.error('Leave project error:', error);
        showError(error.message || 'Failed to leave project');
        if (leaveBtn) { leaveBtn.disabled = false; leaveBtn.textContent = originalText; }
    }
}

// Close project settings modal
function closeProjectSettingsModal() {
    document.getElementById('projectSettingsModal').classList.remove('active');
    currentProjectForSettings = null;
    switchProjectSettingsTab('details');
}

// Switch between tabs in Project Settings modal
function switchProjectSettingsTab(tabName) {
    const tabButtons = document.querySelectorAll('#projectSettingsModal .tab-btn');
    tabButtons.forEach(btn => {
        if (btn.dataset.tab === tabName) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });

    const detailsTab = document.getElementById('projectDetailsTab');
    const membersTab = document.getElementById('projectMembersTab');

    if (tabName === 'details') {
        detailsTab.classList.add('active');
        membersTab.classList.remove('active');
    } else if (tabName === 'members') {
        detailsTab.classList.remove('active');
        membersTab.classList.add('active');
    }
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
    if (currentProjectForSettings === GENERAL_PROJECT_ID) { showError('The General project cannot be deleted'); return; }
    const project = projects.find(p => p.id === currentProjectForSettings);
    const projectName = project ? project.name : 'this project';
    showConfirmModal(
        'Delete project',
        `Delete "${projectName}"? All tasks in this project will be permanently deleted. This cannot be undone.`,
        () => _doDeleteProject()
    );
}

async function _doDeleteProject() {
    const deleteBtn = document.querySelector('.danger-zone .btn-danger');
    const originalText = deleteBtn ? deleteBtn.textContent : 'Delete';

    if (deleteBtn) { deleteBtn.disabled = true; deleteBtn.textContent = 'Deleting...'; }

    try {
        const client = ensureSupabase();
        if (!client) throw new Error('Not connected');

        const { error } = await client
            .from('projects')
            .delete()
            .eq('id', currentProjectForSettings);

        if (error) throw new Error(error.message);

        const deletedId = currentProjectForSettings;
        closeProjectSettingsModal();
        await Promise.all([loadProjects(), loadTasks()]);

        if (currentProjectId === deletedId) {
            switchView('all');
        } else {
            updateUI();
        }

        showSuccess('Project deleted successfully');
    } catch (error) {
        showError('Failed to delete project');
        if (deleteBtn) { deleteBtn.disabled = false; deleteBtn.textContent = originalText; }
    }
}

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
        const client = ensureSupabase();
        if (!client) throw new Error('Not connected');

        const { error } = await client
            .from('projects')
            .delete()
            .eq('id', id);

        if (error) throw new Error(error.message);

        closeProjectDeleteModal();
        try { closeProjectSettingsModal(); } catch(_) {}
        if (typeof closeProjectDetailsModal === 'function') {
            try { closeProjectDetailsModal(); } catch(_) {}
        }
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
    if (!projectId) projectId = currentProjectId;
    if (!projectId) { showError('Please select a project first'); return; }
    let project = projects.find(p => p.id === projectId);
    if (!project) {
        return loadProjects().then(() => {
            project = projects.find(p => p.id === projectId);
            if (!project) {
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

    if (project.owner_id !== currentUser.id) {
        openProjectSettings(projectId);
        return;
    }

    document.getElementById('projectId').value = project.id;
    document.getElementById('projectName').value = project.name || '';
    document.getElementById('projectDescription').value = project.description || '';
    const colorVal = getProjectColor(project);
    document.getElementById('projectColor').value = colorVal;
    updateColorPresetSelection(colorVal);
    document.getElementById('projectModalTitle').textContent = 'Edit Project';
    document.getElementById('projectSubmitBtnText').textContent = 'Update Project';

    document.getElementById('projectModal').classList.add('active');
}

// CELEBRATION ANIMATION
function celebrate() {
    function randomInRange(min, max) {
        return Math.random() * (max - min) + min;
    }

    for (let i = 0; i < 30; i++) {
        createConfetti(randomInRange(0.1, 0.9), randomInRange(0.1, 0.3));
    }
}

function createConfetti(x, y) {
    const confetti = document.createElement('div');
    const colors = ['#f06a6a', '#13ce66', '#ffc82c', '#4f46e5', '#ff4949'];
    const color = colors[Math.floor(Math.random() * colors.length)];

    confetti.style.cssText = 'position: fixed; width: 10px; height: 10px; background-color: ' + color + '; left: ' + (x * 100) + '%; top: ' + (y * 100) + '%; opacity: 1; transform: rotate(0deg); animation: confetti-fall 0.5s linear forwards; z-index: 10000; border-radius: ' + (Math.random() > 0.5 ? '50%' : '0') + ';';

    document.body.appendChild(confetti);
    setTimeout(() => confetti.remove(), 500);
}

// UTILITY FUNCTIONS
function getInitials(user) {
    if (user.initials) return user.initials.toUpperCase();
    const name = user.name || user.username || '?';
    const parts = name.trim().split(/\s+/);
    return (parts.length === 1 ? parts[0].substring(0, 2) : parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

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
    notification.style.cssText = 'position: fixed; top: 20px; right: 20px; background-color: rgba(19, 206, 102, 0.8); color: white; padding: 1rem 1.5rem; border-radius: 0.5rem; box-shadow: var(--shadow-lg); z-index: 10000; animation: slideInRight 0.3s; backdrop-filter: blur(10px);';
    notification.textContent = message;
    document.body.appendChild(notification);
    setTimeout(() => {
        notification.style.animation = 'slideOutRight 0.3s';
        setTimeout(() => notification.remove(), 300);
    }, 3000);
}

function showError(message) {
    const notification = document.createElement('div');
    notification.style.cssText = 'position: fixed; top: 20px; right: 20px; background-color: rgba(255, 73, 73, 0.8); color: white; padding: 1rem 1.5rem; border-radius: 0.5rem; box-shadow: var(--shadow-lg); z-index: 10000; animation: slideInRight 0.3s; backdrop-filter: blur(10px);';
    notification.textContent = message;
    document.body.appendChild(notification);
    setTimeout(() => {
        notification.style.animation = 'slideOutRight 0.3s';
        setTimeout(() => notification.remove(), 300);
    }, 3000);
}

// Add animations CSS
const style = document.createElement('style');
style.textContent = '@keyframes slideInRight { from { transform: translateX(100%); opacity: 0; } to { transform: translateX(0); opacity: 1; } } @keyframes slideOutRight { from { transform: translateX(0); opacity: 1; } to { transform: translateX(100%); opacity: 0; } } @keyframes confetti-fall { 0% { transform: translateY(0) rotate(0deg); opacity: 1; } 100% { transform: translateY(100vh) rotate(720deg); opacity: 0; } }';
document.head.appendChild(style);

// CUSTOM SELECT DROPDOWN
class CustomSelect {
    constructor(selectElement) {
        this.selectElement = selectElement;
        this.selectedValue = selectElement.value;
        this.isOpen = false;
        this.create();
        this.addEventListeners();
        this.selectElement.dataset.customized = 'true';
        this.selectElement._customSelect = this;
        this.scroller = null;
        this._onResize = null;
        this._onScroll = null;
    }

    create() {
        this.container = document.createElement('div');
        this.container.className = 'custom-select';

        this.trigger = document.createElement('button');
        this.trigger.type = 'button';
        this.trigger.className = 'custom-select-trigger';

        this.selectedContainer = document.createElement('span');
        this.selectedContainer.className = 'selected-container';
        this.selectedContainer.style.display = 'inline-flex';
        this.selectedContainer.style.alignItems = 'center';
        this.selectedContainer.style.gap = '0.5rem';

        this.selectedDot = document.createElement('span');
        this.selectedDot.className = 'priority-triangle-inline';
        this.selectedDot.style.display = 'none';

        this.selectedText = document.createElement('span');
        this.updateSelectedText();

        this.selectedContainer.appendChild(this.selectedDot);
        this.selectedContainer.appendChild(this.selectedText);
        this.trigger.appendChild(this.selectedContainer);

        const arrow = document.createElement('span');
        arrow.className = 'arrow';
        this.trigger.appendChild(arrow);

        this.dropdown = document.createElement('div');
        this.dropdown.className = 'custom-select-dropdown';

        this.createOptions();

        this.container.appendChild(this.trigger);
        this.container.appendChild(this.dropdown);

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

            if (this.selectElement.id === 'taskPriority') {
                const tri = document.createElement('span');
                tri.className = 'priority-triangle-inline';
                const color = this.getPriorityColor(option.value);
                if (color) tri.style.borderLeftColor = color;
                optionBtn.appendChild(tri);
                const label = document.createElement('span');
                label.textContent = option.textContent;
                optionBtn.appendChild(label);
            } else if (this.selectElement.id === 'taskProject' && option.value) {
                const dot = document.createElement('span');
                dot.style.cssText = 'width:10px;height:10px;border-radius:50%;background:' + (option.dataset.color || '#cccccc') + ';display:inline-block;flex-shrink:0;';
                optionBtn.appendChild(dot);
                const label = document.createElement('span');
                label.textContent = option.textContent;
                optionBtn.appendChild(label);
            } else if (this.selectElement.id === 'taskStatus' && option.value) {
                const icon = document.createElement('span');
                icon.textContent = getStatusIcon(option.value);
                icon.style.cssText = 'color:' + getStatusColor(option.value) + ';font-size:13px;width:18px;text-align:center;flex-shrink:0;';
                optionBtn.appendChild(icon);
                const label = document.createElement('span');
                label.textContent = getStatusLabel(option.value);
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
            if (this.selectElement.id === 'taskPriority') {
                const value = selectedOption.value;
                const color = this.getPriorityColor(value);
                if (color && value !== 'none') {
                    this.selectedDot.style.display = 'inline-block';
                    this.selectedDot.style.borderLeftColor = color;
                } else {
                    this.selectedDot.style.display = 'none';
                }
            } else if (this.selectElement.id === 'taskProject') {
                const color = selectedOption.dataset.color || '#cccccc';
                this.selectedDot.className = '';
                this.selectedDot.style.cssText = 'width:10px;height:10px;border-radius:50%;background:' + color + ';display:inline-block;flex-shrink:0;';
            } else if (this.selectElement.id === 'taskStatus') {
                this.selectedDot.className = '';
                this.selectedDot.style.cssText = 'display:inline-block;font-size:13px;color:' + getStatusColor(selectedOption.value) + ';';
                this.selectedDot.textContent = getStatusIcon(selectedOption.value);
                this.selectedText.textContent = getStatusLabel(selectedOption.value);
            } else {
                this.selectedDot.style.display = 'none';
            }
        } else {
            this.selectedText.textContent = (this.selectElement.options[0] && this.selectElement.options[0].textContent) || 'Select...';
            this.selectedText.classList.add('placeholder');
            this.selectedDot.style.display = 'none';
        }
    }

    selectOption(value) {
        this.selectedValue = value;
        this.selectElement.value = value;

        const event = new Event('change', { bubbles: true });
        this.selectElement.dispatchEvent(event);

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
        this.scroller = this.getScrollContainer();
        this.positionDropdown();
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
        if (this._observer) {
            this._observer.disconnect();
            this._observer = null;
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

        document.addEventListener('click', (e) => {
            if (!this.container.contains(e.target)) {
                this.close();
            }
        });

        this.selectElement.addEventListener('change', () => {
            this.selectedValue = this.selectElement.value;
            this.updateSelectedText();
            if (this.dropdown) {
                this.dropdown.querySelectorAll('.custom-select-option').forEach(opt => {
                    opt.classList.toggle('selected', opt.dataset.value === this.selectedValue);
                });
            }
        });

        this._observer = new MutationObserver(() => {
            this.refresh();
        });
        this._observer.observe(this.selectElement, { childList: true, subtree: true });
    }

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
        return window;
    }

    positionDropdown() {
        const gap = 8;
        const desiredMax = 250;
        const triggerRect = this.trigger.getBoundingClientRect();
        const containerRect = this.container.getBoundingClientRect();
        let spaceAbove, spaceBelow;

        if (this.scroller === window) {
            spaceAbove = triggerRect.top - gap;
            spaceBelow = window.innerHeight - triggerRect.bottom - gap;
        } else {
            const scrollRect = this.scroller.getBoundingClientRect();
            spaceAbove = triggerRect.top - scrollRect.top - gap;
            spaceBelow = scrollRect.bottom - triggerRect.bottom - gap;
        }

        const openUp = spaceBelow < Math.min(180, desiredMax) && spaceAbove > spaceBelow;
        this.container.classList.toggle('open-up', openUp);

        const maxForDirection = Math.max(120, Math.min(desiredMax, openUp ? spaceAbove : spaceBelow));
        this.dropdown.style.maxHeight = maxForDirection + 'px';

        const inMobileContext = !!(this.container.closest('.mobile-topbar') || this.container.closest('.mobile-footer'));
        const triggerIsNarrow = triggerRect.width < 160;
        if (inMobileContext && triggerIsNarrow) {
            const viewportW = window.innerWidth;
            const margin = 12;
            const minW = 220;
            const maxW = Math.max(minW, Math.min(360, viewportW - margin * 2));
            const desiredW = Math.min(maxW, Math.max(minW, triggerRect.width));
            let leftDesired = triggerRect.left + (triggerRect.width / 2) - (desiredW / 2);
            leftDesired = Math.max(margin, Math.min(leftDesired, viewportW - margin - desiredW));
            const leftOffset = leftDesired - containerRect.left;
            this.dropdown.style.width = desiredW + 'px';
            this.dropdown.style.left = leftOffset + 'px';
            this.dropdown.style.right = 'auto';
        } else {
            this.dropdown.style.width = '';
            this.dropdown.style.left = '';
            this.dropdown.style.right = '';
        }
    }
}

CustomSelect.prototype.getPriorityColor = function(value) {
    const map = { high: '#ef4444', medium: '#f59e0b', low: '#10b981' };
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
            select._customSelect.refresh();
        }
    });
}

document.addEventListener('DOMContentLoaded', () => {
    setTimeout(initCustomSelects, 100);
});

const originalOpenTaskModal = openTaskModal;
window.openTaskModal = function() {
    originalOpenTaskModal();
    setTimeout(initCustomSelects, 50);
};

// Expose close functions for inline onclick handlers
window.closeTaskModal = closeTaskModal;
window.closeTaskDetailsModal = closeTaskDetailsModal;
window.closeConfirmModal = closeConfirmModal;
window.closeUserSettings = closeUserSettings;
window.closeProjectModal = closeProjectModal;
window.closeProjectSettingsModal = closeProjectSettingsModal;
window.closeDeleteModal = closeDeleteModal;

// Expose open/action functions
window.openUserSettings = openUserSettings;
window.logout = logout;
window.switchView = switchView;
window.switchToProject = switchToProject;
window.switchProjectSettingsTab = switchProjectSettingsTab;
window.editTaskFromDetails = editTaskFromDetails;
window.deleteTaskFromDetails = deleteTaskFromDetails;
window.markTaskDoneFromDetails = markTaskDoneFromDetails;
window.markTaskDoneFromEdit = markTaskDoneFromEdit;
window.quickCompleteTask = quickCompleteTask;
window.showStatusDropdown = showStatusDropdown;
window.setTaskStatus = setTaskStatus;
window.viewTaskDetails = viewTaskDetails;
window.deleteCurrentProject = deleteCurrentProject;
window.editProjectFromSettings = editProjectFromSettings;
window.addMember = addMember;
window.removeMember = removeMember;
window.leaveProject = leaveProject;
window._doLeaveProject = _doLeaveProject;
window._doDeleteProject = _doDeleteProject;
window.confirmDelete = confirmDelete;
window.openProjectDeleteModal = openProjectDeleteModal;
window.closeProjectDeleteModal = closeProjectDeleteModal;
window.confirmDeleteProject = confirmDeleteProject;

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
