/**
 * DAM — Dashboard logic.
 * Handles stats, folders, file uploads, folder-grouped file view,
 * file detail modal, search, tasks, notifications, and toasts.
 */

// ── Auth Guard ──
if (!isAuthenticated()) {
    window.location.href = '/';
}

// ── State ──
let currentFolderId = null;
let allFolders = [];
let allFiles = [];           // cached for grouping
let searchTimeout = null;
let deleteTargetId = null;
let notifDropdownOpen = false;
let notifPollInterval = null;
let selectedFileDetail = null; // for detail modal

// ── Initialize ──
document.addEventListener('DOMContentLoaded', () => {
    loadUserInfo();
    loadDashboard();
    loadFolders();
    loadFiles();
    loadTasks();
    loadUserPayments();
    loadUserBilling();
    setupDragDrop();
    loadNotifications();
    startNotificationPolling();
    loadSharedFiles();
    loadWorkspaceSharedDocs();

    // Close notification dropdown when clicking outside
    document.addEventListener('click', (e) => {
        const bell = document.getElementById('notif-bell');
        const dropdown = document.getElementById('notif-dropdown');
        if (notifDropdownOpen && !bell.contains(e.target) && !dropdown.contains(e.target)) {
            dropdown.classList.remove('visible');
            notifDropdownOpen = false;
        }
    });
});

// ══════════════════════════════════════════════════════════════
// USER INFO
// ══════════════════════════════════════════════════════════════

function loadUserInfo() {
    const user = getStoredUser();
    if (user) {
        const email = user.email || 'user@email.com';
        document.getElementById('user-email').textContent = email;
        document.getElementById('user-name').textContent = user.name || email.split('@')[0];
        document.getElementById('user-avatar').textContent = email.charAt(0).toUpperCase();

        // Show admin link if user is admin, and hide upload section
        if (user.role === 'admin') {
            const adminLink = document.getElementById('admin-link');
            if (adminLink) adminLink.style.display = 'block';

            const uploadSection = document.getElementById('upload-section');
            if (uploadSection) uploadSection.style.display = 'none';
        }
    }
}

function logout() {
    localStorage.removeItem('dam_token');
    localStorage.removeItem('dam_user');
    window.location.href = '/';
}

// ══════════════════════════════════════════════════════════════
// NOTIFICATIONS
// ══════════════════════════════════════════════════════════════

function toggleNotificationDropdown() {
    const dropdown = document.getElementById('notif-dropdown');
    notifDropdownOpen = !notifDropdownOpen;
    if (notifDropdownOpen) {
        dropdown.classList.add('visible');
        loadNotifications();
    } else {
        dropdown.classList.remove('visible');
    }
}

async function loadNotifications() {
    try {
        const [notifRes, countRes] = await Promise.all([
            apiFetch('/notifications?limit=20'),
            apiFetch('/notifications/unread-count'),
        ]);

        const notifData = await notifRes.json();
        const countData = await countRes.json();
        const notifications = notifData.notifications || [];
        const unreadCount = countData.count || 0;

        // Update badge
        const badge = document.getElementById('notif-badge-count');
        if (unreadCount > 0) {
            badge.textContent = unreadCount > 99 ? '99+' : unreadCount;
            badge.classList.remove('hidden');
        } else {
            badge.classList.add('hidden');
        }

        // Render notifications
        const list = document.getElementById('notif-list');
        if (notifications.length === 0) {
            list.innerHTML = '<div class="notif-empty">No notifications yet 🎉</div>';
            return;
        }

        const NOTIF_ICONS = {
            file_uploaded: '📤',
            file_reviewed: '✅',
            payment_received: '💰',
        };

        list.innerHTML = notifications.map(n => `
            <div class="notif-item ${n.is_read ? '' : 'unread'}" onclick="handleNotifClick(${n.id}, ${n.is_read})">
                <div class="notif-icon ${n.type}">${NOTIF_ICONS[n.type] || '🔔'}</div>
                <div class="notif-content">
                    <div class="notif-title">${escapeHtml(n.title)}</div>
                    <div class="notif-message">${escapeHtml(n.message || '')}</div>
                    <div class="notif-time">${formatDate(n.created_at)}</div>
                </div>
            </div>
        `).join('');

    } catch (err) {
        console.error('Failed to load notifications:', err);
    }
}

async function handleNotifClick(notifId, isRead) {
    if (!isRead) {
        try {
            await apiFetch(`/notifications/${notifId}/read`, { method: 'PUT' });
            loadNotifications();
        } catch (err) {
            console.error('Failed to mark notification as read:', err);
        }
    }
}

