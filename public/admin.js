// Admin Panel - User Invitation Management

// Configuration
const ADMIN_EMAIL = 'indraneel.kasmalkar@gmail.com';

let invitations = [];
let users = [];
let currentFilter = 'all';
let currentView = 'invitations'; // 'invitations' or 'users'

// Check admin access on load
async function checkAdminAccess() {
    try {
        const response = await fetch('/api/auth/me', { credentials: 'include' });
        if (!response.ok) {
            window.location.href = '/login.html';
            return false;
        }
        const data = await response.json();
        const user = data.user;

        // Check if super admin
        if (!user.email || user.email.toLowerCase() !== ADMIN_EMAIL) {
            alert('Access denied. This page is for administrators only.');
            window.location.href = '/';
            return false;
        }

        // Show admin content only after access is verified
        document.querySelector('.admin-container').style.display = 'block';
        return true;
    } catch (error) {
        console.error('Auth check failed:', error);
        window.location.href = '/login.html';
        return false;
    }
}

// Fetch invitations
async function loadInvitations() {
    try {
        const response = await fetch('/api/admin/invitations', { credentials: 'include' });
        if (!response.ok) throw new Error('Failed to load invitations');

        const data = await response.json();
        invitations = data.invitations;
        renderInvitations();
    } catch (error) {
        console.error('Load invitations error:', error);
        showStatus('Failed to load invitations', 'error');
        document.getElementById('invitationsList').innerHTML = '<div class="error-state">Failed to load invitations</div>';
    }
}

// Render invitations table
function renderInvitations() {
    const container = document.getElementById('invitationsList');

    const filtered = invitations.filter(inv => {
        if (currentFilter === 'all') return true;
        return inv.status === currentFilter;
    });

    if (filtered.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <p>No ${currentFilter === 'all' ? '' : currentFilter} invitations</p>
            </div>
        `;
        return;
    }

    container.innerHTML = filtered.map(inv => `
        <div class="invitation-card ${inv.status}">
            <div class="invitation-info">
                <div class="email">${escapeHtml(inv.email)}</div>
                <div class="meta">
                    <span class="status-badge status-${inv.status}">${inv.status}</span>
                    <span class="date">Invited: ${formatDate(inv.invited_at)}</span>
                    ${inv.joined_at ? `<span class="date">Joined: ${formatDate(inv.joined_at)}</span>` : ''}
                </div>
                ${inv.user_name ? `<div class="user-info">✓ Registered as: ${escapeHtml(inv.user_name)} (@${escapeHtml(inv.username)})</div>` : ''}
            </div>
            <div class="invitation-actions">
                ${inv.status === 'pending' ? `
                    <button class="btn-resend" onclick="resendInvitation('${escapeHtml(inv.email)}')">
                        Resend
                    </button>
                ` : ''}
            </div>
        </div>
    `).join('');
}

// Send invitation
async function sendInvitation(email) {
    const submitBtn = document.getElementById('submitBtn');
    const originalText = submitBtn.textContent;
    submitBtn.disabled = true;
    submitBtn.textContent = 'Sending...';

    try {
        const response = await fetch('/api/admin/invitations', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ email })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Failed to send invitation');
        }

        showStatus(`✉️ Invitation sent to ${email}!`, 'success');
        document.getElementById('inviteForm').reset();
        loadInvitations(); // Refresh list

    } catch (error) {
        showStatus(error.message, 'error');
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = originalText;
    }
}

// Resend invitation
async function resendInvitation(email) {
    try {
        const response = await fetch(`/api/admin/invitations/${encodeURIComponent(email)}/resend`, {
            method: 'POST',
            credentials: 'include'
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Failed to resend invitation');
        }

        showStatus(`✉️ Invitation resent to ${email}!`, 'success');
        loadInvitations();

    } catch (error) {
        showStatus(error.message, 'error');
    }
}

// Status message
function showStatus(message, type) {
    const statusEl = document.getElementById('inviteStatus');
    statusEl.textContent = message;
    statusEl.className = `status-message ${type}`;

    setTimeout(() => {
        statusEl.textContent = '';
        statusEl.className = 'status-message';
    }, 5000);
}

// Format date
function formatDate(isoString) {
    if (!isoString) return '';
    const date = new Date(isoString);
    return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

// Escape HTML to prevent XSS
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ==================== USER MANAGEMENT ====================

// Fetch all users
async function loadUsers() {
    try {
        const response = await fetch('/api/admin/users', { credentials: 'include' });
        if (!response.ok) throw new Error('Failed to load users');

        const data = await response.json();
        users = data.users;
        renderUsers();
    } catch (error) {
        console.error('Load users error:', error);
        showStatus('Failed to load users', 'error');
        document.getElementById('usersList').innerHTML = '<div class="error-state">Failed to load users</div>';
    }
}

// Render users table
function renderUsers() {
    const container = document.getElementById('usersList');

    if (users.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <p>No users found</p>
            </div>
        `;
        return;
    }

    container.innerHTML = users.map(user => `
        <div class="user-card">
            <div class="user-info">
                <div class="user-header">
                    <div class="user-avatar" style="background-color: ${escapeHtml(user.color || '#9333ea')}">
                        ${escapeHtml(user.initials || user.name.substring(0, 2).toUpperCase())}
                    </div>
                    <div class="user-details">
                        <div class="user-name">${escapeHtml(user.name)}</div>
                        <div class="user-username">@${escapeHtml(user.username)}</div>
                        <div class="user-email">${escapeHtml(user.email)}</div>
                    </div>
                </div>
                <div class="user-meta">
                    ${user.is_admin ? '<span class="admin-badge">Admin</span>' : ''}
                    <span class="task-count">${user.task_count || 0} tasks</span>
                    <span class="date">Joined: ${formatDate(user.created_at)}</span>
                </div>
            </div>
            <div class="user-actions">
                ${user.email.toLowerCase() !== ADMIN_EMAIL.toLowerCase() ? `
                    <button class="btn-delete" onclick="confirmDeleteUser('${escapeHtml(user.id)}', '${escapeHtml(user.name)}', '${escapeHtml(user.username)}')">
                        Delete User
                    </button>
                ` : '<span style="color: #888;">Super Admin</span>'}
            </div>
        </div>
    `).join('');
}

