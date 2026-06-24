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

// Sidebar responsiveness toggle (Mobile & Desktop)
function setupMobileNav() {
    const toggleBtn = document.getElementById('mobileToggle');
    const sidebar = document.querySelector('.sidebar');
    const layout = document.querySelector('.admin-layout');
    
    if (toggleBtn && sidebar && layout) {
        toggleBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (window.innerWidth <= 768) {
                sidebar.classList.toggle('active');
            } else {
                layout.classList.toggle('sidebar-hidden');
                // Optional: Save preference to localStorage
                const isHidden = layout.classList.contains('sidebar-hidden');
                localStorage.setItem('sidebarHidden', isHidden);
            }
        });

        // Close sidebar on tapping elsewhere (mobile only)
        document.addEventListener('click', (e) => {
            if (window.innerWidth <= 768 && sidebar.classList.contains('active') && !sidebar.contains(e.target) && !toggleBtn.contains(e.target)) {
                sidebar.classList.remove('active');
            }
        });

        // Load preference on desktop
        if (window.innerWidth > 768 && localStorage.getItem('sidebarHidden') === 'true') {
            layout.classList.add('sidebar-hidden');
        }
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