async function markAllNotificationsRead() {
    try {
        await apiFetch('/notifications/read-all', { method: 'PUT' });
        loadNotifications();
        showToast('All notifications marked as read', 'success');
    } catch (err) {
        console.error('Failed to mark all as read:', err);
    }
}

function startNotificationPolling() {
    notifPollInterval = setInterval(() => {
        loadNotifications();
    }, 30000);
}

// ══════════════════════════════════════════════════════════════
// DASHBOARD STATS
// ══════════════════════════════════════════════════════════════

async function loadDashboard() {
    try {
        const res = await apiFetch('/dashboard');
        const data = await res.json();

        document.getElementById('stat-total').textContent = data.total_files || 0;
        document.getElementById('badge-all').textContent = data.total_files || 0;

        const filesRes = await apiFetch('/files');
        const filesData = await filesRes.json();
        const files = filesData.files || [];

        const pendingCount = files.filter(f => f.status === 'pending').length;
        const reviewedCount = files.filter(f => f.status === 'reviewed').length;
        const docCount = data.folder_counts?.Documents || 0;

        document.getElementById('stat-pending').textContent = pendingCount;
        document.getElementById('stat-reviewed').textContent = reviewedCount;
        document.getElementById('stat-docs').textContent = docCount;

    } catch (err) {
        console.error('Failed to load dashboard:', err);
    }
}

// ══════════════════════════════════════════════════════════════
// USER TASKS
// ══════════════════════════════════════════════════════════════

async function loadTasks() {
    try {
        const res = await apiFetch('/user/tasks');
        if (!res.ok) return;
        const data = await res.json();
        const tasks = data.tasks || [];

        const container = document.getElementById('tasks-container');
        const badge = document.getElementById('tasks-badge');

        if (!container) return;
        if (badge) badge.textContent = tasks.length;

        if (tasks.length === 0) {
            container.innerHTML = '<div class="empty-state-sm">No tasks assigned at this time. 🎉</div>';
            return;
        }

        container.innerHTML = tasks.map(t => `
            <div class="reminder-card pending">
                <div class="reminder-icon">📝</div>
                <div class="reminder-content">
                    <p class="reminder-msg" style="font-weight: 600;">${escapeHtml(t.title)}</p>
                    ${t.description ? `<p style="font-size: 0.9em; color: var(--text-secondary); margin-top: 4px;">${escapeHtml(t.description)}</p>` : ''}
                    <div class="reminder-meta">
                        <span class="sent-date">Assigned by: ${escapeHtml(t.assigned_by_email)}</span>
                        <span class="sent-date" style="margin-left: 8px;">${formatDate(t.created_at)}</span>
                    </div>
                </div>
                <div class="reminder-actions">
                    <button class="btn btn-primary btn-sm" onclick="markTaskDone(${t.id})">✓ Mark as Done</button>
                </div>
            </div>
        `).join('');

    } catch (err) {
        console.error('Failed to load tasks:', err);
    }
}

async function markTaskDone(id) {
    try {
        const res = await apiFetch(`/user/task/${id}/done`, { method: 'PUT' });
        if (res.ok) {
            showToast('Task marked as done!', 'success');
            loadTasks();
        } else {
            const data = await res.json();
            showToast(data.error || 'Failed to complete task', 'error');
        }
    } catch (err) {
        showToast('Connection error', 'error');
        console.error(err);
    }
}

// ══════════════════════════════════════════════════════════════
// FOLDERS
// ══════════════════════════════════════════════════════════════

const FOLDER_ICONS = {
    'Images': '🖼️',
    'Videos': '🎬',
    'Documents': '📝',
    'Software': '💿',
    'Archives': '🗜️',
    'Audio': '🎵',
    'Others': '📦',
};

async function loadFolders() {
    try {
        const res = await apiFetch('/folders');
        const data = await res.json();
        allFolders = data.folders || [];

        renderFolderSidebar();
        populateFolderSelect();
    } catch (err) {
        console.error('Failed to load folders:', err);
    }
}

function renderFolderSidebar() {
    const container = document.getElementById('folder-list');
    container.innerHTML = allFolders.map(f => `
        <button class="sidebar-item ${currentFolderId === f.id ? 'active' : ''}"
                onclick="filterByFolder(${f.id}, this)">
            <span class="icon">${FOLDER_ICONS[f.name] || '📁'}</span>
            <span>${f.name}</span>
            <span class="badge">${f.file_count}</span>
        </button>
    `).join('');
}

