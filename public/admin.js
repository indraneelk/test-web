// Admin Panel — rewritten to use Supabase directly + Edge Functions
// All user data is passed through escapeHtml() before innerHTML insertion (XSS-safe)

const SUPABASE_FUNCTIONS_URL = 'https://tfltkqgxxceykzbjuziv.supabase.co/functions/v1';

let invitations = [];
let users = [];
let currentFilter = 'all';
let currentView = 'invitations';
let supaClient = null;
let currentAdminId = null;

function getClient() {
    if (!supaClient) supaClient = window.getSupabaseClient();
    return supaClient;
}

async function getFreshJwt() {
    const { data: { session } } = await getClient().auth.getSession();
    return session?.access_token || null;
}

// ── Auth & admin check ──────────────────────────────────────────────────────

async function checkAdminAccess() {
    try {
        const client = getClient();
        const { data: { session }, error: sessionError } = await client.auth.getSession();

        if (sessionError || !session) {
            window.location.href = '/login.html';
            return false;
        }

        currentAdminId = session.user.id;

        const { data: profile, error: profileError } = await client
            .from('profiles')
            .select('is_admin, name')
            .eq('id', session.user.id)
            .single();

        if (profileError || !profile?.is_admin) {
            window.location.href = '/';
            return false;
        }

        document.querySelector('.admin-container').style.display = 'block';
        return true;
    } catch (err) {
        console.error('Admin access check failed:', err);
        window.location.href = '/login.html';
        return false;
    }
}

// ── Invitations ─────────────────────────────────────────────────────────────

async function loadInvitations() {
    try {
        const client = getClient();
        const { data, error } = await client
            .from('invitations')
            .select('id, email, status, created_at, joined_at')
            .order('created_at', { ascending: false });

        if (error) throw new Error(error.message);

        invitations = data || [];
        renderInvitations();
    } catch (err) {
        console.error('Load invitations error:', err);
        document.getElementById('invitationsList').textContent = 'Failed to load invitations: ' + err.message;
    }
}

function renderInvitations() {
    const container = document.getElementById('invitationsList');
    const filtered = invitations.filter(inv =>
        currentFilter === 'all' || inv.status === currentFilter
    );

    if (filtered.length === 0) {
        container.innerHTML = '<div class="empty-state"><p>No ' +
            escapeHtml(currentFilter === 'all' ? '' : currentFilter) + ' invitations</p></div>';
        return;
    }

    container.innerHTML = filtered.map(inv =>
        '<div class="invitation-card ' + escapeHtml(inv.status) + '">' +
            '<div class="invitation-info">' +
                '<div class="email">' + escapeHtml(inv.email) + '</div>' +
                '<div class="meta">' +
                    '<span class="status-badge status-' + escapeHtml(inv.status) + '">' + escapeHtml(inv.status) + '</span>' +
                    '<span class="date">Invited: ' + escapeHtml(formatDate(inv.created_at)) + '</span>' +
                    (inv.joined_at ? '<span class="date">Joined: ' + escapeHtml(formatDate(inv.joined_at)) + '</span>' : '') +
                '</div>' +
            '</div>' +
            '<div class="invitation-actions">' +
                (inv.status === 'pending'
                    ? '<button class="btn-resend" data-email="' + escapeHtml(inv.email) + '">Resend</button>'
                    : '') +
            '</div>' +
        '</div>'
    ).join('');
}

async function sendInvitation(email) {
    const submitBtn = document.getElementById('submitBtn');
    const original = submitBtn.textContent;
    submitBtn.disabled = true;
    submitBtn.textContent = 'Sending...';

    try {
        const jwt = await getFreshJwt();
        const res = await fetch(SUPABASE_FUNCTIONS_URL + '/admin-invite', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + jwt
            },
            body: JSON.stringify({ email })
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to send invitation');

        showStatus('Invitation sent to ' + email + '!', 'success');
        document.getElementById('inviteForm').reset();
        loadInvitations();
    } catch (err) {
        showStatus(err.message, 'error');
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = original;
    }
}

async function resendInvitation(email) {
    try {
        const jwt = await getFreshJwt();
        const res = await fetch(SUPABASE_FUNCTIONS_URL + '/admin-invite', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + jwt
            },
            body: JSON.stringify({ email })
        });

        const data = await res.json();
        if (!res.ok) {
            showStatus(data.error || 'Failed to resend', 'error');
        } else {
            showStatus('Invitation resent to ' + email + '!', 'success');
            loadInvitations();
        }
    } catch (err) {
        showStatus(err.message || 'Failed to resend', 'error');
    }
}

// ── Users ────────────────────────────────────────────────────────────────────

async function loadUsers() {
    try {
        const client = getClient();
        const { data, error } = await client
            .from('profiles')
            .select('id, name, username, email, color, is_admin, created_at')
            .order('created_at', { ascending: true });

        if (error) throw new Error(error.message);

        users = data || [];
        renderUsers();
    } catch (err) {
        console.error('Load users error:', err);
        document.getElementById('usersList').textContent = 'Failed to load users: ' + err.message;
    }
}

