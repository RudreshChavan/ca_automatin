/**
 * Workspace Module — Admin-Controlled Document Hub
 * Frontend logic for creating, managing, editing, and sharing workspace documents.
 */

// ══════════════════════════════════════════════════════════════
// STATE
// ══════════════════════════════════════════════════════════════

let wsDocuments = [];
let wsCurrentView = 'all';
let wsEditDocId = null;
let wsShareDocId = null;
let wsDeleteDocId = null;
let wsSearchTimeout = null;

// ══════════════════════════════════════════════════════════════
// INITIALIZATION
// ══════════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', () => {
    // Auth guard — admin only
    if (!isAuthenticated()) {
        window.location.href = '/';
        return;
    }
    if (!isAdmin()) {
        window.location.href = '/dashboard';
        return;
    }

    // Display user email
    const user = getStoredUser();
    if (user) {
        const el = document.getElementById('ws-user-email');
        if (el) el.textContent = user.email || 'Admin';
    }

    // Setup drag-and-drop on upload zone
    setupDragDrop();

    // Initial data load
    loadDocuments();
    loadStats();
});

// ══════════════════════════════════════════════════════════════
// SIDEBAR NAVIGATION
// ══════════════════════════════════════════════════════════════

function switchWsView(view, btn) {
    wsCurrentView = view;

    // Update active state in sidebar
    document.querySelectorAll('.workspace-sidebar .sidebar-item').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');

    // Update page title
    const titles = { all: 'All Documents', drafts: 'Drafts', published: 'Published' };
    document.getElementById('ws-page-title').textContent = titles[view] || 'All Documents';

    // Apply status filter
    const filterEl = document.getElementById('ws-status-filter');
    if (view === 'drafts') {
        filterEl.value = 'draft';
    } else if (view === 'published') {
        filterEl.value = 'published';
    } else {
        filterEl.value = '';
    }

    loadDocuments();

    // Close mobile sidebar
    closeMobileSidebar();
}

function toggleWsSidebar() {
    const sidebar = document.getElementById('ws-sidebar');
    const overlay = document.getElementById('ws-sidebar-overlay');
    sidebar.classList.toggle('open');
    overlay.classList.toggle('visible');
}

function closeMobileSidebar() {
    document.getElementById('ws-sidebar').classList.remove('open');
    document.getElementById('ws-sidebar-overlay').classList.remove('visible');
}

// ══════════════════════════════════════════════════════════════
// DATA LOADING
// ══════════════════════════════════════════════════════════════

async function loadDocuments() {
    const status = document.getElementById('ws-status-filter').value;
    const search = document.getElementById('ws-search').value.trim();

    let url = '/workspace/documents?';
    if (status) url += `status=${encodeURIComponent(status)}&`;
    if (search) url += `search=${encodeURIComponent(search)}&`;

    try {
        const res = await apiFetch(url);
        const data = await res.json();
        if (res.ok) {
            wsDocuments = data.documents || [];
            renderDocumentGrid();
        } else {
            showToast(data.error || 'Failed to load documents', 'error');
        }
    } catch (e) {
        console.error('[Workspace] Load error:', e);
        showToast('Failed to connect to server', 'error');
    }
}

async function loadStats() {
    try {
        const res = await apiFetch('/workspace/stats');
        const data = await res.json();
        if (res.ok) {
            const s = data.stats;
            document.getElementById('ws-stat-total').textContent = s.total_documents;
            document.getElementById('ws-stat-drafts').textContent = s.draft_count;
            document.getElementById('ws-stat-published').textContent = s.published_count;
            document.getElementById('ws-stat-shares').textContent = s.total_shares;
            document.getElementById('ws-stat-size').textContent = formatFileSize(s.total_size);

            // Sidebar badges
            document.getElementById('ws-badge-all').textContent = s.total_documents;
            document.getElementById('ws-badge-drafts').textContent = s.draft_count;
            document.getElementById('ws-badge-published').textContent = s.published_count;
        }
    } catch (e) {
        console.error('[Workspace] Stats error:', e);
    }
}

// ══════════════════════════════════════════════════════════════
// RENDER DOCUMENT GRID
// ══════════════════════════════════════════════════════════════

