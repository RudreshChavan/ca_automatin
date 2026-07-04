/**
 * DAM — Admin Panel logic.
 * Handles users, folder-based file browsing, tasks, pending review,
 * notifications, and folder management.
 */

// ── Auth Guard ──
if (!isAuthenticated()) {
    window.location.href = '/';
}

// ── State ──
let allUsers = [];
let currentUserId = null;
let currentAdminFolderId = null;
let allAdminFolders = [];
let currentFolderFiles = [];
let deleteFileTargetId = null;
let deleteUserTargetId = null;
let deleteType = null;
let adminFileSearchTimeout = null;
let adminNotifOpen = false;
let shareableUsers = [];
let currentShareFileId = null;

// ── Initialize ──
document.addEventListener('DOMContentLoaded', () => {
    loadAdminUserInfo();
    loadAdminDashboard();
    loadAdminUsers();
    loadAdminFolderBrowser();
    loadPendingFiles();
    loadAllTasks();
    loadCompletedTasks();
    loadAdminNotifications();
    startAdminNotifPolling();
    loadShareableUsers();
    loadAllShares();

    // Close notification dropdown on outside click
    document.addEventListener('click', (e) => {
        const bell = document.getElementById('admin-notif-bell');
        const dropdown = document.getElementById('admin-notif-dropdown');
        if (adminNotifOpen && bell && dropdown && !bell.contains(e.target) && !dropdown.contains(e.target)) {
            dropdown.classList.remove('visible');
            adminNotifOpen = false;
        }
    });
});

// ══════════════════════════════════════════════════════════════
// ADMIN USER INFO
// ══════════════════════════════════════════════════════════════

function loadAdminUserInfo() {
    const user = getStoredUser();
    if (user) {
        document.getElementById('user-email').textContent = user.email || 'admin@email.com';
        document.getElementById('user-name').textContent = user.name || user.email.split('@')[0];
        document.getElementById('user-avatar').textContent = (user.email || 'A').charAt(0).toUpperCase();
    }
}

function logout() {
    localStorage.removeItem('dam_token');
    localStorage.removeItem('dam_user');
    window.location.href = '/';
}

// ══════════════════════════════════════════════════════════════
// VIEW SWITCHING
// ══════════════════════════════════════════════════════════════

function switchView(view, btnEl) {
    // Hide all views
    document.querySelectorAll('.admin-view').forEach(v => v.classList.remove('active'));

    // Show target view
    const viewEl = document.getElementById(`view-${view}`);
    if (viewEl) viewEl.classList.add('active');

    // Update sidebar active state
    document.querySelectorAll('.sidebar-item').forEach(b => b.classList.remove('active'));
    if (btnEl) btnEl.classList.add('active');

    // Update title
    const titles = {
        dashboard: 'Admin Dashboard',
        users: 'User Management',
        files: 'File Monitor',
        tasks: 'Task Management',
        completed: 'Completed Tasks',
        pending: 'Pending Review',
        'user-details': 'User Details',
        sharing: 'File Sharing',
    };
    document.getElementById('page-title').textContent = titles[view] || 'Admin Panel';

    // Refresh data on view switch
    if (view === 'pending') loadPendingFiles();
    if (view === 'payments') loadAdminPayments();
    if (view === 'storage') loadAdminStorageQuotas();
    if (view === 'files') {
        // Reset to folder grid
        currentAdminFolderId = null;
        loadAdminFolderBrowser();
    }
    if (view === 'sharing') loadAllShares();

    // Close mobile sidebar
    document.getElementById('sidebar').classList.remove('open');
    document.getElementById('sidebar-overlay').classList.remove('visible');
}

// ══════════════════════════════════════════════════════════════
// NOTIFICATIONS (Admin)
// ══════════════════════════════════════════════════════════════

function toggleAdminNotifDropdown() {
    const dropdown = document.getElementById('admin-notif-dropdown');
    adminNotifOpen = !adminNotifOpen;
    if (adminNotifOpen) {
        dropdown.classList.add('visible');
        loadAdminNotifications();
    } else {
        dropdown.classList.remove('visible');
    }
}

async function loadAdminNotifications() {
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
        const badge = document.getElementById('admin-notif-badge');
        if (unreadCount > 0) {
            badge.textContent = unreadCount > 99 ? '99+' : unreadCount;
            badge.classList.remove('hidden');
        } else {
            badge.classList.add('hidden');
        }

        const NOTIF_ICONS = {
            file_uploaded: '📤',
            file_reviewed: '✅',
            payment_received: '💰',
        };

        const list = document.getElementById('admin-notif-list');
        if (notifications.length === 0) {
            list.innerHTML = '<div class="notif-empty">No notifications yet 🎉</div>';
            return;
        }

        list.innerHTML = notifications.map(n => `
            <div class="notif-item ${n.is_read ? '' : 'unread'}" onclick="handleAdminNotifClick(${n.id}, ${n.is_read})">
                <div class="notif-icon ${n.type}">${NOTIF_ICONS[n.type] || '🔔'}</div>
                <div class="notif-content">
                    <div class="notif-title">${escapeHtml(n.title)}</div>
                    <div class="notif-message">${escapeHtml(n.message || '')}</div>
                    <div class="notif-time">${formatDate(n.created_at)}</div>
                </div>
            </div>
        `).join('');
    } catch (err) {
        console.error('Failed to load admin notifications:', err);
    }
}

async function handleAdminNotifClick(notifId, isRead) {
    if (!isRead) {
        try {
            await apiFetch(`/notifications/${notifId}/read`, { method: 'PUT' });
            loadAdminNotifications();
        } catch (err) {
            console.error(err);
        }
    }
}

async function markAllAdminNotifsRead() {
    try {
        await apiFetch('/notifications/read-all', { method: 'PUT' });
        loadAdminNotifications();
        showToast('All notifications marked as read', 'success');
    } catch (err) {
        console.error(err);
    }
}

function startAdminNotifPolling() {
    setInterval(() => { loadAdminNotifications(); }, 30000);
}

// ══════════════════════════════════════════════════════════════
// DASHBOARD
// ══════════════════════════════════════════════════════════════

