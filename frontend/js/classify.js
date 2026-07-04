/**
 * Document Classification Dashboard — JavaScript
 * Handles stats, review queue, logs, categories, and override actions.
 */

// ═══════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════

let clfCategories = {};       // { category: { display_name, sub_categories[] } }
let clfAllLogs = [];          // All classification log entries
let clfOverrideFileId = null; // File ID being overridden

// ═══════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', () => {
    if (!isAuthenticated() || !isAdmin()) {
        window.location.href = '/';
        return;
    }

    // Set user info
    const user = getStoredUser();
    if (user) {
        document.getElementById('clf-user-email').textContent = user.email || 'Admin';
    }

    // Load initial data
    loadCategories();
    loadDashboard();
});


// ═══════════════════════════════════════════════════════════
// NAVIGATION
// ═══════════════════════════════════════════════════════════

function switchClfView(viewName, btn) {
    // Hide all views
    document.querySelectorAll('.clf-view').forEach(v => {
        v.style.display = 'none';
        v.classList.remove('active');
    });

    // Deactivate all nav items
    document.querySelectorAll('.classify-sidebar .sidebar-item').forEach(i => i.classList.remove('active'));

    // Show selected view
    const view = document.getElementById(`clf-view-${viewName}`);
    if (view) {
        view.style.display = 'block';
        view.classList.add('active');
    }

    if (btn) btn.classList.add('active');

    // Update title
    const titles = {
        'dashboard': 'Classification Dashboard',
        'review': 'Manual Review Queue',
        'logs': 'All Classifications',
        'categories': 'Classification Categories',
    };
    document.getElementById('clf-page-title').textContent = titles[viewName] || 'Classifier';

    // Load data for the view
    if (viewName === 'dashboard') loadDashboard();
    if (viewName === 'review') loadReviewQueue();
    if (viewName === 'logs') loadClassificationLogs();
    if (viewName === 'categories') renderCategoriesView();
}

function toggleClfSidebar() {
    const sidebar = document.getElementById('clf-sidebar');
    const overlay = document.getElementById('clf-sidebar-overlay');
    sidebar.classList.toggle('open');
    overlay.classList.toggle('active');
}


// ═══════════════════════════════════════════════════════════
// LOAD DATA
// ═══════════════════════════════════════════════════════════

async function loadCategories() {
    try {
        const res = await apiFetch('/classify/categories');
        if (res.ok) {
            const data = await res.json();
            clfCategories = data.categories || {};
            populateCategoryFilter();
            populateOverrideCategorySelect();
        }
    } catch (e) {
        console.error('Failed to load categories:', e);
    }
}

async function loadDashboard() {
    try {
        const res = await apiFetch('/classify/stats');
        if (!res.ok) return;
        const data = await res.json();

        // Stats
        document.getElementById('clf-stat-total').textContent = data.total_classified || 0;
        document.getElementById('clf-stat-review').textContent = data.pending_review || 0;
        document.getElementById('clf-badge-review').textContent = data.pending_review || 0;

        const conf = data.confidence_distribution || {};
        document.getElementById('clf-stat-high-conf').textContent = conf.high || 0;
        document.getElementById('clf-stat-low-conf').textContent = (conf.low || 0) + (conf.very_low || 0);

        // Category distribution
        renderCategoryDistribution(data.by_category || {});

        // Recent classifications
        renderRecentTable(data.recent || []);
    } catch (e) {
        console.error('Failed to load dashboard:', e);
    }
}

async function loadReviewQueue() {
    try {
        const res = await apiFetch('/classify/review-queue');
        if (!res.ok) return;
        const data = await res.json();
        const files = data.files || [];

        document.getElementById('review-count-badge').textContent = `${files.length} file${files.length !== 1 ? 's' : ''}`;

        const grid = document.getElementById('review-cards-grid');
        const empty = document.getElementById('review-empty');

        if (files.length === 0) {
            grid.innerHTML = '';
            empty.style.display = 'block';
            return;
        }

        empty.style.display = 'none';
        grid.innerHTML = files.map(f => renderReviewCard(f)).join('');
    } catch (e) {
        console.error('Failed to load review queue:', e);
    }
}