function populateFolderSelect() {
    const sel = document.getElementById('folder-select');
    sel.innerHTML = '<option value="">Auto (detect by type)</option>' +
        allFolders.map(f => `<option value="${f.id}">${f.name}</option>`).join('');
}

function filterByFolder(folderId, el) {
    currentFolderId = folderId;

    // Update active states
    document.querySelectorAll('.sidebar-item').forEach(b => b.classList.remove('active'));
    if (el) el.classList.add('active');

    // Update title
    if (folderId) {
        const folder = allFolders.find(f => f.id === folderId);
        document.getElementById('files-title').textContent = folder ? folder.name : 'Files';
        document.getElementById('page-title').textContent = folder ? folder.name : 'Dashboard';
    } else {
        document.getElementById('files-title').textContent = 'All Files';
        document.getElementById('page-title').textContent = 'Dashboard';
    }

    loadFiles();

    // Close mobile sidebar
    document.getElementById('sidebar').classList.remove('open');
    document.getElementById('sidebar-overlay').classList.remove('visible');
}

// ══════════════════════════════════════════════════════════════
// FILES — Organized by Folder with status + file detail modal
// ══════════════════════════════════════════════════════════════

async function loadFiles() {
    const grid = document.getElementById('file-grid');
    const empty = document.getElementById('empty-state');
    const countBadge = document.getElementById('files-count');

    // Show loading skeletons
    grid.innerHTML = Array(6).fill('<div class="skeleton skeleton-card"></div>').join('');
    empty.style.display = 'none';

    try {
        let url = '/files';
        const params = new URLSearchParams();
        if (currentFolderId) params.set('folder_id', currentFolderId);

        const searchVal = document.getElementById('search-input').value.trim();
        if (searchVal) params.set('search', searchVal);

        // Status filter
        const statusFilter = document.getElementById('filter-status')?.value;
        if (statusFilter) params.set('status', statusFilter);

        if (params.toString()) url += '?' + params.toString();

        const res = await apiFetch(url);
        const data = await res.json();
        let files = data.files || [];

        // Client-side type filter
        const typeFilter = document.getElementById('filter-type')?.value;
        if (typeFilter) {
            files = files.filter(f => {
                const mime = (f.file_type || '').toLowerCase();
                if (typeFilter === 'image') return mime.startsWith('image/');
                if (typeFilter === 'video') return mime.startsWith('video/');
                if (typeFilter === 'document') return mime.includes('pdf') || mime.includes('document') || mime.includes('sheet') || mime.includes('text') || mime.includes('presentation');
                if (typeFilter === 'other') return !mime.startsWith('image/') && !mime.startsWith('video/') && !mime.includes('pdf') && !mime.includes('document') && !mime.includes('sheet');
                return true;
            });
        }

        allFiles = files;
        countBadge.textContent = `${files.length} file${files.length !== 1 ? 's' : ''}`;

        if (files.length === 0) {
            grid.innerHTML = '';
            empty.style.display = 'block';
            return;
        }

        empty.style.display = 'none';

        // If viewing a specific folder, show flat card grid
        if (currentFolderId) {
            grid.classList.remove('folder-browser-grid');
            grid.classList.add('file-grid');
            grid.innerHTML = files.map((f, i) => renderFileCard(f, i)).join('');
        } else {
            // Group by folder and render folder cards
            grid.classList.remove('file-grid');
            grid.classList.add('folder-browser-grid');
            grid.innerHTML = renderFolderCards(files);
        }
    } catch (err) {
        console.error('Failed to load files:', err);
        grid.innerHTML = '<p style="color: var(--danger-400);">Failed to load files.</p>';
    }
}

function renderFolderCards(files) {
    // Group files by folder_id to count them and get details
    const groups = {};
    files.forEach(f => {
        const fKey = f.folder_id || 0;
        if (!groups[fKey]) {
            groups[fKey] = {
                id: f.folder_id,
                name: f.folder_name || 'Uncategorized',
                files: []
            };
        }
        groups[fKey].files.push(f);
    });

    const FOLDER_ICONS = {
        'Images': '🖼️', 'Videos': '🎬', 'Documents': '📝',
        'Software': '💿', 'Archives': '🗜️', 'Audio': '🎵', 'Others': '📦',
    };

    return Object.values(groups).map((folder, i) => {
        const icon = FOLDER_ICONS[folder.name] || '📁';
        return `
            <div class="folder-card browsable" style="animation-delay: ${Math.min(i * 0.05, 0.5)}s" onclick="filterByFolder(${folder.id}, null)">
                <div class="folder-icon">${icon}</div>
                <div class="folder-info">
                    <h4>${escapeHtml(folder.name)}</h4>
                    <span>${folder.files.length} file${folder.files.length !== 1 ? 's' : ''}</span>
                </div>
                <div class="folder-arrow">→</div>
            </div>
        `;
    }).join('');
}