async function loadAdminDashboard() {
    try {
        const res = await apiFetch('/admin/dashboard');
        const data = await res.json();

        document.getElementById('stat-users').textContent = data.total_users || 0;
        document.getElementById('stat-files').textContent = data.total_files || 0;
        document.getElementById('stat-storage').textContent = formatFileSize(data.total_storage || 0);

        // Load pending count
        try {
            const pendingRes = await apiFetch('/admin/files/pending');
            const pendingData = await pendingRes.json();
            const pendingCount = pendingData.count || 0;
            document.getElementById('stat-pending').textContent = pendingCount;
            document.getElementById('badge-pending').textContent = pendingCount;
        } catch (e) {
            console.error('Failed to load pending count:', e);
        }

        // Per-user table
        const perUserBody = document.getElementById('per-user-tbody');
        const perUser = data.per_user || [];
        if (perUser.length === 0) {
            perUserBody.innerHTML = '<tr><td colspan="3" class="table-empty">No user data</td></tr>';
        } else {
            perUserBody.innerHTML = perUser.map(u => `
                <tr>
                    <td><div class="table-user-cell">
                        <div class="table-user-avatar">${(u.email || '?').charAt(0).toUpperCase()}</div>
                        <span>${escapeHtml(u.email)}</span>
                    </div></td>
                    <td>${u.file_count}</td>
                    <td>${formatFileSize(u.total_size)}</td>
                </tr>
            `).join('');
        }

        // Recent uploads
        const recentBody = document.getElementById('recent-tbody');
        const recent = data.recent_uploads || [];
        if (recent.length === 0) {
            recentBody.innerHTML = '<tr><td colspan="5" class="table-empty">No recent uploads</td></tr>';
        } else {
            recentBody.innerHTML = recent.map(f => {
                const viewBtn = f.drive_web_link
                    ? `<a href="${getAuthLink(f.drive_web_link)}" target="_blank" class="btn btn-ghost btn-table" style="color: var(--primary-400); text-decoration: none;" title="View File" onclick="event.stopPropagation();">👁</a>`
                    : '';
                return `
                <tr>
                    <td><div class="table-file-name"><span class="table-file-icon">${getFileIcon(f.file_type)}</span><span class="file-name-text">${escapeHtml(f.file_name)}</span></div></td>
                    <td><span class="type-badge">${getMimeShort(f.file_type)}</span></td>
                    <td>${formatFileSize(f.file_size)}</td>
                    <td><span class="user-badge">${escapeHtml(f.user_email || '—')}</span></td>
                    <td style="display: flex; align-items: center; justify-content: space-between;">
                        ${formatDate(f.created_at)}
                        ${viewBtn}
                    </td>
                </tr>
            `}).join('');
        }

    } catch (err) {
        console.error('Failed to load admin dashboard:', err);
    }
}

// ══════════════════════════════════════════════════════════════
// FOLDER-BASED FILE BROWSER
// ══════════════════════════════════════════════════════════════

async function loadAdminFolderBrowser() {
    try {
        const res = await apiFetch('/admin/files');
        const data = await res.json();
        const allFiles = data.files || [];

        // Group files by user, then by folder
        const userMap = {};

        allFiles.forEach(f => {
            const uKey = f.user_email || 'Unknown User';
            if (!userMap[uKey]) {
                userMap[uKey] = {
                    email: uKey,
                    folders: {}
                };
            }

            const fKey = f.folder_id || 0;
            if (!userMap[uKey].folders[fKey]) {
                userMap[uKey].folders[fKey] = {
                    id: f.folder_id,
                    name: f.folder_name || 'Uncategorized',
                    user_email: uKey,
                    files: [],
                    pending: 0,
                    reviewed: 0,
                    totalSize: 0,
                };
            }

            const folder = userMap[uKey].folders[fKey];
            folder.files.push(f);
            folder.totalSize += (f.file_size || 0);
            if (f.status === 'pending') folder.pending++;
            else folder.reviewed++;
        });

        // Flatten folders for global tracking
        allAdminFolders = [];
        const userGroups = Object.values(userMap);
        userGroups.forEach(user => {
            user.foldersList = Object.values(user.folders);
            allAdminFolders.push(...user.foldersList);
        });

        // Show folder grid, hide file cards
        document.getElementById('admin-folder-grid').style.display = '';
        document.getElementById('admin-folder-files-grid').style.display = 'none';
        document.getElementById('folder-files-empty').style.display = 'none';
        document.getElementById('folder-files-filter-bar').style.display = 'none';
        document.getElementById('files-view-title').textContent = '📂 All Folders';
        document.getElementById('admin-files-count').textContent = `${allAdminFolders.length} folder${allAdminFolders.length !== 1 ? 's' : ''}`;
        document.getElementById('badge-files').textContent = allFiles.length;

        // Breadcrumb
        document.getElementById('file-breadcrumb').innerHTML = '<span class="breadcrumb-current">📂 All Folders</span>';

        const grid = document.getElementById('admin-folder-grid');
        if (userGroups.length === 0) {
            grid.innerHTML = '<div class="empty-state"><div class="empty-icon">📂</div><h3>No folders yet</h3><p>Files will appear here when users upload them</p></div>';
            return;
        }

        const FOLDER_ICONS = {
            'Images': '🖼️', 'Videos': '🎬', 'Documents': '📝',
            'Software': '💿', 'Archives': '🗜️', 'Audio': '🎵', 'Others': '📦',
        };

        grid.innerHTML = userGroups.map((user, uIndex) => {
            const folderCards = user.foldersList.map((folder, i) => {
                const icon = FOLDER_ICONS[folder.name] || '📁';
                return `
                    <div class="browsable-folder-card" style="animation-delay: ${Math.min(i * 0.05, 0.5)}s" onclick="openAdminFolder(${folder.id}, '${escapeHtml(folder.name).replace(/'/g, "\\'")}')">
                        <div class="folder-header">
                            <div class="folder-icon-lg">${icon}</div>
                            <div class="folder-details">
                                <h4 title="${escapeHtml(folder.name)}">${escapeHtml(folder.name)}</h4>
                                <span class="folder-meta-sub">${folder.files.length} file${folder.files.length !== 1 ? 's' : ''} · ${formatFileSize(folder.totalSize)}</span>
                            </div>
                        </div>
                        <div class="folder-stats">
                            <div class="folder-stat">
                                <span class="stat-num">${folder.pending}</span>
                                <span class="stat-lbl">Pending</span>
                            </div>
                            <div class="folder-stat">
                                <span class="stat-num">${folder.reviewed}</span>
                                <span class="stat-lbl">Reviewed</span>
                            </div>
                        </div>
                    </div>
                `;
            }).join('');

            return `
                <div class="admin-user-folder-group" style="margin-bottom: var(--sp-8); animation: fadeSlideUp 0.4s ease-out both; animation-delay: ${Math.min(uIndex * 0.1, 0.5)}s;">
                    <div class="user-folder-group-header" style="display: flex; align-items: center; gap: var(--sp-3); margin-bottom: var(--sp-4); padding-bottom: var(--sp-3); border-bottom: 1px solid var(--border-subtle);">
                        <div class="user-avatar" style="width: 36px; height: 36px; font-size: 0.9rem; font-weight: 700;">${(user.email || '?').charAt(0).toUpperCase()}</div>
                        <h3 style="font-size: 1.1rem; font-weight: 600;">${escapeHtml(user.email)}</h3>
                        <span style="font-size: 0.8rem; color: var(--text-tertiary); margin-left: auto; background: var(--bg-surface); padding: 2px 10px; border-radius: var(--radius-full);">${user.foldersList.length} folder${user.foldersList.length !== 1 ? 's' : ''}</span>
                    </div>
                    <div class="folder-browser-grid">
                        ${folderCards}
                    </div>
                </div>
            `;
        }).join('');

    } catch (err) {
        console.error('Failed to load folder browser:', err);
    }
}

function openAdminFolder(folderId, folderName) {
    // If not currently on the 'files' view, switch to it
    document.querySelectorAll('.admin-view').forEach(v => v.classList.remove('active'));
    document.getElementById('view-files').classList.add('active');
    
    // Update sidebar UI
    document.querySelectorAll('.sidebar-item').forEach(b => b.classList.remove('active'));
    const navFiles = document.getElementById('nav-files');
    if (navFiles) navFiles.classList.add('active');

    currentAdminFolderId = folderId;
    loadFolderFiles(folderId, folderName);
}

