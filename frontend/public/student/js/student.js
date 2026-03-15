// Student dashboard logic

let currentEventId = null;
let currentParticipantId = null;
let currentCriteriaList = [];

function checkStudentAuth() {
    const token = localStorage.getItem('studentToken');
    const isLoginPage = window.location.pathname.endsWith('/student/index.html') || window.location.pathname === '/student';
    if (!token && !isLoginPage) {
        window.location.href = '/student/index.html';
    }
    if (token && isLoginPage) {
        window.location.href = '/student/dashboard.html';
    }
}

function displayStudentName() {
    const userDisplay = document.getElementById('userDisplay');
    if (userDisplay) {
        const user = JSON.parse(localStorage.getItem('studentUser') || '{}');
        if (user && user.name) {
            userDisplay.textContent = user.name;
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    checkStudentAuth();

    const loginForm = document.getElementById('loginForm');
    if (loginForm) loginForm.addEventListener('submit', handleLogin);

    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) logoutBtn.addEventListener('click', async () => {
        await studentApi.logout();
        window.location.href = '/student/index.html';
    });

    displayStudentName();

    const navItems = document.querySelectorAll('.nav-item');
    navItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const section = item.getAttribute('data-section');
            switchSection(section);
        });
    });

    const backToEventsBtn = document.getElementById('backToEventsBtn');
    const backToParticipantsBtn = document.getElementById('backToParticipantsBtn');
    if (backToEventsBtn) backToEventsBtn.addEventListener('click', () => switchSection('events'));
    if (backToParticipantsBtn) backToParticipantsBtn.addEventListener('click', () => switchSection('participants'));

    if (document.getElementById('eventsSection')) {
        loadAssignedEvents();
    }
});

async function handleLogin(e) {
    e.preventDefault();
    const name = document.getElementById('name').value.trim();
    const studentNumber = document.getElementById('studentNumber').value.trim();
    const errorMessage = document.getElementById('errorMessage');

    try {
        const result = await studentApi.login(name, studentNumber);
        if (result.success) {
            window.location.href = '/student/dashboard.html';
        } else {
            errorMessage.textContent = result.message || 'Login failed';
            errorMessage.style.display = 'block';
        }
    } catch (err) {
        console.error(err);
        errorMessage.textContent = 'Network error';
        errorMessage.style.display = 'block';
    }
}

function switchSection(section) {
    document.querySelectorAll('.content-section').forEach(sec => sec.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(item => item.classList.remove('active'));
    const sec = document.getElementById(section + 'Section');
    if (sec) sec.classList.add('active');
    const navItem = document.querySelector(`[data-section="${section}"]`);
    if (navItem) navItem.classList.add('active');
    if (section === 'events') {
        loadAssignedEvents();
    }
}

async function loadAssignedEvents() {
    const list = document.getElementById('eventsList');
    if (!list) return;
    list.innerHTML = '<div class="empty-state"><p>Loading events...</p></div>';
    const res = await studentApi.getAssignedEvents();
    if (res.success) {
        if (res.data.length === 0) {
            list.innerHTML = '<div class="empty-state"><p>No events assigned. Please contact an admin.</p></div>';
        } else {
            list.innerHTML = res.data.map(ev => `
                <div class="event-card" onclick="selectEvent(${ev.id}, '${ev.event_name.replace(/'/g, "\\'")}')">
                    <h3>${ev.event_name}</h3>
                    <p class="event-dates">${ev.start_date ? new Date(ev.start_date).toLocaleDateString() : ''} - ${ev.end_date ? new Date(ev.end_date).toLocaleDateString() : ''}</p>
                </div>
            `).join('');
        }
    }
}

function selectEvent(id, name) {
    currentEventId = id;
    document.getElementById('eventTitle').textContent = name;
    loadEventParticipants(id);
    switchSection('participants');
}

async function loadEventParticipants(eventId) {
    const list = document.getElementById('participantsList');
    list.innerHTML = '<div class="empty-state"><p>Loading participants...</p></div>';
    const res = await studentApi.getEventParticipants(eventId);
    if (res.success) {
        if (res.data.length === 0) {
            list.innerHTML = '<div class="empty-state"><p>No participants found.</p></div>';
        } else {
            list.innerHTML = res.data.map(p => `
                <div class="participant-card" onclick="selectParticipant(${p.id}, '${p.participant_name.replace(/'/g, "\\'")}', '${p.team_name ? p.team_name.replace(/'/g, "\\'") : ''}')">
                    <h4>${p.participant_name}</h4>
                    ${p.team_name ? `<p class="text-muted">${p.team_name}</p>` : ''}
                </div>
            `).join('');
        }
    }
}

function selectParticipant(id, name, team) {
    currentParticipantId = id;
    document.getElementById('participantName').textContent = name;
    document.getElementById('participantTeamName').textContent = team;
    loadGrades(currentEventId, id);
    switchSection('grading');
}

async function loadGrades(eventId, participantId) {
    const container = document.getElementById('gradingForm');
    container.innerHTML = '';
    const res = await studentApi.getParticipantGrades(eventId, participantId);
    if (res.success) {
        if (res.data.length === 0) {
            container.innerHTML = '<p>No grading criteria available.</p>';
            return;
        }

        currentCriteriaList = res.data;

        container.innerHTML = res.data.map(c => `
            <div class="form-group">
                <label>${c.criteria_name} (${c.percentage}%)</label>
                <div class="grading-input-group">
                    <input type="number" min="0" max="${c.max_score}" value="" data-criteria="${c.id}" class="grade-input">
                    <small class="max-note">Max: ${c.max_score}</small>
                </div>
            </div>
        `).join('') + '<button id="submitGradesBtn" class="btn btn-primary">Submit Grades</button>';

        document.getElementById('submitGradesBtn').addEventListener('click', submitGrades);
    }
}

async function submitGrades() {
    const inputs = document.querySelectorAll('.grade-input');
    let hadError = false;

    for (const inp of inputs) {
        const criteriaId = inp.getAttribute('data-criteria');
        const scoreRaw = inp.value;

        if (scoreRaw === '' || scoreRaw === null) {
            alert('Please enter a score for every criteria before submitting.');
            return;
        }

        const criteria = currentCriteriaList.find(c => `${c.id}` === `${criteriaId}`);
        const maxScore = criteria ? criteria.max_score : null;
        const score = parseFloat(scoreRaw);
        if (isNaN(score) || score < 0 || (maxScore !== null && score > maxScore)) {
            alert(`Score must be between 0 and ${maxScore ?? 'the allowed maximum'}.`);
            return;
        }

        const result = await studentApi.submitGrade(currentParticipantId, criteriaId, score);
        if (!result.success) {
            hadError = true;
            console.error('Submit grade error:', result.message);
            alert(result.message || 'Failed to submit some grades.');
            break;
        }
    }

    if (!hadError) {
        alert('Grades submitted');
        // Reload grades view to lock submitted inputs
        loadGrades(currentEventId, currentParticipantId);
    }
}