async function loadClassificationLogs() {
    try {
        const res = await apiFetch('/classify/logs');
        if (!res.ok) return;
        const data = await res.json();
        clfAllLogs = data.logs || [];

        // Apply filter
        const filter = document.getElementById('clf-log-filter').value;
        let filtered = clfAllLogs;
        if (filter) {
            filtered = clfAllLogs.filter(l => l.category === filter);
        }

        renderLogsTable(filtered);
    } catch (e) {
        console.error('Failed to load logs:', e);
    }
}


// ═══════════════════════════════════════════════════════════
// RENDER FUNCTIONS
// ═══════════════════════════════════════════════════════════

function getConfidenceClass(score) {
    if (score >= 90) return 'high';
    if (score >= 70) return 'medium';
    if (score >= 50) return 'low';
    return 'very-low';
}

function renderCategoryDistribution(byCategory) {
    const grid = document.getElementById('clf-category-grid');
    const entries = Object.entries(byCategory);

    if (entries.length === 0) {
        grid.innerHTML = `
            <div class="clf-empty-state" style="grid-column: 1/-1;">
                <div class="empty-icon">📊</div>
                <h3>No classifications yet</h3>
                <p>Upload files or click "Re-classify All" to start.</p>
            </div>`;
        return;
    }

    grid.innerHTML = entries.map(([cat, count]) => `
        <div class="category-dist-item">
            <div class="cat-count">${count}</div>
            <div class="cat-name">${cat}</div>
            <div style="margin-top: 6px;">
                <span class="category-badge ${cat}">${cat}</span>
            </div>
        </div>
    `).join('');
}

function renderRecentTable(recent) {
    const tbody = document.getElementById('clf-recent-tbody');
    if (recent.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="table-empty">No classifications yet</td></tr>';
        return;
    }

    tbody.innerHTML = recent.map(r => {
        const confClass = getConfidenceClass(r.confidence_score);
        return `
            <tr>
                <td title="${escapeHtml(r.file_name)}">${escapeHtml(truncate(r.file_name, 35))}</td>
                <td><span class="category-badge ${r.category}">${r.category}</span></td>
                <td>${r.sub_category}</td>
                <td>
                    <div class="confidence-bar-container" style="width: 80px;">
                        <div class="confidence-bar ${confClass}" style="width: ${r.confidence_score}%"></div>
                    </div>
                    <span class="confidence-score ${confClass}">${r.confidence_score}%</span>
                </td>
                <td style="font-size: 0.78rem; color: var(--text-tertiary);">${escapeHtml(r.user_email || '')}</td>
                <td style="font-size: 0.78rem; color: var(--text-tertiary);">${formatDate(r.created_at)}</td>
            </tr>
        `;
    }).join('');
}

function renderReviewCard(f) {
    const confClass = getConfidenceClass(f.confidence_score);
    return `
        <div class="review-card" id="review-card-${f.file_id}">
            <div class="review-card-header">
                <div class="review-card-file">
                    <h4 title="${escapeHtml(f.file_name)}">${escapeHtml(f.file_name)}</h4>
                    <p>${escapeHtml(f.user_email || '')} • ${formatFileSize(f.file_size)}</p>
                </div>
                <span class="needs-review-badge">⚠ Needs Review</span>
            </div>
            <div class="review-card-meta">
                <span>🏷️ <span class="category-badge ${f.category}">${f.category}</span></span>
                <span>📂 ${f.sub_category}</span>
                ${f.financial_year ? `<span>📅 ${f.financial_year}</span>` : ''}
                <span>📡 ${f.source || 'filename'}</span>
            </div>
            <div class="review-card-confidence">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                    <span style="font-size: 0.75rem; color: var(--text-tertiary);">Confidence</span>
                    <span class="confidence-score ${confClass}">${f.confidence_score}%</span>
                </div>
                <div class="confidence-bar-container">
                    <div class="confidence-bar ${confClass}" style="width: ${f.confidence_score}%"></div>
                </div>
            </div>
            ${f.suggested_name ? `<div style="font-size: 0.75rem; color: var(--text-tertiary); margin-bottom: var(--sp-3);">
                💡 Suggested: <strong>${escapeHtml(f.suggested_name)}</strong>
            </div>` : ''}
            <div class="review-card-actions">
                <button class="btn btn-secondary btn-sm" onclick="openOverrideModal(${f.file_id}, '${escapeHtml(f.file_name)}')">
                    ✏️ Override
                </button>
                <button class="btn btn-primary btn-sm" onclick="approveClassification(${f.file_id}, ${f.log_id})">
                    ✅ Approve
                </button>
            </div>
        </div>
    `;
}