async function loadFolderFiles(folderId, folderName) {
    if (!folderName) {
        const folder = allAdminFolders.find(f => f.id === folderId);
        folderName = folder ? folder.name : 'Folder';
    }

    // Switch to file card view
    document.getElementById('admin-folder-grid').style.display = 'none';
    document.getElementById('admin-folder-files-grid').style.display = '';
    document.getElementById('folder-files-filter-bar').style.display = '';
    document.getElementById('files-view-title').textContent = `📂 ${escapeHtml(folderName)}`;

    // Breadcrumb
    document.getElementById('file-breadcrumb').innerHTML = `
        <button class="breadcrumb-item" onclick="backToFolderGrid()">📂 All Folders</button>
        <span class="breadcrumb-sep">›</span>
        <span class="breadcrumb-current">${escapeHtml(folderName)}</span>
    `;

    // Fetch files for this folder
    try {
        let url = `/admin/files?folder_id=${folderId}`;
        const statusFilter = document.getElementById('file-status-filter')?.value;
        if (statusFilter) url += `&status=${statusFilter}`;
        const search = document.getElementById('admin-file-search')?.value?.trim();
        if (search) url += `&search=${encodeURIComponent(search)}`;

        const res = await apiFetch(url);
        const data = await res.json();
        let files = data.files || [];

        // Client-side filter by status if backend doesn't support folder_id param
        if (folderId) {
            files = files.filter(f => f.folder_id === folderId);
        }

        currentFolderFiles = files;
        document.getElementById('admin-files-count').textContent = `${files.length} file${files.length !== 1 ? 's' : ''}`;

        const grid = document.getElementById('admin-folder-files-grid');
        const empty = document.getElementById('folder-files-empty');

        if (files.length === 0) {
            grid.innerHTML = '';
            empty.style.display = 'block';
            return;
        }

        empty.style.display = 'none';
        grid.innerHTML = files.map((f, i) => renderAdminFileCard(f, i)).join('');

    } catch (err) {
        console.error('Failed to load folder files:', err);
    }
}

function backToFolderGrid() {
    currentAdminFolderId = null;
    loadAdminFolderBrowser();
}

function renderAdminFileCard(file, index) {
    const icon = getFileIcon(file.file_type);
    const delay = Math.min(index * 0.04, 0.5);
    const statusBadge = file.status === 'reviewed'
        ? '<span class="status-badge reviewed">Reviewed</span>'
        : '<span class="status-badge pending">Pending</span>';

    const categoryTag = file.category
        ? `<span class="category-tag ${getCategoryClass(file.category)}">${escapeHtml(file.category)}</span>`
        : '';

    const subCatChip = file.sub_category && file.sub_category !== 'UNKNOWN'
        ? `<span class="subcategory-chip">${escapeHtml(file.sub_category)}</span>`
        : '';

    const fyTag = file.financial_year
        ? `<span class="meta-chip">📅 ${escapeHtml(file.financial_year)}</span>`
        : '';

    // Confidence mini-bar
    const conf = file.classification_confidence;
    let confHtml = '';
    if (conf != null && conf > 0) {
        const cl = conf >= 90 ? 'high' : conf >= 70 ? 'medium' : conf >= 50 ? 'low' : 'very-low';
        confHtml = `<span class="conf-mini"><span class="conf-mini-track"><span class="conf-mini-fill ${cl}" style="width:${conf}%"></span></span><span class="conf-pct ${cl}">${conf}%</span></span>`;
    }

    // Classify / Re-classify button
    const isUncategorized = !file.category || file.category === 'UNCATEGORIZED';
    const classifyBtn = isUncategorized
        ? `<button class="btn-classify" onclick="event.stopPropagation(); classifyFileInline(${file.id})">🤖 Classify</button>`
        : `<button class="btn-classify" onclick="event.stopPropagation(); openAdminOverride(${file.id}, '${escapeHtml(file.file_name).replace(/'/g, "\\\\'")}')">✏️ Re-classify</button>`;

    const reviewBtn = file.status === 'pending'
        ? `<button class="btn-review" onclick="event.stopPropagation(); reviewFile(${file.id})">✓ Mark Reviewed</button>`
        : '<span style="font-size: 0.72rem; color: var(--accent-400);">✓ Reviewed</span>';

    const viewBtn = `<button class="btn btn-ghost btn-table" style="color: var(--primary-400);" onclick="event.stopPropagation(); window.open('/viewer?file_id=${file.id}&mode=view', '_blank')">👁 View</button>`;
    const actionBtn = `<button class="btn btn-ghost btn-table" style="color: var(--warning-500);" onclick="event.stopPropagation(); window.open('/viewer?file_id=${file.id}&mode=edit', '_blank')">✏️ Edit</button>`;

    return `
        <div class="admin-file-card" style="animation-delay: ${delay}s">
            <div class="afc-header">
                <div class="afc-file-info">
                    <div class="afc-file-icon">${icon}</div>
                    <div>
                        <h4 title="${escapeHtml(file.file_name)}">${escapeHtml(file.file_name)}</h4>
                        <span class="afc-type">${getMimeShort(file.file_type)} · ${formatFileSize(file.file_size)}</span>
                    </div>
                </div>
                ${statusBadge}
            </div>
            <div class="afc-meta">
                <span class="meta-chip">👤 ${escapeHtml(file.user_email || 'Unknown')}</span>
                <span class="meta-chip">🕐 ${formatDate(file.created_at)}</span>
                ${categoryTag} ${subCatChip} ${fyTag} ${confHtml}
            </div>
            <div class="afc-footer">
                <div style="display: flex; gap: 8px; flex-wrap: wrap;">
                    ${viewBtn}
                    ${actionBtn}
                    ${reviewBtn}
                    ${classifyBtn}
                    <button class="btn btn-ghost btn-table" style="color: var(--primary-300);" onclick="event.stopPropagation(); showShareModal(${file.id}, '${escapeHtml(file.file_name).replace(/'/g, "\\'")}')">🔗 Share</button>
                </div>
                <button class="btn btn-ghost btn-table" style="color: var(--danger-400);" onclick="event.stopPropagation(); showDeleteModal(${file.id}, 'file')">Delete</button>
            </div>
        </div>
    `;
}

function handleAdminFileSearch() {
    clearTimeout(adminFileSearchTimeout);
    adminFileSearchTimeout = setTimeout(() => {
        if (currentAdminFolderId) {
            loadFolderFiles(currentAdminFolderId);
        }
    }, 300);
}

// ══════════════════════════════════════════════════════════════
// PENDING REVIEW
// ══════════════════════════════════════════════════════════════