// Confirm and delete user
async function confirmDeleteUser(userId, name, username) {
    const confirmed = confirm(
        `Are you sure you want to delete user "${name}" (@${username})?\n\n` +
        `This will:\n` +
        `- Delete the user account\n` +
        `- Unassign all their tasks\n` +
        `- Delete their personal project folder and all tasks in it\n\n` +
        `This action CANNOT be undone!`
    );

    if (!confirmed) return;

    try {
        const response = await fetch(`/api/admin/users/${userId}`, {
            method: 'DELETE',
            credentials: 'include'
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Failed to delete user');
        }

        showStatus(`✓ User "${name}" has been deleted successfully`, 'success');
        loadUsers(); // Refresh list
        loadInvitations(); // Also refresh invitations in case user was linked

    } catch (error) {
        showStatus(error.message, 'error');
    }
}

// Switch between views
function switchView(view) {
    currentView = view;

    // Update view buttons
    document.querySelectorAll('.view-tab').forEach(tab => {
        tab.classList.toggle('active', tab.dataset.view === view);
    });

    // Show/hide sections
    document.getElementById('invitationsSection').style.display = view === 'invitations' ? 'block' : 'none';
    document.getElementById('usersSection').style.display = view === 'users' ? 'block' : 'none';

    // Load data if needed
    if (view === 'users' && users.length === 0) {
        loadUsers();
    }
}

// Event listeners
document.addEventListener('DOMContentLoaded', async () => {
    const hasAccess = await checkAdminAccess();
    if (!hasAccess) return;

    loadInvitations();

    // Form submission
    document.getElementById('inviteForm').addEventListener('submit', (e) => {
        e.preventDefault();
        const email = document.getElementById('email').value.trim();
        if (email) {
            sendInvitation(email);
        }
    });

    // Filter tabs
    document.querySelectorAll('.filter-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            currentFilter = tab.dataset.filter;
            renderInvitations();
        });
    });
});
