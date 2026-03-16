// Panelist Main Script

document.addEventListener('DOMContentLoaded', () => {
    enforceMobileSidebarLayout();
    checkPanelistAuth();
    initializeEventListeners();
});

function escapeHtml(text) {
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function formatCriteriaDetails(criteria) {
    const rawDetails = criteria.criteria_details ?? criteria.details ?? criteria.description ?? '';
    const trimmed = String(rawDetails).trim();
    if (!trimmed) return '';
    return escapeHtml(trimmed).replace(/\r?\n/g, '<br>');
}

function enforceMobileSidebarLayout() {
    const isMobileLike = window.matchMedia('(max-width: 1024px), (hover: none) and (pointer: coarse)').matches;
    const sidebar = document.querySelector('.sidebar');
    const main = document.querySelector('.main-content');
    if (!sidebar || !main || !isMobileLike) return;

    sidebar.style.display = 'flex';
    sidebar.style.position = 'sticky';
    sidebar.style.top = '0';
    sidebar.style.width = '100%';
    sidebar.style.height = 'auto';
    sidebar.style.maxHeight = 'none';
    sidebar.style.zIndex = '1200';

    main.style.marginLeft = '0';
    main.style.width = '100%';
    main.style.maxWidth = '100%';
}

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

let selectedEventId = null;
let selectedParticipantId = null;

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
    selectedEventId = Number(eventId);
    selectedParticipantId = null;
    document.getElementById('eventTitle').textContent = eventName;
    
    const result = await panelistApi.getEventParticipants(eventId);
    const participantsList = document.getElementById('participantsList');

    if (result.success) {
        if (result.data.length === 0) {
            participantsList.innerHTML = '<div class="empty-state"><div class="empty-state-icon">👥</div><p>No participants in this event</p></div>';
        } else {
            participantsList.innerHTML = result.data.map(participant => `
                <div class="participant-card" style="position:relative;" onclick='selectParticipant(${eventId}, ${participant.id}, ${JSON.stringify(participant.participant_name)}, ${JSON.stringify(participant.team_name || "")})'>
                    <div style="position:absolute; top:10px; right:10px; display:flex; flex-direction:column; gap:6px;" onclick="event.stopPropagation();">
                        <label style="display:flex; gap:6px; align-items:center; font-size:0.8rem; font-weight:600; color:#9B0F06; background:#fff8f6; border:1px solid #f0d3cf; border-radius:999px; padding:4px 8px;">
                            <input type="checkbox" ${participant.is_best_technical_implementation ? 'checked' : ''} onchange="toggleBestCategoryCheckbox(${eventId}, ${participant.id}, 'best_technical_implementation', this, event)">
                            Best Technical Implementation
                        </label>
                        <label style="display:flex; gap:6px; align-items:center; font-size:0.8rem; font-weight:600; color:#9B0F06; background:#fff8f6; border:1px solid #f0d3cf; border-radius:999px; padding:4px 8px;">
                            <input type="checkbox" ${participant.is_best_ethical_responsible_ai_design ? 'checked' : ''} onchange="toggleBestCategoryCheckbox(${eventId}, ${participant.id}, 'best_ethical_responsible_ai_design', this, event)">
                            Best Ethical & Responsible AI Design
                        </label>
                    </div>
                    <h3>${participant.participant_name}</h3>
                    <div class="event-card-info">
                        <div><strong>Team:</strong> ${participant.team_name || 'N/A'}</div>
                    </div>
                    <div style="display:flex; gap:8px; flex-wrap:wrap; margin-top:8px;">
                        ${participant.pdf_file_path ? `<a class="btn btn-secondary" href="${participant.pdf_file_path}" target="_blank" rel="noopener" onclick="event.stopPropagation();">View PDF</a>` : ''}
                        ${participant.ppt_file_path ? `<a class="btn btn-secondary" href="${participant.ppt_file_path}" target="_blank" rel="noopener" onclick="event.stopPropagation();">View PPT</a>` : ''}
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

async function toggleBestCategoryCheckbox(eventId, participantId, category, checkboxEl, domEvent) {
    if (domEvent) domEvent.stopPropagation();
    const intended = Boolean(checkboxEl.checked);
    const result = await panelistApi.setBestCategory(eventId, participantId, intended, category);
    if (!result.success) {
        checkboxEl.checked = !intended;
        alert(result.message || 'Failed to update Best in Category.');
    }
}

async function selectParticipant(eventId, participantId, participantName, teamName) {
    selectedEventId = Number(eventId);
    selectedParticipantId = Number(participantId);
    document.getElementById('participantName').textContent = participantName;
    // display team name above grading
    const teamEl = document.getElementById('participantTeamName');
    if (teamEl) {
        teamEl.textContent = teamName ? `Team: ${teamName}` : '';
    }

    const result = await panelistApi.getParticipantGrades(eventId, participantId);

    if (result.success) {
        const gradingForm = document.getElementById('gradingForm');

        gradingForm.innerHTML = result.data.map(criteria => {
            const detailsHtml = formatCriteriaDetails(criteria);
            const hasDetails = Boolean(detailsHtml);
            return `
            <div class="grading-item" data-criteria-id="${criteria.id}">
                <div class="grading-item-header">
                    <div class="grading-item-title" style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                        <span>${escapeHtml(criteria.criteria_name)}</span>
                    </div>
                    <div class="criteria-details-text${hasDetails ? '' : ' is-empty'}">Details: ${hasDetails ? detailsHtml : 'No details provided.'}</div>
                    <div class="grading-percentage">${criteria.percentage}% Weight | Max Score: ${criteria.max_score}</div>
                </div>
                <div class="grading-input-group">
                    <input
                        type="number"
                        class="grade-input"
                        min="0"
                        max="${criteria.max_score}"
                        step="0.01"
                        value="${criteria.existing_score ?? ''}"
                        placeholder="Enter score">
                    <small class="max-note">Max: ${criteria.max_score}</small>
                </div>
            </div>
        `;
        }).join('');

        const hasExistingGrades = result.data.some(criteria => criteria.existing_score !== null && criteria.existing_score !== undefined);
        if (hasExistingGrades) {
            gradingForm.querySelectorAll('.grade-input').forEach(input => input.setAttribute('disabled', 'disabled'));
        } else {
            gradingForm.querySelectorAll('.grade-input').forEach(input => {
                input.addEventListener('input', () => enforceMaxScoreInput(input));
                input.addEventListener('blur', () => enforceMaxScoreInput(input));
            });
        }

        const submitBtn = document.createElement('button');
        submitBtn.className = 'submit-btn';
        submitBtn.textContent = hasExistingGrades ? 'Grades Already Submitted' : 'Submit Grades';
        submitBtn.disabled = hasExistingGrades;
        submitBtn.onclick = () => submitGrades(result.data);
        gradingForm.appendChild(submitBtn);
    }

    switchSection('grading');
}

async function submitGrades(criteriaList) {
    if (!selectedEventId || !selectedParticipantId) {
        alert('No participant selected.');
        return;
    }

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

            const result = await panelistApi.submitGrade(selectedEventId, selectedParticipantId, criteria.id, score);

            if (!result.success) {
                alert('Error submitting grade: ' + (result.message || 'Unknown error'));
                return;
            }
        }
    }

    if (hasValidGrades) {
        alert('Grades submitted successfully! Grades are now locked.');
        await selectParticipant(
            selectedEventId,
            selectedParticipantId,
            document.getElementById('participantName').textContent,
            (document.getElementById('participantTeamName').textContent || '').replace(/^Team:\s*/, '')
        );
    } else {
        alert('Please enter at least one grade');
    }
}

function enforceMaxScoreInput(input) {
    const max = Number(input.max);
    if (input.value === '') return;

    const value = Number(input.value);
    if (!Number.isFinite(value)) {
        input.value = '';
        return;
    }

    if (value < 0) {
        input.value = '0';
        return;
    }

    if (Number.isFinite(max) && value > max) {
        input.value = String(max);
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
    enforceMobileSidebarLayout();
    if (eventsSection) {
        loadAssignedEvents();
    }
});

window.addEventListener('resize', enforceMobileSidebarLayout);
window.addEventListener('orientationchange', enforceMobileSidebarLayout);

function formatDate(dateString) {
    if (!dateString) return null;
    return new Date(dateString).toLocaleString();
}