async function loadPendingFiles() {
    try {
        const res = await apiFetch('/admin/files/pending');
        const data = await res.json();
        const files = data.files || [];
        const count = data.count || files.length;

        document.getElementById('pending-files-count').textContent = count;
        document.getElementById('badge-pending').textContent = count;

        const grid = document.getElementById('pending-cards-grid');
        const empty = document.getElementById('pending-empty');

        if (files.length === 0) {
            grid.innerHTML = '';
            empty.style.display = 'block';
            return;
        }

        empty.style.display = 'none';
        grid.innerHTML = files.map((f, i) => {
            const categoryTag = f.category
                ? `<span class="category-tag ${getCategoryClass(f.category)}">${escapeHtml(f.category)}</span>`
                : '';

            const viewBtn = `<button class="btn-ghost" style="color: var(--primary-400); padding: var(--sp-2) var(--sp-3); border-radius: var(--radius-sm);" onclick="event.stopPropagation(); window.open('/viewer?file_id=${f.id}&mode=view', '_blank')">👁 View</button>`;
            const actionBtn = `<button class="btn-ghost" style="color: var(--warning-500); padding: var(--sp-2) var(--sp-3); border-radius: var(--radius-sm);" onclick="event.stopPropagation(); window.open('/viewer?file_id=${f.id}&mode=edit', '_blank')">✏️ Edit</button>`;

            return `
                <div class="pending-card" style="animation-delay: ${Math.min(i * 0.05, 0.5)}s">
                    <div class="pending-card-header">
                        <div class="pending-card-file">
                            <div class="file-icon">${getFileIcon(f.file_type)}</div>
                            <div class="file-info">
                                <h4 title="${escapeHtml(f.file_name)}">${escapeHtml(f.file_name)}</h4>
                                <span>${getMimeShort(f.file_type)} · ${formatFileSize(f.file_size)}</span>
                            </div>
                        </div>
                        <span class="status-badge pending">Pending</span>
                    </div>
                    <div class="pending-card-meta">
                        <span class="meta-item">👤 ${escapeHtml(f.user_email || 'Unknown')}</span>
                        <span class="meta-item">📁 ${escapeHtml(f.folder_name || '')}</span>
                        <span class="meta-item">🕐 ${formatDate(f.created_at)}</span>
                        ${categoryTag}
                    </div>
                    <div class="pending-card-actions" style="display: flex; gap: var(--sp-2); align-items: center; justify-content: flex-end;">
                        ${viewBtn}
                        ${actionBtn}
                        <button class="btn-review" onclick="reviewFile(${f.id})">
                            ✓ Mark Reviewed
                        </button>
                    </div>
                </div>
            `;
        }).join('');
    } catch (err) {
        console.error('Failed to load pending files:', err);
    }
}

async function reviewFile(fileId) {
    try {
        const res = await apiFetch(`/admin/file/${fileId}/review`, { method: 'POST' });
        const data = await res.json();
        if (res.ok) {
            showToast(data.message || 'File marked as reviewed', 'success');
            loadPendingFiles();
            loadAdminDashboard();
            loadAdminNotifications();

            // Refresh folder view if inside a folder
            if (currentAdminFolderId) {
                loadFolderFiles(currentAdminFolderId);
            } else {
                loadAdminFolderBrowser();
            }
        } else {
            showToast(data.error || 'Failed to review file', 'error');
        }
    } catch (err) {
        showToast('Connection error', 'error');
        console.error(err);
    }
}

// ══════════════════════════════════════════════════════════════
// USERS
// ══════════════════════════════════════════════════════════════

async function loadAdminUsers() {
    try {
        const res = await apiFetch('/admin/users');
        const data = await res.json();
        allUsers = data.users || [];

        document.getElementById('badge-users').textContent = allUsers.length;
        populateUserFilters();

        const tbody = document.getElementById('users-tbody');
        if (allUsers.length === 0) {
            tbody.innerHTML = '<tr><td colspan="8" class="table-empty">No users found</td></tr>';
            return;
        }

        tbody.innerHTML = allUsers.map(u => `
            <tr>
                <td class="table-id">#${u.id}</td>
                <td>${escapeHtml(u.name || '—')}</td>
                <td>
                    <div class="table-user-cell">
                        <div class="table-user-avatar">${(u.email || '?').charAt(0).toUpperCase()}</div>
                        <span>${escapeHtml(u.email)}</span>
                    </div>
                </td>
                <td><span class="role-badge ${u.role}">${u.role}</span></td>
                <td>${u.stats?.total_files || 0}</td>
                <td>${formatFileSize(u.stats?.total_size || 0)}</td>
                <td>${formatDate(u.created_at)}</td>
                <td>
                    <button class="btn btn-ghost btn-table" onclick="showUserDetails(${u.id})">View</button>
                    ${u.role !== 'admin' ? `<button class="btn btn-ghost btn-table" style="color: var(--danger-400);" onclick="showDeleteModal(${u.id}, 'user')">Delete</button>` : ''}
                </td>
            </tr>
        `).join('');
    } catch (err) {
        console.error('Failed to load admin users:', err);
    }
}

function populateUserFilters() {
    // Task user select
    const taskSelect = document.getElementById('task-user-select');
    if (taskSelect) {
        taskSelect.innerHTML = '<option value="">Select a user...</option>' +
            allUsers.filter(u => u.role !== 'admin').map(u => `<option value="${u.id}">${escapeHtml(u.email)}</option>`).join('');
    }
}

// ══════════════════════════════════════════════════════════════
// USER DETAILS
// ══════════════════════════════════════════════════════════════

async function showUserDetails(userId) {
    currentUserId = userId;
    switchView('user-details');

    const user = allUsers.find(u => u.id === userId);
    if (user) {
        document.getElementById('details-user-name').textContent = `${user.name || user.email}`;
    }

    try {
        const res = await apiFetch(`/admin/user/${userId}/stats`);
        const data = await res.json();

        document.getElementById('detail-total-files').textContent = data.total_files || 0;
        document.getElementById('detail-total-storage').textContent = formatFileSize(data.total_size || 0);
        document.getElementById('detail-total-tasks').textContent = data.pending_tasks || 0;
    } catch (err) {
        console.error(err);
    }

    // Load user files
    try {
        const res = await apiFetch(`/admin/files?user_id=${userId}`);
        const data = await res.json();
        const files = data.files || [];

        document.getElementById('detail-files-count').textContent = `${files.length} files`;

        const tbody = document.getElementById('detail-files-tbody');
        if (files.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" class="table-empty">No files</td></tr>';
        } else {
            tbody.innerHTML = files.map(f => {
                const viewBtn = f.drive_web_link
                    ? `<a href="${getAuthLink(f.drive_web_link)}" target="_blank" class="btn btn-ghost btn-table" style="color: var(--primary-400); text-decoration: none;" onclick="event.stopPropagation();">👁 View</a>`
                    : '';
                return `
                <tr>
                    <td><div class="table-file-name"><span class="table-file-icon">${getFileIcon(f.file_type)}</span><span class="file-name-text">${escapeHtml(f.file_name)}</span></div></td>
                    <td><span class="type-badge">${getMimeShort(f.file_type)}</span></td>
                    <td>${formatFileSize(f.file_size)}</td>
                    <td>${formatDate(f.created_at)}</td>
                    <td style="display: flex; gap: 8px;">
                        ${viewBtn}
                        <button class="btn btn-ghost btn-table" style="color: var(--danger-400);" onclick="showDeleteModal(${f.id}, 'file')">Delete</button>
                    </td>
                </tr>
            `}).join('');
        }
    } catch (err) {
        console.error(err);
    }

    // Load user folders
    loadUserFolders(userId);
}

// ══════════════════════════════════════════════════════════════
// FOLDER MANAGEMENT (in User Details)
// ══════════════════════════════════════════════════════════════

async function loadUserFolders(userId) {
    try {
        const res = await apiFetch(`/admin/user/${userId}/folders`);
        const data = await res.json();
        const folders = data.folders || [];

        const grid = document.getElementById('detail-folder-grid');
        if (folders.length === 0) {
            grid.innerHTML = '<div class="empty-state-sm">No folders yet. Create one with the button above.</div>';
            return;
        }

        grid.innerHTML = folders.map(f => `
            <div class="folder-card browsable" onclick="openAdminFolder(${f.id}, '${escapeHtml(f.name).replace(/'/g, "\\'")}')">
                <div class="folder-icon">📁</div>
                <div class="folder-info">
                    <h4>${escapeHtml(f.name)}</h4>
                    <span>${f.file_count || 0} files</span>
                </div>
                <div class="folder-arrow">→</div>
            </div>
        `).join('');
    } catch (err) {
        console.error('Failed to load user folders:', err);
    }
}