function renderLogsTable(logs) {
    const tbody = document.getElementById('clf-logs-tbody');
    if (logs.length === 0) {
        tbody.innerHTML = '<tr><td colspan="9" class="table-empty">No classification logs found</td></tr>';
        return;
    }

    tbody.innerHTML = logs.map(l => {
        const confClass = getConfidenceClass(l.confidence_score);
        const statusBadge = l.reviewed
            ? '<span class="reviewed-badge">✅ Reviewed</span>'
            : (l.needs_review
                ? '<span class="needs-review-badge">⚠ Needs Review</span>'
                : '<span class="reviewed-badge">✅ Auto</span>');

        return `
            <tr>
                <td title="${escapeHtml(l.file_name)}">${escapeHtml(truncate(l.file_name, 30))}</td>
                <td><span class="category-badge ${l.category}">${l.category}</span></td>
                <td>${l.sub_category}</td>
                <td style="font-size: 0.78rem;">${l.financial_year || '—'}</td>
                <td>
                    <div class="confidence-bar-container" style="width: 70px;">
                        <div class="confidence-bar ${confClass}" style="width: ${l.confidence_score}%"></div>
                    </div>
                    <span class="confidence-score ${confClass}">${l.confidence_score}%</span>
                </td>
                <td>${statusBadge}</td>
                <td style="font-size: 0.75rem; color: var(--text-tertiary);">${escapeHtml(l.user_email || '')}</td>
                <td style="font-size: 0.75rem; color: var(--text-tertiary);">${formatDate(l.created_at)}</td>
                <td>
                    <button class="btn btn-ghost btn-sm" onclick="openOverrideModal(${l.file_id}, '${escapeHtml(l.file_name)}')">
                        ✏️
                    </button>
                </td>
            </tr>
        `;
    }).join('');
}

function renderCategoriesView() {
    const container = document.getElementById('clf-categories-list');
    const entries = Object.entries(clfCategories);

    if (entries.length === 0) {
        container.innerHTML = '<div class="clf-loading"><div class="clf-spinner"></div> Loading...</div>';
        return;
    }

    container.innerHTML = entries.map(([cat, info]) => `
        <div style="margin-bottom: var(--sp-5);">
            <div style="display: flex; align-items: center; gap: var(--sp-3); margin-bottom: var(--sp-3);">
                <span class="category-badge ${cat}" style="font-size: 0.8rem; padding: 5px 14px;">${cat}</span>
                <span style="font-size: 0.85rem; color: var(--text-secondary);">${info.display_name}</span>
            </div>
            <div style="display: flex; flex-wrap: wrap; gap: var(--sp-2); padding-left: var(--sp-4);">
                ${info.sub_categories.map(sub => `
                    <span style="padding: 4px 12px; background: var(--bg-surface); border: 1px solid var(--border-subtle); border-radius: var(--radius-full); font-size: 0.75rem; color: var(--text-secondary);">
                        ${sub}
                    </span>
                `).join('')}
            </div>
        </div>
    `).join('');
}


// ═══════════════════════════════════════════════════════════
// ACTIONS
// ═══════════════════════════════════════════════════════════

async function approveClassification(fileId, logId) {
    try {
        const res = await apiFetch(`/classify/${fileId}/approve`, {
            method: 'POST',
        });
        if (res.ok) {
            showToast('Classification approved', 'success');
            // Remove card from grid
            const card = document.getElementById(`review-card-${fileId}`);
            if (card) {
                card.style.opacity = '0';
                card.style.transform = 'scale(0.95)';
                setTimeout(() => card.remove(), 300);
            }
            // Update badge count
            const badge = document.getElementById('clf-badge-review');
            const current = parseInt(badge.textContent) || 0;
            if (current > 0) badge.textContent = current - 1;
        } else {
            const err = await res.json();
            showToast(err.error || 'Failed to approve', 'error');
        }
    } catch (e) {
        showToast('Network error', 'error');
    }
}

