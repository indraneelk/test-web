// Admin Panel - User Invitation Management

let invitations = [];
let currentFilter = 'all';

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
        if (!user.email || user.email.toLowerCase() !== 'indraneel.kasmalkar@gmail.com') {
            alert('Access denied. This page is for administrators only.');
            window.location.href = '/';
            return false;
        }

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
