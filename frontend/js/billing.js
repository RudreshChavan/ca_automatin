/**
 * Billing Dashboard — JS Logic
 */

// ── Auth Guard ──
(function() {
    if (!isAuthenticated()) { window.location.href = '/'; return; }
    if (!isAdmin()) { window.location.href = '/dashboard'; return; }
    const user = getStoredUser();
    if (user) {
        document.getElementById('user-name').textContent = user.name || user.email.split('@')[0];
        document.getElementById('user-email').textContent = user.email;
        document.getElementById('user-avatar').textContent = (user.name || user.email)[0].toUpperCase();
    }
    loadBillingDashboard();
})();

let allClients = [];

// ── View Switching ──
function switchBillingView(view, btn) {
    document.querySelectorAll('.billing-view').forEach(v => v.classList.remove('active'));
    document.querySelectorAll('.sidebar-item').forEach(b => b.classList.remove('active'));
    document.getElementById('view-' + view).classList.add('active');
    if (btn) btn.classList.add('active');
    const titles = { overview: 'Billing Dashboard', clients: 'Client Billing', revenue: 'Monthly Revenue' };
    document.getElementById('page-title').textContent = titles[view] || 'Billing';
    if (view === 'clients') loadClientBilling();
    if (view === 'revenue') loadRevenueTable();
}

// ── Load Dashboard ──
async function loadBillingDashboard() {
    try {
        const res = await apiFetch('/admin/billing-dashboard');
        const data = await res.json();
        document.getElementById('stat-total-billed').textContent = '₹' + formatAmount(data.total_billed);
        document.getElementById('stat-collected').textContent = '₹' + formatAmount(data.total_collected);
        document.getElementById('stat-outstanding').textContent = '₹' + formatAmount(data.total_outstanding);
        document.getElementById('stat-this-month').textContent = '₹' + formatAmount(data.this_month_received);
        renderRevenueChart(data.monthly_revenue || []);
        loadRecentPayments();
        loadUsersList();
    } catch (e) {
        console.error('Failed to load billing dashboard:', e);
    }
}

function formatAmount(num) {
    if (!num) return '0';
    return Number(num).toLocaleString('en-IN', { maximumFractionDigits: 0 });
}

// ── Revenue Chart ──
function renderRevenueChart(data) {
    const container = document.getElementById('revenue-chart');
    if (!data || data.length === 0) {
        container.innerHTML = '<div class="empty-state"><div class="empty-icon">📈</div><h3>No revenue data yet</h3></div>';
        return;
    }
    const months = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const maxVal = Math.max(...data.map(d => d.total || 0), 1);
    const reversed = [...data].reverse();
    container.innerHTML = '<div class="chart-bars">' + reversed.map(d => {
        const pct = Math.max(((d.total || 0) / maxVal) * 100, 2);
        const collPct = d.total > 0 ? ((d.collected || 0) / d.total) * 100 : 0;
        return `<div class="chart-bar-col">
            <div class="chart-bar-wrapper">
                <div class="chart-bar" style="height:${pct}%">
                    <div class="chart-bar-collected" style="height:${collPct}%"></div>
                </div>
            </div>
            <div class="chart-label">${months[d.month] || d.month}</div>
            <div class="chart-value">₹${formatAmount(d.total)}</div>
        </div>`;
    }).join('') + '</div><div class="chart-legend"><span class="legend-item"><span class="legend-color" style="background:var(--primary-500)"></span>Collected</span><span class="legend-item"><span class="legend-color" style="background:var(--primary-200)"></span>Outstanding</span></div>';
}

// ── Recent Payments ──
async function loadRecentPayments() {
    try {
        const res = await apiFetch('/admin/payments');
        const data = await res.json();
        const tbody = document.getElementById('recent-payments-tbody');
        const payments = (data.payments || []).slice(0, 10);
        if (payments.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" class="table-empty">No payments recorded yet</td></tr>';
            return;
        }
        tbody.innerHTML = payments.map(p => `<tr>
            <td>${escapeHtml(p.user_name || p.user_email)}</td>
            <td class="amount-cell">₹${formatAmount(p.amount)}</td>
            <td>${p.payment_method ? p.payment_method.toUpperCase() : '—'}</td>
            <td><span class="status-badge status-${p.status}">${p.status === 'received' ? '✅ Received' : '⏳ Pending'}</span></td>
            <td>${formatDate(p.created_at)}</td>
        </tr>`).join('');
    } catch (e) { console.error(e); }
}

// ── Client Billing ──
async function loadClientBilling() {
    try {
        const res = await apiFetch('/admin/billing/overview');
        const data = await res.json();
        const tbody = document.getElementById('client-billing-tbody');
        const overview = data.overview || [];
        if (overview.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" class="table-empty">No billing data yet</td></tr>';
            return;
        }
        tbody.innerHTML = overview.map(c => `<tr>
            <td><strong>${escapeHtml(c.user_name || c.user_email)}</strong><br><span style="color:var(--text-tertiary);font-size:0.8rem;">${escapeHtml(c.user_email)}</span></td>
            <td class="amount-cell">₹${formatAmount(c.total_billed)}</td>
            <td class="amount-cell" style="color:var(--success-400)">₹${formatAmount(c.total_paid)}</td>
            <td class="amount-cell" style="color:var(--warning-400)">₹${formatAmount(c.total_pending)}</td>
            <td>${c.service_count}</td>
            <td><button class="btn btn-ghost btn-sm" onclick="viewClientBillingDetail(${c.user_id})">View</button></td>
        </tr>`).join('');
    } catch (e) { console.error(e); }
}