function getCategoryClass(category) {
    if (!category) return '';
    const cat = category.toLowerCase().replace(/\s+/g, '_');
    const map = {
        gst: 'gst', itr: 'itr', audit: 'audit', tds: 'tds',
        invoice: 'invoice', receipt: 'receipt',
        kyc: 'kyc', payroll: 'payroll',
        income_tax: 'income_tax', financials: 'financials', legal: 'legal',
        client_uploads: 'client_uploads', uncategorized: 'uncategorized',
    };
    return map[cat] || 'default';
}

function renderConfMini(conf) {
    if (conf == null || conf <= 0) return '';
    const cl = conf >= 90 ? 'high' : conf >= 70 ? 'medium' : conf >= 50 ? 'low' : 'very-low';
    return `<span class="conf-mini"><span class="conf-mini-track"><span class="conf-mini-fill ${cl}" style="width:${conf}%"></span></span><span class="conf-pct ${cl}">${conf}%</span></span>`;
}

function renderFileCard(file, index) {
    const iconClass = getFileIconClass(file.file_type);
    const icon = getFileIcon(file.file_type);
    const delay = Math.min(index * 0.03, 0.5);
    const safeName = (file.file_name || '').replace(/'/g, "\\'").replace(/"/g, '&quot;');

    const statusBadge = file.status === 'reviewed'
        ? '<span class="status-badge reviewed">Reviewed</span>'
        : '<span class="status-badge pending">Pending</span>';

    const categoryTag = file.category
        ? `<span class="category-tag ${getCategoryClass(file.category)}">${escapeHtml(file.category)}</span>`
        : '';

    const subCatChip = file.sub_category && file.sub_category !== 'UNKNOWN'
        ? `<span class="subcategory-chip">${escapeHtml(file.sub_category)}</span>`
        : '';

    const confHtml = renderConfMini(file.classification_confidence);

    return `
        <div class="file-card" style="animation-delay: ${delay}s"
             onclick="showFileDetail(${file.id})">
            <div class="file-actions">
                <button class="delete-btn" title="Delete" onclick="event.stopPropagation(); showDeleteModal(${file.id})">✕</button>
            </div>
            <div class="file-icon ${iconClass}">${icon}</div>
            <div class="file-name" title="${safeName}">${file.file_name}</div>
            <div class="file-meta">
                <span>${formatFileSize(file.file_size)}</span>
                <span>${formatDate(file.created_at)}</span>
            </div>
            <div class="file-status-row">
                <div>${file.folder_name ? `<span class="file-folder-tag">${file.folder_name}</span>` : ''} ${categoryTag} ${subCatChip}</div>
                <div style="display:flex;align-items:center;gap:6px;">${confHtml} ${statusBadge}</div>
            </div>
        </div>
    `;
}

// ══════════════════════════════════════════════════════════════
// FILE DETAIL MODAL — Click a card to see full status + details
// ══════════════════════════════════════════════════════════════