function renderDocumentGrid() {
    const grid = document.getElementById('ws-doc-grid');
    const empty = document.getElementById('ws-empty-state');

    if (wsDocuments.length === 0) {
        grid.innerHTML = '';
        empty.style.display = 'flex';
        return;
    }

    empty.style.display = 'none';

    grid.innerHTML = wsDocuments.map(doc => {
        const statusClass = doc.status === 'published' ? 'published' : 'draft';
        const statusLabel = doc.status === 'published' ? '✅ Published' : '📝 Draft';
        const desc = doc.description || 'No description';
        const icon = doc.file_name.toLowerCase().endsWith('.docx') ? '📄' : '📃';
        const shareInfo = doc.share_count > 0 ? `🔗 ${doc.share_count} share${doc.share_count > 1 ? 's' : ''}` : '';

        return `
            <div class="ws-doc-card" id="ws-doc-${doc.id}">
                <div class="ws-doc-card-header">
                    <div class="ws-doc-icon">${icon}</div>
                    <div class="ws-doc-title-area">
                        <h4 class="ws-doc-title" title="${escapeHtml(doc.title)}">${escapeHtml(doc.title)}</h4>
                        <div class="ws-doc-filename">${escapeHtml(doc.file_name)}</div>
                    </div>
                    <span class="ws-status-badge ${statusClass}">${statusLabel}</span>
                </div>
                <div class="ws-doc-card-body">
                    <div class="ws-doc-description">${escapeHtml(desc)}</div>
                    <div class="ws-doc-meta">
                        <div class="ws-doc-meta-item">
                            <span class="meta-icon">💾</span>
                            <span>${formatFileSize(doc.file_size)}</span>
                        </div>
                        <div class="ws-doc-meta-item">
                            <span class="meta-icon">📅</span>
                            <span>${formatDate(doc.updated_at)}</span>
                        </div>
                        <div class="ws-doc-meta-item">
                            <span class="meta-icon">🔄</span>
                            <span>v${doc.version}</span>
                        </div>
                        ${shareInfo ? `<div class="ws-doc-meta-item"><span>${shareInfo}</span></div>` : ''}
                    </div>
                </div>
                <div class="ws-doc-card-footer">
                    <div class="ws-doc-actions">
                        <button class="btn btn-ghost btn-sm" onclick="openDocumentEditor(${doc.id})" title="Edit content">✏️ Edit</button>
                        <button class="btn btn-ghost btn-sm" onclick="showEditInfoModal(${doc.id})" title="Edit info">ℹ️</button>
                        <button class="btn btn-ghost btn-sm" onclick="showShareDocModal(${doc.id})" title="Share">🔗</button>
                    </div>
                    <button class="btn btn-ghost btn-sm" onclick="showDeleteDocModal(${doc.id})" title="Delete" style="color: var(--error-400);">🗑</button>
                </div>
            </div>
        `;
    }).join('');
}

// ══════════════════════════════════════════════════════════════
// SEARCH
// ══════════════════════════════════════════════════════════════

function handleWsSearch() {
    clearTimeout(wsSearchTimeout);
    wsSearchTimeout = setTimeout(() => loadDocuments(), 350);
}

// ══════════════════════════════════════════════════════════════
// CREATE DOCUMENT
// ══════════════════════════════════════════════════════════════

function showCreateModal() {
    document.getElementById('create-doc-form').reset();
    document.getElementById('create-doc-modal').classList.add('active');
}

function closeCreateModal() {
    document.getElementById('create-doc-modal').classList.remove('active');
}

