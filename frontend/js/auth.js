/**
 * DAM — Auth page logic (login + signup).
 */

// Redirect to appropriate page if already logged in
if (isAuthenticated()) {
    window.location.href = isAdmin() ? '/admin' : '/dashboard';
}

// ── Tab Switching ──

function switchTab(tab) {
    document.getElementById('tab-login').classList.toggle('active', tab === 'login');
    document.getElementById('tab-signup').classList.toggle('active', tab === 'signup');
    document.getElementById('form-login').classList.toggle('active', tab === 'login');
    document.getElementById('form-signup').classList.toggle('active', tab === 'signup');
    hideError();
}

// ── Error Display ──

function showError(message) {
    const el = document.getElementById('auth-error');
    el.textContent = message;
    el.classList.add('visible');
}

function hideError() {
    document.getElementById('auth-error').classList.remove('visible');
}

// ── Login Handler ──

async function handleLogin(event) {
    event.preventDefault();
    hideError();

    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;
    const btn = document.getElementById('login-btn');

    if (!email || !password) {
        showError('Please fill in all fields.');
        return;
    }

    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Signing in...';

    try {
        const res = await apiFetch('/auth/login', {
            method: 'POST',
            body: JSON.stringify({ email, password }),
        });

        const data = await res.json();

        if (!res.ok) {
            showError(data.error || 'Login failed.');
            return;
        }

        // Store token + user (now includes role)
        localStorage.setItem('dam_token', data.token);
        localStorage.setItem('dam_user', JSON.stringify(data.user));

        // Redirect based on role
        const role = data.user.role || 'user';
        window.location.href = role === 'admin' ? '/admin' : '/dashboard';
    } catch (err) {
        showError('Connection error. Please try again.');
        console.error(err);
    } finally {
        btn.disabled = false;
        btn.textContent = 'Sign In';
    }
}

// ── Signup Handler ──

async function handleSignup(event) {
    event.preventDefault();
    hideError();

    const email = document.getElementById('signup-email').value.trim();
    const password = document.getElementById('signup-password').value;
    const confirm = document.getElementById('signup-confirm').value;
    const btn = document.getElementById('signup-btn');

    if (!email || !password || !confirm) {
        showError('Please fill in all fields.');
        return;
    }

    if (password.length < 6) {
        showError('Password must be at least 6 characters.');
        return;
    }

    if (password !== confirm) {
        showError('Passwords do not match.');
        return;
    }

    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Creating account...';

    try {
        const res = await apiFetch('/auth/signup', {
            method: 'POST',
            body: JSON.stringify({ email, password }),
        });

        const data = await res.json();

        if (!res.ok) {
            showError(data.error || 'Signup failed.');
            return;
        }

        // Store token + user (now includes role)
        localStorage.setItem('dam_token', data.token);
        localStorage.setItem('dam_user', JSON.stringify(data.user));

        // Redirect based on role
        const role = data.user.role || 'user';
        window.location.href = role === 'admin' ? '/admin' : '/dashboard';
    } catch (err) {
        showError('Connection error. Please try again.');
        console.error(err);
    } finally {
        btn.disabled = false;
        btn.textContent = 'Create Account';
    }
}