function showCreateFolderModal() {
    document.getElementById('create-folder-modal').classList.add('visible');
    document.getElementById('new-folder-name').value = '';
}

function closeCreateFolderModal() {
    document.getElementById('create-folder-modal').classList.remove('visible');
}

async function handleCreateFolder(event) {
    event.preventDefault();
    if (!currentUserId) return;

    const folderName = document.getElementById('new-folder-name').value.trim();
    if (!folderName) return;

    try {
        const res = await apiFetch('/admin/folder', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: folderName,
                user_id: currentUserId,
            }),
        });
        const data = await res.json();
        if (res.ok) {
            showToast(data.message || 'Folder created', 'success');
            closeCreateFolderModal();
            loadUserFolders(currentUserId);
        } else {
            showToast(data.error || 'Failed to create folder', 'error');
        }
    } catch (err) {
        showToast('Connection error', 'error');
        console.error(err);
    }
}

// ══════════════════════════════════════════════════════════════
// TASKS
// ══════════════════════════════════════════════════════════════

async function loadAllTasks() {
    try {
        const res = await apiFetch('/admin/tasks');
        const data = await res.json();
        const tasks = data.tasks || [];

        const tbody = document.getElementById('all-tasks-tbody');
        if (tasks.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" class="table-empty">No tasks assigned yet</td></tr>';
            return;
        }

        tbody.innerHTML = tasks.map(t => {
            const status = t.status === 'completed'
                ? '<span class="status-badge reviewed">Completed</span>'
                : '<span class="status-badge pending">Pending</span>';

            return `
                <tr>
                    <td><strong>${escapeHtml(t.title)}</strong></td>
                    <td><span class="user-badge">${escapeHtml(t.user_email || '—')}</span></td>
                    <td>${status}</td>
                    <td>${formatDate(t.created_at)}</td>
                    <td>${t.completed_at ? formatDate(t.completed_at) : '<span class="text-muted">—</span>'}</td>
                </tr>
            `;
        }).join('');
    } catch (err) {
        console.error(err);
    }
}

async function loadCompletedTasks() {
    try {
        const res = await apiFetch('/admin/tasks/completed');
        const data = await res.json();
        const tasks = data.tasks || [];

        const tbody = document.getElementById('completed-tasks-tbody');
        if (tasks.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" class="table-empty">No completed tasks yet</td></tr>';
            return;
        }

        tbody.innerHTML = tasks.map(t => `
            <tr>
                <td><strong>${escapeHtml(t.title)}</strong></td>
                <td><span class="user-badge">${escapeHtml(t.user_email || '—')}</span></td>
                <td>${escapeHtml(t.description || '—')}</td>
                <td>${formatDate(t.created_at)}</td>
                <td>${t.completed_at ? formatDate(t.completed_at) : '—'}</td>
            </tr>
        `).join('');
    } catch (err) {
        console.error(err);
    }
}

// ══════════════════════════════════════════════════════════════
// CREATE USER
// ══════════════════════════════════════════════════════════════

function showCreateUserModal() {
    document.getElementById('create-user-modal').classList.add('visible');
    document.getElementById('create-user-error').style.display = 'none';
    document.getElementById('create-user-form').reset();
}

function closeCreateUserModal() {
    document.getElementById('create-user-modal').classList.remove('visible');
}

async function handleCreateUser(event) {
    event.preventDefault();

    const name = document.getElementById('new-user-name').value.trim();
    const email = document.getElementById('new-user-email').value.trim();
    const password = document.getElementById('new-user-password').value;
    const role = document.getElementById('new-user-role').value;
    const errorEl = document.getElementById('create-user-error');
    const btn = document.getElementById('create-user-btn');

    errorEl.style.display = 'none';
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>';

    try {
        const res = await apiFetch('/admin/create-user', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, email, password, role }),
        });

        const data = await res.json();
        if (res.ok) {
            showToast('User created successfully', 'success');
            closeCreateUserModal();
            loadAdminUsers();
            loadAdminDashboard();
        } else {
            errorEl.textContent = data.error || 'Failed to create user';
            errorEl.style.display = 'block';
        }
    } catch (err) {
        errorEl.textContent = 'Connection error';
        errorEl.style.display = 'block';
    } finally {
        btn.disabled = false;
        btn.textContent = 'Create User';
    }
}

// ══════════════════════════════════════════════════════════════
// ASSIGN TASK
// ══════════════════════════════════════════════════════════════

function showAssignTaskModal() {
    document.getElementById('assign-task-modal').classList.add('visible');
    document.getElementById('assign-task-form').reset();

    if (currentUserId) {
        const taskSelect = document.getElementById('task-user-select');
        if (taskSelect) taskSelect.value = currentUserId;
    }
}

function closeAssignTaskModal() {
    document.getElementById('assign-task-modal').classList.remove('visible');
}

async function handleAssignTask(event) {
    event.preventDefault();

    const userId = document.getElementById('task-user-select').value;
    const title = document.getElementById('task-title').value.trim();
    const description = document.getElementById('task-description').value.trim();
    const btn = document.getElementById('assign-task-btn');

    if (!userId || !title) {
        showToast('Please select a user and enter a title', 'error');
        return;
    }

    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>';

    try {
        const res = await apiFetch('/admin/task', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_id: parseInt(userId), title, description }),
        });

        const data = await res.json();
        if (res.ok) {
            showToast('Task assigned successfully', 'success');
            closeAssignTaskModal();
            loadAllTasks();
        } else {
            showToast(data.error || 'Failed to assign task', 'error');
        }
    } catch (err) {
        showToast('Connection error', 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Assign Task';
    }
}

// ══════════════════════════════════════════════════════════════
// DELETE
// ══════════════════════════════════════════════════════════════

function showDeleteModal(id, type) {
    deleteType = type;
    if (type === 'file') {
        deleteFileTargetId = id;
        document.getElementById('delete-modal-title').textContent = 'Delete File';
        document.getElementById('delete-modal-message').textContent = 'Are you sure you want to delete this file? This action cannot be undone.';
    } else {
        deleteUserTargetId = id;
        document.getElementById('delete-modal-title').textContent = 'Delete User';
        document.getElementById('delete-modal-message').textContent = 'Are you sure you want to delete this user? All their files and data will be removed.';
    }
    document.getElementById('delete-modal').classList.add('visible');
}

function closeDeleteModal() {
    deleteFileTargetId = null;
    deleteUserTargetId = null;
    deleteType = null;
    document.getElementById('delete-modal').classList.remove('visible');
}