async function handleCreateDocument(e) {
    e.preventDefault();

    const title = document.getElementById('new-doc-title').value.trim();
    const description = document.getElementById('new-doc-description').value.trim();
    const status = document.getElementById('new-doc-status').value;

    if (!title) return;

    const btn = document.getElementById('create-doc-btn');
    btn.disabled = true;
    btn.textContent = 'Creating...';

    try {
        const res = await apiFetch('/workspace/documents', {
            method: 'POST',
            body: JSON.stringify({ title, description, status }),
        });
        const data = await res.json();

        if (res.ok) {
            showToast('Document created successfully!', 'success');
            closeCreateModal();
            loadDocuments();
            loadStats();
        } else {
            showToast(data.error || 'Failed to create document', 'error');
        }
    } catch (e) {
        showToast('Connection error', 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Create Document';
    }
}

// ══════════════════════════════════════════════════════════════
// UPLOAD DOCUMENT
// ══════════════════════════════════════════════════════════════

let uploadSelectedFile = null;

function showUploadModal() {
    document.getElementById('upload-doc-form').reset();
    uploadSelectedFile = null;
    document.getElementById('upload-file-info').classList.remove('visible');
    document.getElementById('upload-doc-btn').disabled = true;
    document.getElementById('upload-doc-modal').classList.add('active');
}

function closeUploadModal() {
    document.getElementById('upload-doc-modal').classList.remove('active');
    uploadSelectedFile = null;
}

function setupDragDrop() {
    const zone = document.getElementById('upload-zone');
    if (!zone) return;

    zone.addEventListener('dragover', (e) => {
        e.preventDefault();
        zone.classList.add('dragover');
    });

    zone.addEventListener('dragleave', () => {
        zone.classList.remove('dragover');
    });

    zone.addEventListener('drop', (e) => {
        e.preventDefault();
        zone.classList.remove('dragover');
        const files = e.dataTransfer.files;
        if (files.length > 0) {
            processSelectedFile(files[0]);
        }
    });
}

function handleFileSelect(e) {
    const file = e.target.files[0];
    if (file) processSelectedFile(file);
}

function processSelectedFile(file) {
    const name = file.name.toLowerCase();
    if (!name.endsWith('.doc') && !name.endsWith('.docx')) {
        showToast('Only .doc and .docx files are supported', 'error');
        return;
    }

    uploadSelectedFile = file;
    const info = document.getElementById('upload-file-info');
    info.textContent = `📎 ${file.name} (${formatFileSize(file.size)})`;
    info.classList.add('visible');
    document.getElementById('upload-doc-btn').disabled = false;
}

async function handleUploadDocument(e) {
    e.preventDefault();

    if (!uploadSelectedFile) {
        showToast('Please select a file first', 'error');
        return;
    }

    const btn = document.getElementById('upload-doc-btn');
    btn.disabled = true;
    btn.textContent = 'Uploading...';

    const formData = new FormData();
    formData.append('file', uploadSelectedFile);

    const title = document.getElementById('upload-doc-title').value.trim();
    const description = document.getElementById('upload-doc-description').value.trim();
    if (title) formData.append('title', title);
    if (description) formData.append('description', description);

    try {
        const res = await apiFetch('/workspace/documents/upload', {
            method: 'POST',
            body: formData,
            headers: {},  // Let browser set multipart boundary
        });
        const data = await res.json();

        if (res.ok) {
            showToast('Document uploaded successfully!', 'success');
            closeUploadModal();
            loadDocuments();
            loadStats();
        } else {
            showToast(data.error || 'Upload failed', 'error');
        }
    } catch (e) {
        showToast('Connection error', 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Upload Document';
    }
}

// ══════════════════════════════════════════════════════════════
// EDIT DOCUMENT INFO
// ══════════════════════════════════════════════════════════════

function showEditInfoModal(docId) {
    const doc = wsDocuments.find(d => d.id === docId);
    if (!doc) return;

    wsEditDocId = docId;
    document.getElementById('edit-doc-title').value = doc.title;
    document.getElementById('edit-doc-description').value = doc.description || '';
    document.getElementById('edit-doc-status').value = doc.status;
    document.getElementById('edit-doc-modal').classList.add('active');
}

function closeEditModal() {
    document.getElementById('edit-doc-modal').classList.remove('active');
    wsEditDocId = null;
}

async function handleEditDocument(e) {
    e.preventDefault();

    if (!wsEditDocId) return;

    const title = document.getElementById('edit-doc-title').value.trim();
    const description = document.getElementById('edit-doc-description').value.trim();
    const status = document.getElementById('edit-doc-status').value;

    try {
        const res = await apiFetch(`/workspace/documents/${wsEditDocId}`, {
            method: 'PUT',
            body: JSON.stringify({ title, description, status }),
        });
        const data = await res.json();

        if (res.ok) {
            showToast('Document updated', 'success');
            closeEditModal();
            loadDocuments();
            loadStats();
        } else {
            showToast(data.error || 'Update failed', 'error');
        }
    } catch (e) {
        showToast('Connection error', 'error');
    }
}

// ══════════════════════════════════════════════════════════════
// OPEN DOCUMENT IN EDITOR
// ══════════════════════════════════════════════════════════════

function openDocumentEditor(docId) {
    const doc = wsDocuments.find(d => d.id === docId);
    if (!doc) return;

    // Open in viewer page with workspace mode
    const token = localStorage.getItem('dam_token');
    const params = new URLSearchParams({
        workspace_doc_id: docId,
        mode: 'edit',
        token: token,
    });
    window.open(`/viewer?${params.toString()}`, '_blank');
}

// ══════════════════════════════════════════════════════════════
// SHARE DOCUMENT
// ══════════════════════════════════════════════════════════════

function showShareDocModal(docId) {
    const doc = wsDocuments.find(d => d.id === docId);
    if (!doc) return;

    wsShareDocId = docId;
    document.getElementById('share-modal-doc-title').textContent = `Share "${doc.title}" with clients or employees.`;

    // Load shareable users
    loadShareableUsers();

    // Load existing shares for this document
    loadDocShares(docId);

    document.getElementById('share-doc-modal').classList.add('active');
}

function closeShareModal() {
    document.getElementById('share-doc-modal').classList.remove('active');
    wsShareDocId = null;
}

async function loadShareableUsers() {
    try {
        const res = await apiFetch('/workspace/users');
        const data = await res.json();
        if (res.ok) {
            const select = document.getElementById('ws-share-user-select');
            select.innerHTML = '<option value="">Select a user...</option>';
            (data.users || []).forEach(u => {
                const label = u.name ? `${u.name} (${u.email})` : u.email;
                const roleTag = u.role === 'employee' ? ' [Employee]' : '';
                select.innerHTML += `<option value="${u.id}">${escapeHtml(label)}${roleTag}</option>`;
            });
        }
    } catch (e) {
        console.error('[Workspace] Failed to load users:', e);
    }
}

async function loadDocShares(docId) {
    try {
        const res = await apiFetch(`/workspace/documents/${docId}/shares`);
        const data = await res.json();
        if (res.ok) {
            const shares = data.shares || [];
            const container = document.getElementById('ws-active-shares');
            const list = document.getElementById('ws-shares-list');

            if (shares.length === 0) {
                container.style.display = 'none';
                return;
            }

            container.style.display = 'block';
            list.innerHTML = shares.map(s => {
                const initials = (s.user_name || s.user_email || '?').substring(0, 2).toUpperCase();
                const displayName = s.user_name || s.user_email;
                const permLabel = s.permission === 'download' ? '⬇️ Download' : '👁 View';

                return `
                    <div class="ws-share-item">
                        <div class="share-user">
                            <div class="share-avatar">${initials}</div>
                            <div class="share-details">
                                ${escapeHtml(displayName)}<br>
                                <span>${escapeHtml(s.user_email)}</span>
                            </div>
                        </div>
                        <span class="share-perm">${permLabel}</span>
                        <button class="btn-revoke" onclick="revokeDocShare(${s.id})">Revoke</button>
                    </div>
                `;
            }).join('');
        }
    } catch (e) {
        console.error('[Workspace] Failed to load shares:', e);
    }
}

async function handleShareDocument(e) {
    e.preventDefault();

    if (!wsShareDocId) return;

    const userId = document.getElementById('ws-share-user-select').value;
    if (!userId) {
        showToast('Please select a user', 'error');
        return;
    }

    const permission = document.querySelector('input[name="ws-share-perm"]:checked').value;

    const btn = document.getElementById('share-doc-btn');
    btn.disabled = true;
    btn.textContent = 'Sharing...';

    try {
        const res = await apiFetch(`/workspace/documents/${wsShareDocId}/share`, {
            method: 'POST',
            body: JSON.stringify({
                shared_with_user_id: parseInt(userId),
                permission: permission,
            }),
        });
        const data = await res.json();

        if (res.ok) {
            showToast('Document shared!', 'success');
            loadDocShares(wsShareDocId);
            loadDocuments();
            loadStats();
            document.getElementById('ws-share-user-select').value = '';
        } else {
            showToast(data.error || 'Share failed', 'error');
        }
    } catch (e) {
        showToast('Connection error', 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Share';
    }
}

async function revokeDocShare(shareId) {
    try {
        const res = await apiFetch(`/workspace/shares/${shareId}`, { method: 'DELETE' });
        if (res.ok) {
            showToast('Share revoked', 'success');
            if (wsShareDocId) loadDocShares(wsShareDocId);
            loadDocuments();
            loadStats();
        } else {
            const data = await res.json();
            showToast(data.error || 'Failed to revoke', 'error');
        }
    } catch (e) {
        showToast('Connection error', 'error');
    }
}

// ══════════════════════════════════════════════════════════════
// DELETE DOCUMENT
// ══════════════════════════════════════════════════════════════

function showDeleteDocModal(docId) {
    const doc = wsDocuments.find(d => d.id === docId);
    if (!doc) return;

    wsDeleteDocId = docId;
    document.getElementById('delete-doc-message').textContent =
        `Are you sure you want to delete "${doc.title}"? This will permanently remove the document and revoke all shares.`;
    document.getElementById('delete-doc-modal').classList.add('active');
}

function closeDeleteModal() {
    document.getElementById('delete-doc-modal').classList.remove('active');
    wsDeleteDocId = null;
}

async function confirmDeleteDocument() {
    if (!wsDeleteDocId) return;

    try {
        const res = await apiFetch(`/workspace/documents/${wsDeleteDocId}`, { method: 'DELETE' });
        if (res.ok) {
            showToast('Document deleted', 'success');
            closeDeleteModal();
            loadDocuments();
            loadStats();
        } else {
            const data = await res.json();
            showToast(data.error || 'Delete failed', 'error');
        }
    } catch (e) {
        showToast('Connection error', 'error');
    }
}

// ══════════════════════════════════════════════════════════════
// TOAST NOTIFICATIONS
// ══════════════════════════════════════════════════════════════

function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    const icons = { success: '✅', error: '❌', info: 'ℹ️', warning: '⚠️' };
    toast.innerHTML = `<span>${icons[type] || ''}</span> ${escapeHtml(message)}`;
    container.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(100%)';
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

// ══════════════════════════════════════════════════════════════
// AUTH
// ══════════════════════════════════════════════════════════════

function logout() {
    localStorage.removeItem('dam_token');
    localStorage.removeItem('dam_user');
    window.location.href = '/';
}
