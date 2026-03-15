// Panelist Main Script

document.addEventListener('DOMContentLoaded', () => {
    checkPanelistAuth();
    initializeEventListeners();
});

function checkPanelistAuth() {
    const token = localStorage.getItem('panelistToken');
    const isLoginPage = window.location.pathname === '/' || window.location.pathname.includes('panelist/index.html');

    if (!token && !isLoginPage) {
        window.location.href = '/panelist/index.html';
    }

    if (token && isLoginPage) {
        window.location.href = '/panelist/dashboard.html';
    }
}

function displayPanelistName() {
    const userDisplay = document.getElementById('userDisplay');
    if (userDisplay) {
        const user = JSON.parse(localStorage.getItem('panelistUser') || '{}');
        if (user && user.username) {
            userDisplay.textContent = user.username;
        }
    }
}

function initializeEventListeners() {
    const loginForm = document.getElementById('loginForm');
    const logoutBtn = document.getElementById('logoutBtn');
    initializePasswordToggles();
    // show name if on dashboard
    displayPanelistName();
    // prefill username or welcome on login page
    const welcome = document.getElementById('welcomeBack');
    const usernameInput = document.getElementById('username');
    if (welcome && usernameInput) {
        const user = JSON.parse(localStorage.getItem('panelistUser') || '{}');
        if (user && user.username) {
            welcome.textContent = `Welcome back, ${user.username}`;
            usernameInput.value = user.username;
        }
    }

    if (loginForm) {
        loginForm.addEventListener('submit', handleLogin);
    }

    if (logoutBtn) {
        logoutBtn.addEventListener('click', handleLogout);
    }

    // Sidebar navigation
    const navItems = document.querySelectorAll('.nav-item');
    navItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const section = item.getAttribute('data-section');
            switchSection(section);
        });
    });

    // Back buttons
    const backToEventsBtn = document.getElementById('backToEventsBtn');
    const backToParticipantsBtn = document.getElementById('backToParticipantsBtn');

    if (backToEventsBtn) {
        backToEventsBtn.addEventListener('click', () => switchSection('events'));
    }
    if (backToParticipantsBtn) {
        backToParticipantsBtn.addEventListener('click', () => {
            loadAssignedEvents();
            switchSection('events');
        });
    }
}

async function handleLogin(e) {
    e.preventDefault();

    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;
    const errorMessage = document.getElementById('errorMessage');

    try {
        const result = await panelistApi.login(username, password);

        if (result.success) {
            window.location.href = '/panelist/dashboard.html';
        } else {
            errorMessage.textContent = result.message || 'Login failed';
            errorMessage.style.display = 'block';
        }
    } catch (error) {
        console.error('Login error:', error);
        errorMessage.textContent = 'An error occurred during login';
        errorMessage.style.display = 'block';
    }
}

async function handleLogout() {
    await panelistApi.logout();
    window.location.href = '/panelist/index.html';
}

function switchSection(section) {
    // Hide all sections
    document.querySelectorAll('.content-section').forEach(sec => {
        sec.classList.remove('active');
    });

    // Update nav items
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.remove('active');
    });

    // Show selected section
    const sectionEl = document.getElementById(section + 'Section');
    if (sectionEl) {
        sectionEl.classList.add('active');
    }

    const navItem = document.querySelector(`[data-section="${section}"]`);
    if (navItem) {
        navItem.classList.add('active');
    }

    // Load data based on section
    if (section === 'events') {
        loadAssignedEvents();
    }
}