async function confirmDelete() {
    const btn = document.getElementById('confirm-delete-btn');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>';

    try {
        let url, successMsg;
        if (deleteType === 'file') {
            url = `/admin/file/${deleteFileTargetId}`;
            successMsg = 'File deleted successfully';
        } else {
            url = `/admin/user/${deleteUserTargetId}`;
            successMsg = 'User deleted successfully';
        }

        const res = await apiFetch(url, { method: 'DELETE' });
        const data = await res.json();

        if (res.ok) {
            showToast(successMsg, 'success');
            if (deleteType === 'file') {
                loadAdminDashboard();
                if (currentAdminFolderId) {
                    loadFolderFiles(currentAdminFolderId);
                } else {
                    loadAdminFolderBrowser();
                }
                if (currentUserId) showUserDetails(currentUserId);
            } else {
                loadAdminUsers();
                loadAdminDashboard();
            }
        } else {
            showToast(data.error || 'Delete failed', 'error');
        }
    } catch (err) {
        showToast('Connection error', 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Delete';
        closeDeleteModal();
    }
}

// ══════════════════════════════════════════════════════════════
// PAYMENTS (ADMIN)
// ══════════════════════════════════════════════════════════════

async function loadAdminPayments() {
    try {
        const status = document.getElementById('payment-filter')?.value || '';
        const res = await apiFetch(`/admin/payments${status ? '?status=' + status : ''}`);
        const data = await res.json();
        const payments = data.payments || [];

        const badge = document.getElementById('badge-payments');
        if (badge) {
            const pendingCount = payments.filter(p => p.status === 'pending').length;
            badge.textContent = pendingCount;
        }

        const tbody = document.getElementById('admin-payments-tbody');
        if (payments.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" class="table-empty">No payments found</td></tr>';
            return;
        }

        tbody.innerHTML = payments.map(p => `
            <tr>
                <td>
                    <div class="table-user-cell">
                        <div class="table-user-avatar">${(p.user_email || '?').charAt(0).toUpperCase()}</div>
                        <span>${escapeHtml(p.user_name || p.user_email)}</span>
                    </div>
                </td>
                <td class="amount-cell">₹${formatAmount(p.amount)}</td>
                <td>${escapeHtml(p.description || '—')}</td>
                <td>${p.payment_method ? p.payment_method.toUpperCase() : '—'}</td>
                <td><span class="status-badge status-${p.status}">${p.status === 'received' ? '✅ Received' : '⏳ Pending'}</span></td>
                <td>${formatDate(p.created_at)}</td>
                <td>
                    ${p.status === 'pending' ? `<button class="btn btn-ghost btn-sm" style="color:var(--success-400)" onclick="updatePaymentStatus(${p.id}, 'received')">Mark Received</button>` : ''}
                </td>
            </tr>
        `).join('');
    } catch (err) {
        console.error('Failed to load admin payments:', err);
    }
}

async function updatePaymentStatus(paymentId, status) {
    if (!confirm(`Mark payment as ${status}?`)) return;
    try {
        const res = await apiFetch(`/admin/payment/${paymentId}/status`, {
            method: 'PUT',
            body: JSON.stringify({ status })
        });
        if (res.ok) {
            showToast(`Payment marked as ${status}`, 'success');
            loadAdminPayments();
        } else {
            const err = await res.json();
            showToast(err.error || 'Failed to update payment', 'error');
        }
    } catch (e) { showToast('Connection error', 'error'); }
}

function showAdminRecordPaymentModal() {
    // If not on billing page, maybe redirect or just show a simplified modal?
    // The easiest is redirect to billing page with ?action=payment
    window.location.href = '/billing';
}

function formatAmount(num) {
    if (!num) return '0';
    return Number(num).toLocaleString('en-IN', { maximumFractionDigits: 0 });
}

// ══════════════════════════════════════════════════════════════
// STORAGE (ADMIN)
// ══════════════════════════════════════════════════════════════

async function loadAdminStorageQuotas() {
    try {
        const res = await apiFetch('/admin/storage/quotas');
        const data = await res.json();
        const quotas = data.quotas || [];

        const grid = document.getElementById('storage-cards-grid');
        const empty = document.getElementById('storage-empty');

        if (quotas.length === 0) {
            grid.innerHTML = '';
            empty.style.display = 'block';
            return;
        }

        empty.style.display = 'none';
        grid.innerHTML = quotas.map((q, i) => {
            const pct = Math.min((q.actual_used / q.quota_bytes) * 100, 100);
            let barColor = 'var(--primary-500)';
            if (pct > 80) barColor = 'var(--warning-500)';
            if (pct > 95) barColor = 'var(--danger-500)';

            return `
                <div class="storage-card" style="animation-delay: ${Math.min(i * 0.05, 0.5)}s">
                    <div class="storage-card-header">
                        <div class="user-info-sm">
                            <div class="user-avatar-sm">${(q.user_email || '?').charAt(0).toUpperCase()}</div>
                            <div>
                                <div class="user-name-sm">${escapeHtml(q.user_name || q.user_email)}</div>
                                <div class="user-plan-sm">${q.plan_name.toUpperCase()} PLAN</div>
                            </div>
                        </div>
                        <button class="btn btn-ghost btn-sm" onclick="showUpgradeModal(${q.user_id}, '${q.plan_name}')">Upgrade</button>
                    </div>
                    <div class="storage-card-body">
                        <div class="storage-stats">
                            <span>${formatFileSize(q.actual_used)} used</span>
                            <span>${formatFileSize(q.quota_bytes)} total</span>
                        </div>
                        <div class="storage-bar-track">
                            <div class="storage-bar-fill" style="width: ${pct}%; background-color: ${barColor}"></div>
                        </div>
                    </div>
                </div>
            `;
        }).join('');
    } catch (err) {
        console.error('Failed to load storage quotas:', err);
    }
}

function showUpgradeModal(userId, currentPlan) {
    // Basic prompt for now. In a full system, this would be a custom modal.
    const plans = ['free', 'basic', 'pro', 'enterprise'];
    const plan = prompt(`Upgrade storage for user.\nCurrent plan: ${currentPlan}\nAvailable: free, basic, pro, enterprise\n\nEnter new plan name:`, currentPlan);
    
    if (plan && plans.includes(plan.toLowerCase()) && plan.toLowerCase() !== currentPlan.toLowerCase()) {
        upgradeUserStorage(userId, plan.toLowerCase());
    } else if (plan && !plans.includes(plan.toLowerCase())) {
        showToast('Invalid plan name', 'error');
    }
}

async function upgradeUserStorage(userId, plan) {
    try {
        const res = await apiFetch(`/admin/storage/user/${userId}/upgrade`, {
            method: 'PUT',
            body: JSON.stringify({ plan })
        });
        if (res.ok) {
            showToast(`Storage upgraded to ${plan}`, 'success');
            loadAdminStorageQuotas();
        } else {
            const err = await res.json();
            showToast(err.error || 'Upgrade failed', 'error');
        }
    } catch (e) { showToast('Connection error', 'error'); }
}


// ══════════════════════════════════════════════════════════════
// UTILITIES
// ══════════════════════════════════════════════════════════════

function getFileIcon(mimeType) {
    if (!mimeType) return '📄';
    if (mimeType.startsWith('image/')) return '🖼️';
    if (mimeType.startsWith('video/')) return '🎬';
    if (mimeType.startsWith('audio/')) return '🎵';
    if (mimeType.includes('pdf')) return '📕';
    if (mimeType.includes('word') || mimeType.includes('document')) return '📘';
    if (mimeType.includes('excel') || mimeType.includes('sheet')) return '📗';
    if (mimeType.includes('powerpoint') || mimeType.includes('presentation')) return '📙';
    return '📄';
}

function getMimeShort(mimeType) {
    if (!mimeType) return 'File';
    if (mimeType.startsWith('image/')) return 'Image';
    if (mimeType.startsWith('video/')) return 'Video';
    if (mimeType.startsWith('audio/')) return 'Audio';
    if (mimeType.includes('pdf')) return 'PDF';
    if (mimeType.includes('word') || mimeType.includes('document')) return 'Document';
    if (mimeType.includes('excel') || mimeType.includes('sheet')) return 'Spreadsheet';
    if (mimeType.includes('zip') || mimeType.includes('rar') || mimeType.includes('compressed')) return 'Archive';
    return 'File';
}

function getCategoryClass(category) {
    if (!category) return '';
    const cat = category.toLowerCase().replace(/\s+/g, '_');
    const map = {
        gst: 'gst', itr: 'itr', audit: 'audit', tds: 'tds',
        invoice: 'invoice', receipt: 'receipt', kyc: 'kyc', payroll: 'payroll',
        income_tax: 'income_tax', financials: 'financials', legal: 'legal',
        client_uploads: 'client_uploads', uncategorized: 'uncategorized',
    };
    return map[cat] || 'default';
}

// ══════════════════════════════════════════════════════════════
// TOAST NOTIFICATIONS
// ══════════════════════════════════════════════════════════════

function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const icons = { success: '✓', error: '✕', info: 'ℹ' };

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
        <span class="toast-icon">${icons[type] || icons.info}</span>
        <span class="toast-message">${message}</span>
        <button class="toast-close" onclick="removeToast(this.parentElement)">✕</button>
    `;
    container.appendChild(toast);
    setTimeout(() => removeToast(toast), 4000);
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

// ══════════════════════════════════════════════════════════════
// GOOGLE DRIVE EDITING
// ══════════════════════════════════════════════════════════════

async function openGDriveEdit(fileId, btn) {
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner" style="width:12px;height:12px;border-width:2px;border-color:currentColor transparent transparent transparent; display:inline-block; vertical-align:middle;"></span>';
    }
    try {
        const res = await apiFetch(`/admin/files/gdrive-edit/${fileId}`);
        const data = await res.json();
        if (res.ok && data.drive_web_link) {
            window.open(data.drive_web_link, '_blank');
        } else {
            showToast(data.error || 'Failed to open editor', 'error');
            if (data.detail) alert(data.detail);
        }
    } catch (err) {
        console.error(err);
        showToast('Error opening Google Drive editor', 'error');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '✏️ Edit';
        }
    }
}

// ══════════════════════════════════════════════════════════════
// FILE SHARING
// ══════════════════════════════════════════════════════════════

async function loadShareableUsers() {
    try {
        const res = await apiFetch('/shares/users');
        const data = await res.json();
        shareableUsers = data.users || [];
    } catch (err) {
        console.error('Failed to load shareable users:', err);
    }
}

function showShareModal(fileId, fileName) {
    currentShareFileId = fileId;
    document.getElementById('share-modal-filename').innerHTML =
        `Share <strong>${escapeHtml(fileName)}</strong> with employees or clients.`;
    document.getElementById('share-file-form').reset();

    // Populate user dropdown
    const select = document.getElementById('share-user-select');
    select.innerHTML = '<option value="">Select a user or employee...</option>' +
        shareableUsers.map(u => {
            const label = u.name ? `${u.name} (${u.email})` : u.email;
            const roleTag = u.role === 'employee' ? ' [Employee]' : ' [Client]';
            return `<option value="${u.id}">${escapeHtml(label)}${roleTag}</option>`;
        }).join('');

    // Reset permission radio
    document.querySelectorAll('.permission-option').forEach(opt => opt.classList.remove('active'));
    document.querySelector('.permission-option[data-perm="view"]').classList.add('active');
    document.querySelector('input[name="share-permission"][value="view"]').checked = true;

    // Setup radio click handlers
    document.querySelectorAll('.permission-option').forEach(opt => {
        opt.onclick = () => {
            document.querySelectorAll('.permission-option').forEach(o => o.classList.remove('active'));
            opt.classList.add('active');
            opt.querySelector('input[type="radio"]').checked = true;
        };
    });

    // Load existing shares for this file
    loadFileShares(fileId);

    document.getElementById('share-file-modal').classList.add('visible');
}

function closeShareModal() {
    currentShareFileId = null;
    document.getElementById('share-file-modal').classList.remove('visible');
}

async function loadFileShares(fileId) {
    const section = document.getElementById('active-shares-section');
    const list = document.getElementById('active-shares-list');

    try {
        const res = await apiFetch(`/shares/file/${fileId}`);
        const data = await res.json();
        const shares = data.shares || [];

        if (shares.length === 0) {
            section.style.display = 'none';
            return;
        }

        section.style.display = 'block';
        list.innerHTML = shares.map(s => {
            const permClass = s.permission === 'view' ? 'perm-view' : s.permission === 'edit' ? 'perm-edit' : 'perm-download';
            const permLabel = s.permission === 'view' ? '👁 View' : s.permission === 'edit' ? '✏️ Edit' : '⬇️ Download';
            return `
                <div class="active-share-item">
                    <div class="share-user-info">
                        <div class="share-avatar">${(s.shared_with_email || '?').charAt(0).toUpperCase()}</div>
                        <div>
                            <div class="share-name">${escapeHtml(s.shared_with_name || s.shared_with_email)}</div>
                            <div class="share-email">${escapeHtml(s.shared_with_email)}</div>
                        </div>
                    </div>
                    <div class="share-actions">
                        <span class="perm-badge ${permClass}">${permLabel}</span>
                        <select class="share-perm-select" onchange="updateSharePerm(${s.id}, this.value)">
                            <option value="view" ${s.permission === 'view' ? 'selected' : ''}>View</option>
                            <option value="edit" ${s.permission === 'edit' ? 'selected' : ''}>Edit</option>
                            <option value="download" ${s.permission === 'download' ? 'selected' : ''}>Download</option>
                        </select>
                        <button class="btn-revoke" onclick="revokeFileShare(${s.id})" title="Revoke access">✕</button>
                    </div>
                </div>
            `;
        }).join('');
    } catch (err) {
        console.error('Failed to load file shares:', err);
        section.style.display = 'none';
    }
}

async function handleShareFile(event) {
    event.preventDefault();
    if (!currentShareFileId) return;

    const userId = document.getElementById('share-user-select').value;
    const permission = document.querySelector('input[name="share-permission"]:checked')?.value || 'view';
    const btn = document.getElementById('share-file-btn');

    if (!userId) {
        showToast('Please select a user to share with', 'error');
        return;
    }

    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>';

    try {
        const res = await apiFetch('/shares', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                file_id: currentShareFileId,
                shared_with_user_id: parseInt(userId),
                permission: permission,
            }),
        });
        const data = await res.json();
        if (res.ok) {
            showToast('File shared successfully!', 'success');
            loadFileShares(currentShareFileId);
            loadAllShares();
            document.getElementById('share-user-select').value = '';
        } else {
            showToast(data.error || 'Failed to share file', 'error');
        }
    } catch (err) {
        showToast('Connection error', 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Share File';
    }
}

async function updateSharePerm(shareId, newPermission) {
    try {
        const res = await apiFetch(`/shares/${shareId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ permission: newPermission }),
        });
        if (res.ok) {
            showToast('Permission updated', 'success');
            if (currentShareFileId) loadFileShares(currentShareFileId);
            loadAllShares();
        } else {
            const data = await res.json();
            showToast(data.error || 'Failed to update', 'error');
        }
    } catch (err) {
        showToast('Connection error', 'error');
    }
}