function showFileDetail(fileId) {
    const file = allFiles.find(f => f.id === fileId);
    if (!file) return;

    selectedFileDetail = file;

    // Header
    document.getElementById('fdm-icon').textContent = getFileIcon(file.file_type);
    document.getElementById('fdm-file-name').textContent = file.file_name;
    document.getElementById('fdm-file-type').textContent = getMimeShort(file.file_type);

    // Status banner
    const banner = document.getElementById('fdm-status-banner');
    const statusIcon = document.getElementById('fdm-status-icon');
    const statusLabel = document.getElementById('fdm-status-label');
    const statusDesc = document.getElementById('fdm-status-desc');

    if (file.status === 'reviewed') {
        banner.className = 'fdm-status-banner reviewed';
        statusIcon.textContent = '✅';
        statusLabel.textContent = 'Reviewed';
        statusDesc.textContent = file.reviewed_at
            ? `Reviewed on ${formatDate(file.reviewed_at, true)}`
            : 'Your file has been reviewed by the CA';
    } else {
        banner.className = 'fdm-status-banner pending';
        statusIcon.textContent = '⏳';
        statusLabel.textContent = 'Pending Review';
        statusDesc.textContent = 'Your file is awaiting review by the CA';
    }

    // Detail grid
    const grid = document.getElementById('fdm-detail-grid');
    grid.innerHTML = `
        <dt>File Name</dt>
        <dd>${escapeHtml(file.file_name)}</dd>
        <dt>Type</dt>
        <dd>${escapeHtml(file.file_type || 'Unknown')}</dd>
        <dt>Size</dt>
        <dd>${formatFileSize(file.file_size)}</dd>
        <dt>Folder</dt>
        <dd>${escapeHtml(file.folder_name || '—')}</dd>
        ${file.category ? `<dt>Category</dt><dd><span class="category-tag ${getCategoryClass(file.category)}">${escapeHtml(file.category)}</span></dd>` : ''}
        ${file.sub_category && file.sub_category !== 'UNKNOWN' ? `<dt>Sub-Category</dt><dd><span class="subcategory-chip">${escapeHtml(file.sub_category)}</span></dd>` : ''}
        ${file.financial_year ? `<dt>Financial Year</dt><dd>${escapeHtml(file.financial_year)}</dd>` : ''}
        ${file.classification_confidence ? `<dt>AI Confidence</dt><dd>${renderConfMini(file.classification_confidence)}</dd>` : ''}
        <dt>Uploaded</dt>
        <dd>${formatDate(file.created_at, true)}</dd>
        <dt>Status</dt>
        <dd>${file.status === 'reviewed' ? '<span class="status-badge reviewed">Reviewed</span>' : '<span class="status-badge pending">Pending</span>'}</dd>
    `;

    // Download button
    const openBtn = document.getElementById('fdm-open-btn');
    if (file.drive_web_link) {
        openBtn.style.display = 'inline-flex';
    } else {
        openBtn.style.display = 'none';
    }

    document.getElementById('file-detail-overlay').classList.add('visible');
}

function closeFileDetail() {
    document.getElementById('file-detail-overlay').classList.remove('visible');
    selectedFileDetail = null;
}

function openFileFromDetail() {
    if (selectedFileDetail && selectedFileDetail.drive_web_link) {
        if (selectedFileDetail.drive_web_link.startsWith('/api/files/serve/')) {
            window.open('/viewer?file_id=' + selectedFileDetail.id + '&mode=view', '_blank');
        } else {
            openFile(selectedFileDetail.drive_web_link);
        }
    }
}

function getMimeShort(mimeType) {
    if (!mimeType) return 'File';
    if (mimeType.startsWith('image/')) return 'Image';
    if (mimeType.startsWith('video/')) return 'Video';
    if (mimeType.startsWith('audio/')) return 'Audio';
    if (mimeType.includes('pdf')) return 'PDF';
    if (mimeType.includes('word') || mimeType.includes('document')) return 'Document';
    if (mimeType.includes('excel') || mimeType.includes('sheet')) return 'Spreadsheet';
    if (mimeType.includes('powerpoint') || mimeType.includes('presentation')) return 'Presentation';
    if (mimeType.includes('zip') || mimeType.includes('rar') || mimeType.includes('compressed')) return 'Archive';
    return 'File';
}

function getFileIconClass(mimeType) {
    if (!mimeType) return 'other';
    if (mimeType.startsWith('image/')) return 'image';
    if (mimeType.startsWith('video/')) return 'video';
    if (mimeType.startsWith('audio/')) return 'other';
    if (mimeType.startsWith('text/') || mimeType.includes('pdf') || mimeType.includes('document') || mimeType.includes('sheet') || mimeType.includes('presentation')) return 'doc';
    return 'other';
}

function getFileIcon(mimeType) {
    if (!mimeType) return '📄';
    if (mimeType.startsWith('image/')) return '🖼️';
    if (mimeType.startsWith('video/')) return '🎬';
    if (mimeType.startsWith('audio/')) return '🎵';
    if (mimeType.includes('pdf')) return '📕';
    if (mimeType.includes('word') || mimeType.includes('document')) return '📘';
    if (mimeType.includes('excel') || mimeType.includes('sheet')) return '📗';
    if (mimeType.includes('powerpoint') || mimeType.includes('presentation')) return '📙';
    if (mimeType.startsWith('text/')) return '📝';
    if (mimeType.includes('zip') || mimeType.includes('rar') || mimeType.includes('compressed')) return '🗜️';
    return '📄';
}

function openFile(link) {
    if (link && link !== '#') {
        const token = localStorage.getItem('dam_token');
        if (token && link.startsWith('/api/') && !link.includes('?token=')) {
            link += (link.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(token);
        }
        window.open(link, '_blank');
    }
}

// ══════════════════════════════════════════════════════════════
// SEARCH
// ══════════════════════════════════════════════════════════════

function handleSearch(value) {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
        loadFiles();
    }, 300);
}

