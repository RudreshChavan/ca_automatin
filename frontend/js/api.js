/**
 * DAM — API wrapper with JWT injection.
 */

const API_BASE = window.location.origin + '/api';

/**
 * Wrapper around fetch that auto-injects the JWT bearer token.
 * Redirects to login on 401.
 */
async function apiFetch(url, options = {}) {
    const token = localStorage.getItem('dam_token');

    const headers = {
        ...(options.headers || {}),
    };

    // Don't set Content-Type for FormData (browser sets boundary automatically)
    if (!(options.body instanceof FormData)) {
        headers['Content-Type'] = headers['Content-Type'] || 'application/json';
    }

    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch(`${API_BASE}${url}`, {
        ...options,
        headers,
    });

    // Auto-redirect to login on auth failure
    if (response.status === 401) {
        localStorage.removeItem('dam_token');
        localStorage.removeItem('dam_user');
        
        // Only throw and redirect if it's not the login route itself
        if (!url.includes('/auth/login')) {
            if (!window.location.pathname.includes('index') && window.location.pathname !== '/') {
                window.location.href = '/';
            }
            throw new Error('Session expired. Please log in again.');
        }
    }

    return response;
}

/**
 * Check if user is authenticated (has a valid token stored).
 */
function isAuthenticated() {
    return !!localStorage.getItem('dam_token');
}

/**
 * Get stored user info.
 */
function getStoredUser() {
    try {
        return JSON.parse(localStorage.getItem('dam_user'));
    } catch {
        return null;
    }
}

/**
 * Get the stored user's role.
 */
function getStoredUserRole() {
    const user = getStoredUser();
    return user ? (user.role || 'user') : 'user';
}

/**
 * Check if the current user is an admin.
 */
function isAdmin() {
    return getStoredUserRole() === 'admin';
}

/**
 * Format file size to human-readable string.
 */
function formatFileSize(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return (bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0) + ' ' + units[i];
}

/**
 * Format date to relative or readable string, with optional time.
 */
function formatDate(dateStr, includeTime = false) {
    if (!dateStr) return '';
    const safeDateStr = String(dateStr).replace(' ', 'T'); // Fix SQL Server Datetime parsing
    const date = new Date(safeDateStr);
    
    if (isNaN(date.getTime())) return dateStr; // Fallback

    const now = new Date();
    const diffMs = now - date;
    
    // If it's a future date or time is explicitly requested, don't use relative 'ago' format
    if (diffMs < 0 || includeTime) {
        let opts = { month: 'short', day: 'numeric', year: 'numeric' };
        if (includeTime) {
            opts.hour = 'numeric';
            opts.minute = '2-digit';
        }
        return date.toLocaleDateString('en-US', opts);
    }

    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;

    let opts = { month: 'short', day: 'numeric', year: 'numeric' };
    if (includeTime) {
        opts.hour = 'numeric';
        opts.minute = '2-digit';
    }
    return date.toLocaleDateString('en-US', opts);
}

/**
 * Escape HTML special characters to prevent XSS.
 */
function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

/**
 * Append JWT token to a URL for direct links (e.g., file downloads).
 */
function getAuthLink(url) {
    if (!url) return '#';
    if (url.startsWith('http')) return url;
    
    const token = localStorage.getItem('dam_token');
    if (!token) return url;
    
    const separator = url.includes('?') ? '&' : '?';
    return `${url}${separator}token=${token}`;
}