async function revokeFileShare(shareId) {
    if (!confirm('Revoke this share? The user will lose access to this file.')) return;
    try {
        const res = await apiFetch(`/shares/${shareId}`, { method: 'DELETE' });
        if (res.ok) {
            showToast('Share revoked', 'success');
            if (currentShareFileId) loadFileShares(currentShareFileId);
            loadAllShares();
        } else {
            const data = await res.json();
            showToast(data.error || 'Failed to revoke', 'error');
        }
    } catch (err) {
        showToast('Connection error', 'error');
    }
}

async function loadAllShares() {
    try {
        const res = await apiFetch('/shares/all');
        const data = await res.json();
        const shares = data.shares || [];

        const badge = document.getElementById('badge-sharing');
        if (badge) badge.textContent = shares.length;

        const countEl = document.getElementById('sharing-count');
        if (countEl) countEl.textContent = `${shares.length} share${shares.length !== 1 ? 's' : ''}`;

        const tbody = document.getElementById('sharing-tbody');
        const empty = document.getElementById('sharing-empty');

        if (shares.length === 0) {
            if (tbody) tbody.innerHTML = '';
            if (empty) empty.style.display = 'block';
            const table = document.getElementById('sharing-table');
            if (table) table.style.display = 'none';
            return;
        }

        if (empty) empty.style.display = 'none';
        const table = document.getElementById('sharing-table');
        if (table) table.style.display = '';

        if (tbody) {
            tbody.innerHTML = shares.map(s => {
                const permClass = s.permission === 'view' ? 'perm-view' : s.permission === 'edit' ? 'perm-edit' : 'perm-download';
                const permLabel = s.permission === 'view' ? '👁 View Only' : s.permission === 'edit' ? '✏️ Edit' : '⬇️ Download';
                const roleLabel = s.shared_with_role === 'employee' ? '<span class="role-badge employee">Employee</span>' : '<span class="role-badge user">Client</span>';

                return `
                    <tr>
                        <td><div class="table-file-name"><span class="table-file-icon">${getFileIcon(s.file_type)}</span><span class="file-name-text">${escapeHtml(s.file_name)}</span></div></td>
                        <td>
                            <div class="table-user-cell">
                                <div class="table-user-avatar">${(s.shared_with_email || '?').charAt(0).toUpperCase()}</div>
                                <span>${escapeHtml(s.shared_with_name || s.shared_with_email)}</span>
                            </div>
                        </td>
                        <td>${roleLabel}</td>
                        <td><span class="perm-badge ${permClass}">${permLabel}</span></td>
                        <td>${formatDate(s.created_at)}</td>
                        <td>
                            <select class="share-perm-select" onchange="updateSharePerm(${s.id}, this.value)" style="margin-right: 6px;">
                                <option value="view" ${s.permission === 'view' ? 'selected' : ''}>View</option>
                                <option value="edit" ${s.permission === 'edit' ? 'selected' : ''}>Edit</option>
                                <option value="download" ${s.permission === 'download' ? 'selected' : ''}>Download</option>
                            </select>
                            <button class="btn-revoke" onclick="revokeFileShare(${s.id})" title="Revoke">✕</button>
                        </td>
                    </tr>
                `;
            }).join('');
        }
    } catch (err) {
        console.error('Failed to load all shares:', err);
    }
}