// ══════════════════════════════════════════════════════════════
// FILE UPLOAD
// ══════════════════════════════════════════════════════════════

function setupDragDrop() {
    const dropZone = document.getElementById('drop-zone');

    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('drag-over');
    });

    dropZone.addEventListener('dragleave', () => {
        dropZone.classList.remove('drag-over');
    });

    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('drag-over');
        if (e.dataTransfer.files.length > 0) {
            handleFileSelect(e.dataTransfer.files);
        }
    });
}

async function handleFileSelect(files) {
    if (!files || files.length === 0) return;

    const folderId = document.getElementById('folder-select').value;
    const progressEl = document.getElementById('upload-progress');
    const progressBar = document.getElementById('progress-bar');
    const progressText = document.getElementById('progress-text');

    const totalFiles = files.length;
    let completedFiles = 0;

    progressEl.classList.add('visible');
    progressBar.style.width = '0%';
    progressText.textContent = `Uploading 0 of ${totalFiles} files...`;

    for (const file of files) {
        try {
            progressText.textContent = `Uploading "${file.name}"... (${completedFiles + 1}/${totalFiles})`;

            const formData = new FormData();
            formData.append('file', file);
            if (folderId) {
                formData.append('folder_id', folderId);
            }

            const res = await apiFetch('/files/upload', {
                method: 'POST',
                body: formData,
            });

            const data = await res.json();

            if (res.ok) {
                completedFiles++;
                const pct = Math.round((completedFiles / totalFiles) * 100);
                progressBar.style.width = pct + '%';
                const categoryMsg = data.category ? ` (Category: ${data.category})` : '';
                showToast(data.message + categoryMsg || `File uploaded to ${data.folder_name}`, 'success');
            } else {
                showToast(`Failed to upload "${file.name}": ${data.error}`, 'error');
            }
        } catch (err) {
            showToast(`Error uploading "${file.name}"`, 'error');
            console.error(err);
        }
    }

    // Done
    progressText.textContent = `${completedFiles} of ${totalFiles} files uploaded!`;
    progressBar.style.width = '100%';

    setTimeout(() => {
        progressEl.classList.remove('visible');
    }, 2000);

    // Refresh data
    loadDashboard();
    loadFolders();
    loadFiles();

    // Reset file input
    document.getElementById('file-input').value = '';
}

function scrollToUpload() {
    document.getElementById('upload-section').scrollIntoView({ behavior: 'smooth' });
}

// ══════════════════════════════════════════════════════════════
// DELETE
// ══════════════════════════════════════════════════════════════

function showDeleteModal(fileId) {
    deleteTargetId = fileId;
    document.getElementById('delete-modal').classList.add('visible');
}

function closeDeleteModal() {
    deleteTargetId = null;
    document.getElementById('delete-modal').classList.remove('visible');
}