async function reclassifyAllFiles() {
    if (!confirm('This will re-classify ALL files in the database. Continue?')) return;

    const btn = document.getElementById('reclassify-all-btn');
    btn.disabled = true;
    btn.textContent = '⏳ Processing...';

    const progress = document.getElementById('reclassify-progress');
    progress.classList.add('active');
    document.getElementById('reclassify-progress-text').textContent = 'Re-classifying all files...';

    try {
        const res = await apiFetch('/classify/reclassify-all', { method: 'POST' });
        const data = await res.json();
        if (res.ok) {
            showToast(`Done! ${data.classified} files classified, ${data.errors} errors.`, 'success');
            document.getElementById('reclassify-progress-text').textContent =
                `✅ Complete: ${data.classified}/${data.total_files} classified.`;
            loadDashboard();
        } else {
            showToast(data.error || 'Failed', 'error');
        }
    } catch (e) {
        showToast('Network error', 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = '🔄 Re-classify All';
        setTimeout(() => progress.classList.remove('active'), 5000);
    }
}


// ═══════════════════════════════════════════════════════════
// OVERRIDE MODAL
// ═══════════════════════════════════════════════════════════

function populateCategoryFilter() {
    const select = document.getElementById('clf-log-filter');
    for (const cat of Object.keys(clfCategories)) {
        const opt = document.createElement('option');
        opt.value = cat;
        opt.textContent = cat;
        select.appendChild(opt);
    }
}

function populateOverrideCategorySelect() {
    const select = document.getElementById('override-category');
    select.innerHTML = '<option value="">Select category...</option>';
    for (const [cat, info] of Object.entries(clfCategories)) {
        const opt = document.createElement('option');
        opt.value = cat;
        opt.textContent = `${cat} — ${info.display_name}`;
        select.appendChild(opt);
    }
}

function updateSubCategoryOptions() {
    const cat = document.getElementById('override-category').value;
    const subSelect = document.getElementById('override-subcategory');
    subSelect.innerHTML = '<option value="">Select sub-category...</option>';

    if (cat && clfCategories[cat]) {
        for (const sub of clfCategories[cat].sub_categories) {
            const opt = document.createElement('option');
            opt.value = sub;
            opt.textContent = sub;
            subSelect.appendChild(opt);
        }
    }
}

function openOverrideModal(fileId, fileName) {
    clfOverrideFileId = fileId;
    document.getElementById('override-modal-filename').textContent = `Override classification for: ${fileName}`;
    document.getElementById('override-modal').classList.add('active');
}

function closeOverrideModal() {
    document.getElementById('override-modal').classList.remove('active');
    clfOverrideFileId = null;
    document.getElementById('override-form').reset();
}

async function handleOverride(e) {
    e.preventDefault();
    if (!clfOverrideFileId) return;

    const category = document.getElementById('override-category').value;
    const subCategory = document.getElementById('override-subcategory').value;
    const fy = document.getElementById('override-fy').value.trim();

    try {
        const res = await apiFetch(`/classify/${clfOverrideFileId}/override`, {
            method: 'POST',
            body: JSON.stringify({ category, sub_category: subCategory, financial_year: fy || null }),
        });

        if (res.ok) {
            showToast('Classification overridden successfully', 'success');
            closeOverrideModal();
            // Refresh current view
            const reviewView = document.getElementById('clf-view-review');
            if (reviewView.style.display !== 'none') loadReviewQueue();
            const logsView = document.getElementById('clf-view-logs');
            if (logsView.style.display !== 'none') loadClassificationLogs();
            loadDashboard();
        } else {
            const err = await res.json();
            showToast(err.error || 'Failed to override', 'error');
        }
    } catch (e) {
        showToast('Network error', 'error');
    }
}


// ═══════════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════════

function truncate(str, len) {
    if (!str) return '';
    return str.length > len ? str.substring(0, len) + '…' : str;
}

function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.style.cssText = `
        padding: var(--sp-3) var(--sp-5);
        border-radius: var(--radius-md);
        font-size: 0.85rem;
        font-weight: 500;
        color: #fff;
        animation: fadeSlideUp 0.3s ease-out;
        margin-bottom: var(--sp-2);
        max-width: 400px;
        box-shadow: var(--shadow-lg);
    `;

    if (type === 'success') toast.style.background = 'var(--accent-500)';
    else if (type === 'error') toast.style.background = 'var(--danger-500)';
    else toast.style.background = 'var(--primary-500)';

    toast.textContent = message;
    container.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(-10px)';
        toast.style.transition = 'all 0.3s ease';
        setTimeout(() => toast.remove(), 300);
    }, 3500);
}

function logout() {
    localStorage.removeItem('dam_token');
    localStorage.removeItem('dam_user');
    window.location.href = '/';
}