function renderUsers() {
    const container = document.getElementById('usersList');

    if (users.length === 0) {
        container.innerHTML = '<div class="empty-state"><p>No users found</p></div>';
        return;
    }

    container.innerHTML = users.map(function(user) {
        var initials = (user.name || user.username || '?')
            .split(/\s+/).map(function(w) { return w[0]; }).slice(0, 2).join('').toUpperCase();
        return '<div class="user-card">' +
            '<div class="user-info">' +
                '<div class="user-header">' +
                    '<div class="user-avatar" style="background-color:' + escapeHtml(user.color || '#6366f1') + '">' +
                        escapeHtml(initials) +
                    '</div>' +
                    '<div class="user-details">' +
                        '<div class="user-name">' + escapeHtml(user.name || '—') + '</div>' +
                        (user.username ? '<div class="user-username">@' + escapeHtml(user.username) + '</div>' : '') +
                        '<div class="user-email">' + escapeHtml(user.email || '—') + '</div>' +
                    '</div>' +
                '</div>' +
                '<div class="user-meta">' +
                    (user.is_admin ? '<span class="admin-badge">Admin</span>' : '') +
                    '<span class="date">Joined: ' + escapeHtml(formatDate(user.created_at)) + '</span>' +
                '</div>' +
            '</div>' +
            '<div class="user-actions">' +
                (user.id === currentAdminId
                    ? '<span style="color:#888;font-size:0.875rem;">You</span>'
                    : user.is_admin
                        ? '<span style="color:#888;font-size:0.875rem;">Admin</span>'
                        : '<button class="btn-delete" data-user-id="' + escapeHtml(user.id) + '" data-user-name="' + escapeHtml(user.name || user.email) + '">Remove</button>') +
            '</div>' +
        '</div>';
    }).join('');
}

function confirmDeleteUser(userId, name) {
    showConfirmModal(
        'Remove user',
        'Remove "' + name + '"? This deletes their account, unassigns their tasks, and removes their personal project. Cannot be undone.',
        function() { deleteUser(userId, name); }
    );
}

async function deleteUser(userId, name) {
    try {
        const jwt = await getFreshJwt();
        const res = await fetch(SUPABASE_FUNCTIONS_URL + '/admin-delete-user', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + jwt
            },
            body: JSON.stringify({ userId: userId })
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to remove user');

        showStatus('"' + name + '" has been removed', 'success');
        loadUsers();
        loadInvitations();
    } catch (err) {
        showStatus(err.message, 'error');
    }
}

// ── Confirmation modal ────────────────────────────────────────────────────────

function showConfirmModal(title, message, onConfirm) {
    document.getElementById('confirmModalTitle').textContent = title;
    document.getElementById('confirmModalMessage').textContent = message;
    var okBtn = document.getElementById('confirmModalOkBtn');
    var fresh = okBtn.cloneNode(true);
    okBtn.parentNode.replaceChild(fresh, okBtn);
    fresh.addEventListener('click', function() {
        closeConfirmModal();
        onConfirm();
    });
    document.getElementById('confirmModal').style.display = 'flex';
}

function closeConfirmModal() {
    document.getElementById('confirmModal').style.display = 'none';
}

// ── View switching ───────────────────────────────────────────────────────────

function switchView(view) {
    currentView = view;
    document.querySelectorAll('.view-tab').forEach(function(tab) {
        tab.classList.toggle('active', tab.dataset.view === view);
    });
    document.getElementById('invitationsSection').style.display =
        view === 'invitations' ? 'block' : 'none';
    document.getElementById('usersSection').style.display =
        view === 'users' ? 'block' : 'none';

    if (view === 'users' && users.length === 0) loadUsers();
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function showStatus(message, type) {
    var el = document.getElementById('inviteStatus');
    el.textContent = message;
    el.className = 'status-message ' + type;
    setTimeout(function() { el.textContent = ''; el.className = 'status-message'; }, 5000);
}

function formatDate(iso) {
    if (!iso) return '';
    return new Date(iso).toLocaleDateString('en-US', {
        year: 'numeric', month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit'
    });
}

function escapeHtml(text) {
    if (text === null || text === undefined) return '';
    var div = document.createElement('div');
    div.textContent = String(text);
    return div.innerHTML;
}

// ── Boot ─────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async function() {
    var ok = await checkAdminAccess();
    if (!ok) return;

    loadInvitations();

    document.getElementById('invitationsList').addEventListener('click', function(e) {
        var btn = e.target.closest('.btn-resend');
        if (btn) resendInvitation(btn.dataset.email);
    });

    document.getElementById('usersList').addEventListener('click', function(e) {
        var btn = e.target.closest('.btn-delete');
        if (btn) confirmDeleteUser(btn.dataset.userId, btn.dataset.userName);
    });

    document.getElementById('inviteForm').addEventListener('submit', function(e) {
        e.preventDefault();
        var email = document.getElementById('email').value.trim();
        if (email) sendInvitation(email);
    });

    document.querySelectorAll('.filter-tab').forEach(function(tab) {
        tab.addEventListener('click', function() {
            document.querySelectorAll('.filter-tab').forEach(function(t) {
                t.classList.remove('active');
            });
            tab.classList.add('active');
            currentFilter = tab.dataset.filter;
            renderInvitations();
        });
    });
});