async function confirmDelete() {
    if (!deleteTargetId) return;

    const btn = document.getElementById('confirm-delete-btn');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>';

    try {
        const res = await apiFetch(`/files/${deleteTargetId}`, { method: 'DELETE' });
        const data = await res.json();

        if (res.ok) {
            showToast('File deleted successfully', 'success');
            loadDashboard();
            loadFolders();
            loadFiles();
        } else {
            showToast(data.error || 'Failed to delete file', 'error');
        }
    } catch (err) {
        showToast('Error deleting file', 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Delete';
        closeDeleteModal();
    }
}

// ══════════════════════════════════════════════════════════════
// STORAGE, PAYMENTS, & BILLING (USER)
// ══════════════════════════════════════════════════════════════

async function loadUserStorage() {
    try {
        const res = await apiFetch('/storage/quota');
        if (!res.ok) return;
        const resp = await res.json();
        const data = resp.quota || resp;
        
        const info = document.getElementById('storage-info');
        const fill = document.getElementById('storage-bar-fill');
        const badge = document.getElementById('storage-plan-badge');
        
        if (info && fill) {
            info.textContent = `${formatFileSize(data.actual_used)} / ${formatFileSize(data.quota_bytes)}`;
            const pct = Math.min((data.actual_used / data.quota_bytes) * 100, 100);
            fill.style.width = `${pct}%`;
            if (pct > 80) fill.style.backgroundColor = 'var(--warning-500)';
            if (pct > 95) fill.style.backgroundColor = 'var(--danger-500)';
        }
        if (badge) {
            badge.textContent = `${data.plan_name.toUpperCase()} Plan`;
        }
    } catch (err) { console.error('Failed to load storage:', err); }
}

async function loadUserPayments() {
    try {
        const res = await apiFetch('/payments/my');
        if (!res.ok) return;
        const data = await res.json();
        const payments = data.payments || [];
        
        const tbody = document.getElementById('my-payments-tbody');
        if (!tbody) return;
        if (payments.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" class="table-empty">No payments recorded yet</td></tr>';
            return;
        }
        
        tbody.innerHTML = payments.map(p => `
            <tr>
                <td class="amount-cell">₹${Number(p.amount).toLocaleString('en-IN')}</td>
                <td>${escapeHtml(p.description || '—')}</td>
                <td>${p.payment_method ? p.payment_method.toUpperCase() : '—'}</td>
                <td><span class="status-badge status-${p.status}">${p.status === 'received' ? '✅ Received' : '⏳ Pending'}</span></td>
                <td>${formatDate(p.created_at)}</td>
            </tr>
        `).join('');
    } catch (err) { console.error('Failed to load user payments:', err); }
}

async function loadUserBilling() {
    try {
        const res = await apiFetch('/billing/my');
        if (!res.ok) return;
        const data = await res.json();
        const services = data.billing || [];
        
        const tbody = document.getElementById('my-billing-tbody');
        if (!tbody) return;
        if (services.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" class="table-empty">No billing services recorded yet</td></tr>';
            return;
        }
        
        tbody.innerHTML = services.map(s => `
            <tr>
                <td><strong>${escapeHtml(s.service_name)}</strong></td>
                <td class="amount-cell">₹${Number(s.amount).toLocaleString('en-IN')}</td>
                <td>${escapeHtml(s.billing_period || '—')}</td>
                <td><span class="status-badge status-${s.status}">${s.status === 'paid' ? '✅ Paid' : '⏳ Pending'}</span></td>
                <td>${formatDate(s.created_at)}</td>
            </tr>
        `).join('');
    } catch (err) { console.error('Failed to load user billing:', err); }
}

// ══════════════════════════════════════════════════════════════
// SHARED FILES
// ══════════════════════════════════════════════════════════════

async function loadSharedFiles() {
    const container = document.getElementById('shared-files-container');
    const badge = document.getElementById('shared-files-badge');
    const empty = document.getElementById('shared-files-empty');
    if (!container) return;

    try {
        const res = await apiFetch('/shares/my');
        const data = await res.json();
        const files = data.shared_files || [];

        if (badge) badge.textContent = files.length;

        if (files.length === 0) {
            container.innerHTML = '';
            if (empty) empty.style.display = 'block';
            return;
        }

        if (empty) empty.style.display = 'none';

        container.innerHTML = files.map((sf, i) => {
            const permClass = sf.permission === 'view' ? 'perm-view' : sf.permission === 'edit' ? 'perm-edit' : 'perm-download';
            const permLabel = sf.permission === 'view' ? '👁 View Only' : sf.permission === 'edit' ? '✏️ Edit' : '⬇️ Download';
            const icon = getFileIcon(sf.file_type);

            // Build action buttons based on permission
            let actionBtns = '';
            if (sf.drive_web_link) {
                // Everyone with access can view
                actionBtns += `<button class="btn btn-primary btn-sm" onclick="event.stopPropagation(); window.open('/viewer?file_id=${sf.file_id}&mode=view', '_blank')">👁 View</button>`;

                // Edit access
                if (sf.permission === 'edit' || sf.permission === 'download') {
                    actionBtns += `<button class="btn btn-secondary btn-sm" onclick="event.stopPropagation(); window.open('/viewer?file_id=${sf.file_id}&mode=edit', '_blank')">✏️ Edit</button>`;
                }

                // Download access
                if (sf.permission === 'download') {
                    const token = localStorage.getItem('dam_token');
                    const dlLink = sf.drive_web_link + (sf.drive_web_link.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(token || '');
                    actionBtns += `<a href="${dlLink}" target="_blank" class="btn btn-secondary btn-sm" style="text-decoration: none;">⬇ Download</a>`;
                }
            }

            return `
                <div class="shared-file-card" style="animation: fadeSlideUp 0.4s ease-out both; animation-delay: ${Math.min(i * 0.05, 0.5)}s;">
                    <div class="shared-file-icon">${icon}</div>
                    <div class="shared-file-info">
                        <div class="shared-file-name">${escapeHtml(sf.file_name)}</div>
                        <div class="shared-file-meta">
                            <span>📁 ${escapeHtml(sf.folder_name)}</span>
                            <span>·</span>
                            <span>${formatFileSize(sf.file_size)}</span>
                            <span>·</span>
                            <span>Shared by ${escapeHtml(sf.shared_by_name || sf.shared_by_email)}</span>
                        </div>
                    </div>
                    <div class="shared-file-perm">
                        <span class="perm-badge ${permClass}">${permLabel}</span>
                    </div>
                    <div class="shared-file-actions">
                        ${actionBtns}
                    </div>
                </div>
            `;
        }).join('');
    } catch (err) {
        console.error('Failed to load shared files:', err);
        container.innerHTML = '<div class="empty-state-sm">Could not load shared files</div>';
    }
}

// ══════════════════════════════════════════════════════════════
// WORKSPACE SHARED DOCUMENTS (Client view)
// ══════════════════════════════════════════════════════════════

async function loadWorkspaceSharedDocs() {
    const container = document.getElementById('ws-shared-container');
    const badge = document.getElementById('ws-shared-badge');
    const empty = document.getElementById('ws-shared-empty');
    if (!container) return;

    try {
        const res = await apiFetch('/workspace/shared');
        const data = await res.json();
        const docs = data.documents || [];

        if (badge) badge.textContent = docs.length;

        if (docs.length === 0) {
            container.innerHTML = '';
            if (empty) empty.style.display = 'block';
            return;
        }

        if (empty) empty.style.display = 'none';

        container.innerHTML = docs.map((doc, i) => {
            const permLabel = doc.permission === 'download' ? '⬇️ Download' : '👁 View Only';
            const permClass = doc.permission === 'download' ? 'perm-download' : 'perm-view';

            let actionBtns = '';
            // View button - open in viewer
            actionBtns += `<button class="btn btn-primary btn-sm" onclick="event.stopPropagation(); window.open('/viewer?workspace_doc_id=${doc.id}&mode=view', '_blank')">👁 View</button>`;

            // Download button
            if (doc.permission === 'download') {
                const token = localStorage.getItem('dam_token');
                actionBtns += `<a href="/api/workspace/documents/${doc.id}/download?token=${encodeURIComponent(token || '')}" target="_blank" class="btn btn-secondary btn-sm" style="text-decoration: none;">⬇ Download</a>`;
            }

            return `
                <div class="shared-file-card" style="animation: fadeSlideUp 0.4s ease-out both; animation-delay: ${Math.min(i * 0.05, 0.5)}s;">
                    <div class="shared-file-icon">📄</div>
                    <div class="shared-file-info">
                        <div class="shared-file-name">${escapeHtml(doc.title)}</div>
                        <div class="shared-file-meta">
                            <span>📎 ${escapeHtml(doc.file_name)}</span>
                            <span>·</span>
                            <span>${formatFileSize(doc.file_size)}</span>
                            <span>·</span>
                            <span>v${doc.version}</span>
                            <span>·</span>
                            <span>Shared by ${escapeHtml(doc.shared_by_name || doc.shared_by_email)}</span>
                        </div>
                    </div>
                    <div class="shared-file-perm">
                        <span class="perm-badge ${permClass}">${permLabel}</span>
                    </div>
                    <div class="shared-file-actions">
                        ${actionBtns}
                    </div>
                </div>
            `;
        }).join('');
    } catch (err) {
        console.error('Failed to load workspace shared docs:', err);
        container.innerHTML = '<div class="empty-state-sm">Could not load workspace documents</div>';
    }
}

// ══════════════════════════════════════════════════════════════
// TOAST NOTIFICATIONS
// ══════════════════════════════════════════════════════════════

function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');

    const icons = {
        success: '✓',
        error: '✕',
        info: 'ℹ',
    };

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
        <span class="toast-icon">${icons[type] || icons.info}</span>
        <span class="toast-message">${message}</span>
        <button class="toast-close" onclick="removeToast(this.parentElement)">✕</button>
    `;

    container.appendChild(toast);
    setTimeout(() => { removeToast(toast); }, 4000);
}

function removeToast(toast) {
    if (!toast || toast.classList.contains('removing')) return;
    toast.classList.add('removing');
    setTimeout(() => toast.remove(), 300);
}

// ══════════════════════════════════════════════════════════════
// SIDEBAR TOGGLE (MOBILE)
// ══════════════════════════════════════════════════════════════

function toggleSidebar() {
    document.getElementById('sidebar').classList.toggle('open');
    document.getElementById('sidebar-overlay').classList.toggle('visible');
}