async function loadAssignedEvents() {
    const eventsList = document.getElementById('eventsList');
    if (!eventsList) return;

    eventsList.innerHTML = '<div class="empty-state"><p>Loading your events...</p></div>';

    const result = await panelistApi.getAssignedEvents();

    if (result.success) {
        if (result.data.length === 0) {
            eventsList.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon">📋</div>
                    <p>No events assigned to you yet.</p>
                    <p class="muted">Ask an admin to assign you to events or verify your account.</p>
                    <div style="margin-top:8px;">
                        <button id="refreshAssignmentsBtn" class="btn btn-secondary">Refresh</button>
                    </div>
                </div>`;
            // attach refresh handler
            const refreshBtn = document.getElementById('refreshAssignmentsBtn');
            if (refreshBtn) refreshBtn.addEventListener('click', loadAssignedEvents);
        } else {
            eventsList.innerHTML = result.data.map(event => `
                <div class="event-card" onclick="selectEvent(${event.id}, '${event.event_name}')">
                    <div class="event-card-header">
                        <h3>${event.event_name}</h3>
                        <span class="event-status status-${event.status}">${event.status}</span>
                    </div>
                    <div class="event-card-info">
                        <div>
                            <strong>Start:</strong> ${formatDate(event.start_date) || 'Not set'}
                        </div>
                        <div>
                            <strong>End:</strong> ${formatDate(event.end_date) || 'Not set'}
                        </div>
                    </div>
                    <p>${event.description || 'No description'}</p>
                </div>
            `).join('');
        }
    } else {
        // show server error or unauthorized message to the panelist
        const msg = result.message || 'Unable to load your assigned events';
        eventsList.innerHTML = `<div class="empty-state"><div class="empty-state-icon">⚠️</div><p>${msg}</p><p class="muted">If this persists, ask an admin to check your assignments (see panelist_event_assignment table).</p></div>`;
    }
}

async function selectEvent(eventId, eventName) {
    document.getElementById('eventTitle').textContent = eventName;
    
    const result = await panelistApi.getEventParticipants(eventId);
    const participantsList = document.getElementById('participantsList');

    if (result.success) {
        if (result.data.length === 0) {
            participantsList.innerHTML = '<div class="empty-state"><div class="empty-state-icon">👥</div><p>No participants in this event</p></div>';
        } else {
            participantsList.innerHTML = result.data.map(participant => `
                <div class="participant-card" onclick="selectParticipant(${eventId}, ${participant.id}, '${participant.participant_name}', '${participant.team_name || ''}')">
                    <h3>${participant.participant_name}</h3>
                    <div class="event-card-info">
                        <div><strong>Team:</strong> ${participant.team_name || 'N/A'}</div>
                    </div>
                </div>
            `).join('');
        }
    } else {
        const msg = result.message || 'Unable to load participants';
        participantsList.innerHTML = `<div class="empty-state"><p>${msg}</p></div>`;
    }

    switchSection('participants');
}

async function selectParticipant(eventId, participantId, participantName, teamName) {
    document.getElementById('participantName').textContent = participantName;
    // display team name above grading
    const teamEl = document.getElementById('participantTeamName');
    if (teamEl) {
        teamEl.textContent = teamName ? `Team: ${teamName}` : '';
    }

    const result = await panelistApi.getParticipantGrades(eventId, participantId);

    if (result.success) {
        const gradingForm = document.getElementById('gradingForm');

        gradingForm.innerHTML = result.data.map(criteria => `
            <div class="grading-item" data-criteria-id="${criteria.id}">
                <div class="grading-item-header">
                    <div class="grading-item-title">${criteria.criteria_name}</div>
                    <div class="grading-percentage">${criteria.percentage}% Weight | Max Score: ${criteria.max_score}</div>
                </div>
                <div class="grading-input-group">
                    <input
                        type="number"
                        class="grade-input"
                        min="0"
                        max="${criteria.max_score}"
                        step="0.01"
                        value=""
                        placeholder="Enter score">
                    <small class="max-note">Max: ${criteria.max_score}</small>
                </div>
            </div>
        `).join('');

        const submitBtn = document.createElement('button');
        submitBtn.className = 'submit-btn';
        submitBtn.textContent = 'Submit Grades';
        submitBtn.onclick = () => submitGrades(participantId, result.data);
        gradingForm.appendChild(submitBtn);
    }

    switchSection('grading');
}

async function submitGrades(participantId, criteriaList) {
    const inputs = document.querySelectorAll('.grade-input');
    let hasValidGrades = false;

    for (let i = 0; i < inputs.length; i++) {
        const scoreRaw = inputs[i].value;
        const criteria = criteriaList[i];

        if (scoreRaw !== '') {
            hasValidGrades = true;
            const score = parseFloat(scoreRaw);
            if (isNaN(score) || score < 0 || score > criteria.max_score) {
                alert(`Score for "${criteria.criteria_name}" must be between 0 and ${criteria.max_score}.`);
                return;
            }

            const result = await panelistApi.submitGrade(participantId, criteria.id, score);

            if (!result.success) {
                alert('Error submitting grade: ' + (result.message || 'Unknown error'));
                return;
            }
        }
    }

    if (hasValidGrades) {
        alert('Grades submitted successfully! Grades are now locked.');
        // lock inputs after submission
        inputs.forEach(input => input.setAttribute('disabled', 'disabled'));
        const gradingForm = document.getElementById('gradingForm');
        // remove existing submit button
        const submitBtn = gradingForm.querySelector('.submit-btn');
        if (submitBtn) submitBtn.remove();
        // add lock notice
        const notice = document.createElement('div');
        notice.className = 'alert alert-info';
        notice.style.marginTop = '1rem';
        notice.textContent = 'You have already submitted grades for this participant; grades are now locked.';
        gradingForm.appendChild(notice);
    } else {
        alert('Please enter at least one grade');
    }
}

function initializePasswordToggles() {
    const toggleButtons = document.querySelectorAll('[data-toggle-password]');
    toggleButtons.forEach((button) => {
        button.addEventListener('click', () => {
            const inputId = button.getAttribute('data-toggle-password');
            const passwordInput = inputId ? document.getElementById(inputId) : null;
            if (!passwordInput) return;

            const showPassword = passwordInput.type === 'password';
            passwordInput.type = showPassword ? 'text' : 'password';
            button.classList.toggle('is-visible', showPassword);
            button.setAttribute('aria-label', showPassword ? 'Hide password' : 'Show password');
        });
    });
}

// Load events on page ready
document.addEventListener('DOMContentLoaded', () => {
    const eventsSection = document.getElementById('eventsSection');
    if (eventsSection) {
        loadAssignedEvents();
    }
});

function formatDate(dateString) {
    if (!dateString) return null;
    return new Date(dateString).toLocaleString();
}
