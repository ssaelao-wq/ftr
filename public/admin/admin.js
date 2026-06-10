// public/admin/admin.js - Shared JS Logic for FTR Admin Portal

document.addEventListener('DOMContentLoaded', () => {
    // 1. Authenticate user session
    checkSession();

    // 2. Setup Mobile Navigation Toggle
    setupMobileNav();

    // 3. Highlight Active Sidebar Links
    highlightActiveLink();
});

// Check session API
async function checkSession() {
    const isLoginPage = window.location.pathname.endsWith('login.html');
    
    try {
        const response = await fetch('/api/admin/auth/me');
        if (!response.ok) {
            if (!isLoginPage) {
                window.location.href = '/admin/login.html';
            }
        } else {
            const data = await response.json();
            if (isLoginPage) {
                window.location.href = '/admin/dashboard.html';
            } else {
                updateUserWidget(data.admin);
            }
        }
    } catch (err) {
        console.error('Session check failed:', err);
        if (!isLoginPage) {
            window.location.href = '/admin/login.html';
        }
    }
}

// Update UI widget with user profile info
function updateUserWidget(admin) {
    const widget = document.getElementById('userWidget');
    if (widget && admin) {
        const firstLetter = admin.username.charAt(0).toUpperCase();
        widget.innerHTML = `
            <div class="user-avatar">${firstLetter}</div>
            <span>${admin.username}</span>
            <button onclick="handleLogout()" class="btn btn-secondary" style="padding: 0.3rem 0.75rem; font-size: 0.8rem; border-radius: 9999px; margin-left: 0.5rem;">Logout</button>
        `;
    }
}

// Global logout function
async function handleLogout() {
    try {
        const response = await fetch('/api/admin/auth/logout', { method: 'POST' });
        if (response.ok) {
            window.location.href = '/admin/login.html';
        } else {
            alert('Logout failed. Please try again.');
        }
    } catch (err) {
        console.error('Logout error:', err);
        alert('Connection error. Please try again.');
    }
}

// Mobile sidebar responsiveness toggle
function setupMobileNav() {
    const toggleBtn = document.getElementById('mobileToggle');
    const sidebar = document.querySelector('.sidebar');
    
    if (toggleBtn && sidebar) {
        toggleBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            sidebar.classList.toggle('active');
        });

        // Close sidebar on tapping elsewhere
        document.addEventListener('click', (e) => {
            if (sidebar.classList.contains('active') && !sidebar.contains(e.target)) {
                sidebar.classList.remove('active');
            }
        });
    }
}

// Sidebar links highlight
function highlightActiveLink() {
    const path = window.location.pathname;
    const links = document.querySelectorAll('.sidebar-link');
    links.forEach(link => {
        const href = link.getAttribute('href');
        if (href && path.includes(href)) {
            link.classList.add('active');
        } else {
            link.classList.remove('active');
        }
    });
}