// ══════════════════════════════════════════════════════════════
// INLINE CLASSIFICATION (from File Monitor)
// ══════════════════════════════════════════════════════════════

let adminOverrideFileId = null;
let classifyCategories = null;

async function loadClassifyCategories() {
    if (classifyCategories) return classifyCategories;
    try {
        const res = await apiFetch('/classify/categories');
        const data = await res.json();
        classifyCategories = data.categories || [];
        return classifyCategories;
    } catch (err) {
        console.error('Failed to load categories:', err);
        return [];
    }
}

async function classifyFileInline(fileId) {
    showToast('Classifying file...', 'info');
    try {
        const res = await apiFetch(`/classify/analyze`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ file_id: fileId }),
        });
        const data = await res.json();
        if (res.ok) {
            const cat = data.classification?.category || 'UNCATEGORIZED';
            const sub = data.classification?.sub_category || '';
            const conf = data.classification?.confidence || 0;
            showToast(`Classified as ${cat}/${sub} (${conf}% confidence)`, 'success');
            // Refresh the current view
            if (currentAdminFolderId) {
                loadFolderFiles(currentAdminFolderId);
            } else {
                loadAdminFolderBrowser();
            }
        } else {
            showToast(data.error || 'Classification failed', 'error');
        }
    } catch (err) {
        showToast('Connection error', 'error');
        console.error(err);
    }
}

async function openAdminOverride(fileId, fileName) {
    adminOverrideFileId = fileId;
    const cats = await loadClassifyCategories();

    const modal = document.getElementById('admin-override-modal');
    document.getElementById('admin-override-file-name').textContent = fileName;

    // Populate category select
    const catSel = document.getElementById('admin-override-category');
    catSel.innerHTML = '<option value="">Select category...</option>' +
        cats.map(c => `<option value="${c.name}">${c.name} — ${c.display_name}</option>`).join('');

    // Clear sub-category
    const subSel = document.getElementById('admin-override-subcategory');
    subSel.innerHTML = '<option value="">Select sub-category...</option>';

    document.getElementById('admin-override-fy').value = '';

    modal.classList.add('visible');
}

function onAdminOverrideCategoryChange() {
    const catSel = document.getElementById('admin-override-category');
    const subSel = document.getElementById('admin-override-subcategory');
    const category = catSel.value;

    if (!category || !classifyCategories) {
        subSel.innerHTML = '<option value="">Select sub-category...</option>';
        return;
    }

    const catObj = classifyCategories.find(c => c.name === category);
    if (catObj && catObj.sub_categories) {
        subSel.innerHTML = catObj.sub_categories.map(s =>
            `<option value="${s}">${s}</option>`
        ).join('');
    } else {
        subSel.innerHTML = '<option value="">No sub-categories</option>';
    }
}

function closeAdminOverride() {
    document.getElementById('admin-override-modal').classList.remove('visible');
    adminOverrideFileId = null;
}

async function submitAdminOverride() {
    if (!adminOverrideFileId) return;

    const category = document.getElementById('admin-override-category').value;
    const subCategory = document.getElementById('admin-override-subcategory').value;
    const fy = document.getElementById('admin-override-fy').value.trim();

    if (!category || !subCategory) {
        showToast('Please select category and sub-category', 'error');
        return;
    }

    try {
        const res = await apiFetch(`/classify/${adminOverrideFileId}/override`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                category: category,
                sub_category: subCategory,
                financial_year: fy || null,
            }),
        });
        const data = await res.json();
        if (res.ok) {
            const moveMsg = data.moved_to_folder ? ` → Moved to ${data.moved_to_folder} folder` : '';
            showToast(`${data.message}${moveMsg}`, 'success');
            closeAdminOverride();
            // Refresh views
            if (currentAdminFolderId) {
                loadFolderFiles(currentAdminFolderId);
            } else {
                loadAdminFolderBrowser();
            }
            loadAdminDashboard();
        } else {
            showToast(data.error || 'Override failed', 'error');
        }
    } catch (err) {
        showToast('Connection error', 'error');
        console.error(err);
    }
}