async function viewClientBillingDetail(userId) {
    showToast('Loading client billing details...', 'info');
    // Could navigate to a detail view - for now show toast
}

// ── Revenue Table ──
async function loadRevenueTable() {
    try {
        const res = await apiFetch('/admin/billing/revenue');
        const data = await res.json();
        const tbody = document.getElementById('revenue-tbody');
        const revenue = data.revenue || [];
        const months = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        if (revenue.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" class="table-empty">No revenue data yet</td></tr>';
            return;
        }
        tbody.innerHTML = revenue.map(r => `<tr>
            <td><strong>${months[r.month]} ${r.year}</strong></td>
            <td class="amount-cell">₹${formatAmount(r.total)}</td>
            <td class="amount-cell" style="color:var(--success-400)">₹${formatAmount(r.collected)}</td>
            <td class="amount-cell" style="color:var(--warning-400)">₹${formatAmount(r.outstanding)}</td>
            <td>${r.service_count}</td>
        </tr>`).join('');
    } catch (e) { console.error(e); }
}

// ── Users List (for dropdowns) ──
async function loadUsersList() {
    try {
        const res = await apiFetch('/admin/users');
        const data = await res.json();
        allClients = (data.users || []).filter(u => u.role === 'user');
        populateClientDropdowns();
    } catch (e) { console.error(e); }
}

function populateClientDropdowns() {
    ['service-client', 'payment-client'].forEach(id => {
        const sel = document.getElementById(id);
        if (!sel) return;
        const current = sel.value;
        sel.innerHTML = '<option value="">Select client...</option>' + allClients.map(u =>
            `<option value="${u.id}">${escapeHtml(u.name || u.email)}</option>`
        ).join('');
        sel.value = current;
    });
}

// ── Add Service Charge ──
function showAddServiceModal() { document.getElementById('add-service-modal').classList.add('visible'); }
function closeAddServiceModal() { document.getElementById('add-service-modal').classList.remove('visible'); document.getElementById('add-service-form').reset(); }

async function handleAddService(e) {
    e.preventDefault();
    const userId = document.getElementById('service-client').value;
    const serviceName = document.getElementById('service-name').value;
    const amount = document.getElementById('service-amount').value;
    const period = document.getElementById('service-period').value;
    const notes = document.getElementById('service-notes').value;
    try {
        const res = await apiFetch('/admin/billing/service', {
            method: 'POST',
            body: JSON.stringify({ user_id: parseInt(userId), service_name: serviceName, amount: parseFloat(amount), billing_period: period, notes })
        });
        if (res.ok) {
            showToast('Service charge added successfully', 'success');
            closeAddServiceModal();
            loadBillingDashboard();
        } else {
            const err = await res.json();
            showToast(err.error || 'Failed to add charge', 'error');
        }
    } catch (e) { showToast('Error: ' + e.message, 'error'); }
}

// ── Record Payment ──
function showRecordPaymentModal() { document.getElementById('record-payment-modal').classList.add('visible'); }
function closeRecordPaymentModal() { document.getElementById('record-payment-modal').classList.remove('visible'); document.getElementById('record-payment-form').reset(); }

async function handleRecordPayment(e) {
    e.preventDefault();
    const userId = document.getElementById('payment-client').value;
    const amount = document.getElementById('payment-amount').value;
    const method = document.getElementById('payment-method').value;
    const reference = document.getElementById('payment-reference').value;
    const status = document.getElementById('payment-status').value;
    const desc = document.getElementById('payment-desc').value;
    try {
        const res = await apiFetch('/admin/payment', {
            method: 'POST',
            body: JSON.stringify({ user_id: parseInt(userId), amount: parseFloat(amount), payment_method: method, reference_number: reference, status, description: desc })
        });
        if (res.ok) {
            showToast('Payment recorded successfully', 'success');
            closeRecordPaymentModal();
            loadBillingDashboard();
        } else {
            const err = await res.json();
            showToast(err.error || 'Failed to record payment', 'error');
        }
    } catch (e) { showToast('Error: ' + e.message, 'error'); }
}

// ── Sidebar toggle ──
function toggleSidebar() {
    document.getElementById('sidebar').classList.toggle('open');
    document.getElementById('sidebar-overlay').classList.toggle('active');
}

// ── Logout ──
function logout() {
    localStorage.removeItem('dam_token');
    localStorage.removeItem('dam_user');
    window.location.href = '/';
}

// ── Toast ──
function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => toast.classList.add('show'), 10);
    setTimeout(() => { toast.classList.remove('show'); setTimeout(() => toast.remove(), 300); }, 3000);
}
