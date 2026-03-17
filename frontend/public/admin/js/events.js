// Admin Events Management

let currentEventId = sessionStorage.getItem('currentEventId') || null; // restore after reload
let currentParticipantId = null; // track when viewing details
let currentTeamName = ''; // track team for member listing
let currentTeamMembers = [];
let participantSortDirection = 'desc';
let participantLimit = null;
let participantProblemNameFilter = '';

function resetParticipantModalState() {
    currentParticipantId = null;
    currentTeamName = '';
    currentTeamMembers = [];
    const spinner = document.getElementById('participantLoading');
    if (spinner) spinner.style.display = 'none';

    const overviewTab = document.getElementById('overviewTab');
    const studentTab = document.getElementById('studentTab');
    const panelistTab = document.getElementById('panelistTab');
    const membersTab = document.getElementById('membersTab');
    const tabs = document.querySelectorAll('.breakdown-tab');

    // reset active tab to overview
    if (tabs.length) {
        tabs.forEach(t => t.classList.remove('active'));
        const overviewBtn = document.querySelector('.breakdown-tab[data-tab="overview"]');
        if (overviewBtn) overviewBtn.classList.add('active');
    }
    if (overviewTab) overviewTab.style.display = 'block';
    if (studentTab) studentTab.style.display = 'none';
    if (panelistTab) panelistTab.style.display = 'none';
    if (membersTab) membersTab.style.display = 'none';

    const containers = [
        'overviewContent',
        'studentGradesContent',
        'panelistGradesContent',
        'teamMembersContent',
        'totalScoreDisplay',
    ];
    containers.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.innerHTML = '';
    });
}

// ensure numeric
if (currentEventId) currentEventId = parseInt(currentEventId, 10);

async function loadEvents() {
    const eventsList = document.getElementById('eventsList');
    if (!eventsList) return;

    eventsList.innerHTML = '<div class="empty-state"><p>Loading events...</p></div>';

    const result = await adminApi.getEvents();

    if (result.success) {
        if (result.data.length === 0) {
            eventsList.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📋</div><p>No events yet. Create one to get started!</p></div>';
        } else {
            eventsList.innerHTML = result.data.map(event => `
                <div class="event-card" onclick="selectEvent(${event.id})" style="position: relative;">
                    <div class="event-card-header">
                        <h3>${event.event_name}</h3>
                        <div style="display: flex; gap: 8px; align-items: center;">
                            ${event.is_tournament ? '<span style="background: #667eea; color: white; padding: 4px 8px; border-radius: 4px; font-size: 0.85em; font-weight: 500;">🏆 Tournament</span>' : ''}
                            <span class="event-status status-${event.status}">${event.status}</span>
                        </div>
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
                    <div class="event-card-actions">
                        <button class="btn btn-secondary" onclick="openEditEventModal(${event.id}, '${event.event_name.replace(/'/g, "\\'")}', '${(event.description || '').replace(/'/g, "\\'")}', '${event.start_date || ''}', '${event.end_date || ''}'); event.stopPropagation();">✏️ Edit</button>
                        <button class="btn btn-danger" onclick="deleteEventConfirm(${event.id}); event.stopPropagation();">Delete</button>
                    </div>
                </div>
            `).join('');
        }
    } else {
        eventsList.innerHTML = '<div class="empty-state"><p>Error loading events</p></div>';
    }
    loadSubmissionsTable(currentEventId || null);
}

async function selectEvent(eventId) {
    currentEventId = eventId;
    sessionStorage.setItem('currentEventId', eventId);

    const result = await adminApi.getEventDetails(eventId);

    if (result.success) {
        const event = result.data.event;
        document.getElementById('eventTitle').textContent = event.event_name;

        // populate event weight controls
        const sInput = document.getElementById('eventStudentWeightInput');
        const pInput = document.getElementById('eventPanelistWeightInput');
        if (sInput && pInput) {
            sInput.value = event.student_weight ?? 50;
            pInput.value = event.panelist_weight ?? 50;
            updateEventWeightSum();
        }
        
        // Load participants
        loadEventParticipants(eventId);
        loadSubmissionsTable(eventId);
        loadTopBestCategory(eventId);
        
        // Load criteria
        loadEventCriteria(result.data.criteria);
        switchEventDetailsTab('eventBreakdownTab');
        
        switchSection('eventDetails');
    }
}

async function loadEventParticipants(eventId) {
    const participantsList = document.getElementById('participantsList');
    if (!participantsList) return;

    participantsList.innerHTML = '<div class="empty-state"><p>Loading participants...</p></div>';

    const result = await adminApi.getEventParticipants(eventId);

    if (result.success) {
        if (result.data.length === 0) {
            participantsList.innerHTML = '<div class="empty-state"><div class="empty-state-icon">👥</div><p>No participants yet</p></div>';
        } else {
            // Group by team_name to avoid duplicate team entries in UI
            const groups = {};
            result.data.forEach(p => {
                const key = (p.team_name || 'N/A');
                if (!groups[key]) {
                    groups[key] = {
                        team: key,
                        members: [],
                        total_score: 0,
                        reg: p.registration_number,
                        ids: [],
                        problem_name: p.problem_name || '',
                        pdf_file_path: p.pdf_file_path || null,
                        video_file_path: p.video_file_path || null
                    };
                }
                groups[key].members.push(p.participant_name);
                groups[key].ids.push(p.id);
                if (Number.isFinite(parseFloat(p.total_score))) {
                    groups[key].total_score += parseFloat(p.total_score);
                }
                if (!groups[key].reg && p.registration_number) groups[key].reg = p.registration_number;
                if (!groups[key].problem_name && p.problem_name) groups[key].problem_name = p.problem_name;
                if (!groups[key].pdf_file_path && p.pdf_file_path) groups[key].pdf_file_path = p.pdf_file_path;
                if (!groups[key].video_file_path && p.video_file_path) groups[key].video_file_path = p.video_file_path;
            });

            const grouped = Object.values(groups);

            const sorted = grouped.sort((a, b) => {
                const tA = Number.isFinite(a.total_score) ? a.total_score : -1;
                const tB = Number.isFinite(b.total_score) ? b.total_score : -1;
                return participantSortDirection === 'asc' ? tA - tB : tB - tA;
            });

            const filtered = participantProblemNameFilter
                ? sorted.filter(group => {
                    return (group.problem_name || '').toLowerCase() === participantProblemNameFilter.toLowerCase();
                })
                : sorted;

            const limited = participantLimit ? filtered.slice(0, participantLimit) : filtered;

            const renderParticipants = (participants) => participants.map((teamGroup, idx) => `
                <div class="participant-card">
                    <div onclick="selectParticipant(${eventId}, ${teamGroup.ids[0]})" style="cursor:pointer;">
                        <div style="display:flex; align-items:center; gap:8px;">
                            <span style="font-weight:700; color:#9B0F06;">#${idx + 1}</span>
                            <h3 style="margin:0; font-size:16px; font-weight:700;">${teamGroup.team}</h3>
                        </div>
                        <div class="event-card-info" style="font-size:16px; font-weight:700;">
                            <div><strong>Members:</strong> ${teamGroup.members.length}</div>
                            <div><strong>Total Score:</strong> ${
                                Number.isFinite(teamGroup.total_score)
                                    ? teamGroup.total_score.toFixed(2)
                                    : 'Not graded'
                            }</div>
                        </div>
                        <div class="event-card-info">
                            <div><strong>Reg Number:</strong> ${teamGroup.reg || 'N/A'}</div>
                            <div><strong>Problem:</strong> ${teamGroup.problem_name || 'N/A'}</div>
                        </div>
                    </div>
                    <div class="event-card-actions">
                        <button class="btn btn-secondary" onclick="openAddMemberForTeam('${teamGroup.team.replace(/'/g, "\\'")}'); event.stopPropagation();">+ Add Member</button>
                        <button class="btn btn-secondary" onclick="document.getElementById('participantPdfFile-${teamGroup.ids[0]}').click(); event.stopPropagation();">Upload PDF</button>
                        <input type="file" id="participantPdfFile-${teamGroup.ids[0]}" accept=".pdf,application/pdf" style="display:none;" onchange="handleParticipantSingleFileSelected(${teamGroup.ids[0]}, this, 'pdf'); event.stopPropagation();">
                        <button class="btn btn-secondary" onclick="document.getElementById('participantVideoFile-${teamGroup.ids[0]}').click(); event.stopPropagation();">Upload Video</button>
                        <input type="file" id="participantVideoFile-${teamGroup.ids[0]}" accept=".mp4,.mov,.webm,.mkv,video/mp4,video/quicktime,video/webm,video/x-matroska" style="display:none;" onchange="handleParticipantSingleFileSelected(${teamGroup.ids[0]}, this, 'video'); event.stopPropagation();">
                        <button class="btn btn-danger" onclick="deleteTeamParticipants('${teamGroup.team.replace(/'/g, "\\'")}'); event.stopPropagation();">Delete Team</button>
                    </div>
                    <div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap; margin-top:8px;">
                        ${teamGroup.pdf_file_path ? `<a href="${teamGroup.pdf_file_path}" target="_blank" rel="noopener" class="btn btn-secondary" style="padding:6px 10px;">View PDF</a>` : ''}
                        ${teamGroup.video_file_path ? `<a href="${teamGroup.video_file_path}" target="_blank" rel="noopener" class="btn btn-secondary" style="padding:6px 10px;">View Video</a>` : ''}
                    </div>
                </div>
            `).join('');

            participantsList.innerHTML = renderParticipants(limited);
        }
    }
}

async function loadTopBestCategory(eventId) {
    const technicalBox = document.getElementById('topBestCategoryTechnicalList');
    const ethicalBox = document.getElementById('topBestCategoryEthicalList');
    if (!technicalBox || !ethicalBox) return;

    technicalBox.textContent = 'Loading top 3...';
    ethicalBox.textContent = 'Loading top 3...';
    const result = await adminApi.getTopBestCategory(eventId);
    if (!result.success) {
        const msg = result.message || 'Unable to load Top 3.';
        technicalBox.textContent = msg;
        ethicalBox.textContent = msg;
        return;
    }

    const technical = Array.isArray(result.data?.bestTechnicalImplementation) ? result.data.bestTechnicalImplementation : [];
    const ethical = Array.isArray(result.data?.bestEthicalResponsibleAIDesign) ? result.data.bestEthicalResponsibleAIDesign : [];

    const renderRows = (rows) => rows.map((row, idx) => `
        <div style="display:flex; justify-content:space-between; gap:8px; padding:4px 0;">
            <span><strong>#${idx + 1}</strong> ${row.participant_label}${row.problem_name ? ` (${row.problem_name})` : ''}</span>
            <span style="font-weight:700; color:#9B0F06;">Avg: ${Number(row.average_score || 0).toFixed(2)} | ${row.votes} vote${Number(row.votes) === 1 ? '' : 's'}</span>
        </div>
    `).join('');

    technicalBox.innerHTML = technical.length ? renderRows(technical) : 'No votes yet.';
    ethicalBox.innerHTML = ethical.length ? renderRows(ethical) : 'No votes yet.';
}

async function loadEventCriteria(criteria) {
    const criteriaList = document.getElementById('criteriaList');
    if (!criteriaList) return;

    if (criteria.length === 0) {
        criteriaList.innerHTML = '<div class="empty-state"><p>No criteria added yet</p></div>';
    } else {
        criteriaList.innerHTML = criteria.map(crit => `
            <div class="criteria-item">
                <div class="criteria-info">
                    <div class="criteria-name" style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                        <span>${crit.criteria_name}</span>
                        ${crit.criteria_details ? `<span class="text-muted" style="font-weight:400;">- ${crit.criteria_details}</span>` : ''}
                    </div>
                    <div class="criteria-percentage">${crit.percentage}% | Max Score: ${crit.max_score}</div>
                </div>
                <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
                    <button class="btn btn-secondary" onclick='openUpdateCriteriaPrompt(${crit.id}, ${JSON.stringify(crit.criteria_name)}, ${JSON.stringify(crit.criteria_details || "")}, ${Number(crit.percentage) || 0})'>Update</button>
                    <button class="btn btn-danger" onclick="deleteCriteria(${crit.id})">Delete</button>
                </div>
            </div>
        `).join('');
    }
}

async function selectParticipant(eventId, participantId) {
    // allow new opens even if a previous load failed; no locking
    try {
        resetParticipantModalState();
        currentParticipantId = participantId;
        currentTeamName = '';
        currentTeamMembers = [];
        const spinner = document.getElementById('participantLoading');
        if (spinner) spinner.style.display = 'block';
        
        // Get detailed breakdown
        const breakdownResult = await adminApi.getParticipantGradesBreakdown(eventId, participantId);
        if (!breakdownResult.success && breakdownResult.message && breakdownResult.message.toLowerCase().includes('token')) {
            window.location.href = '/admin/index.html';
            return;
        }

        if (!breakdownResult.success) {
            alert('Error loading participant details');
            return;
        }

        // Get basic participant info for the title
        const detailsResult = await adminApi.getParticipantDetails(eventId, participantId);
        if (!detailsResult.success && detailsResult.message && detailsResult.message.toLowerCase().includes('token')) {
            window.location.href = '/admin/index.html';
            return;
        }
        if (detailsResult.success) {
            const participant = detailsResult.data.participant;
            const teamLabel = participant.team_name || participant.participant_name || '';
            document.getElementById('detailedParticipantName').textContent = teamLabel;
            currentTeamName = participant.team_name || '';
        }

        await loadTeamMembers(eventId, currentTeamName);

        const data = breakdownResult.data;
        const weights = data.weights;
        const criteria = data.criteria;
        const panelistGrades = data.panelistGrades;
        const studentGrades = data.studentGrades;

        // Calculate and display total score
        calculateAndDisplayTotalScore(criteria, panelistGrades, studentGrades, weights);

        // Display overview
        displayOverview(criteria, panelistGrades, studentGrades, weights);

        // Display student grades
        displayStudentGrades(criteria, studentGrades);

        // Display panelist grades
        displayPanelistGrades(criteria, panelistGrades);

        // Setup tab handlers
        setupBreakdownTabs();

        showModal('participantDetailsModal');
    } finally {
        const spinner = document.getElementById('participantLoading');
        if (spinner) spinner.style.display = 'none';
        // no lock retained
    }
}

function calculateAndDisplayTotalScore(criteria, panelistGrades, studentGrades, weights) {
    const panelistWeight = Number(weights?.panelist_weight);
    const studentWeight = Number(weights?.student_weight);
    const pw = Number.isFinite(panelistWeight) ? panelistWeight : 50;
    const sw = Number.isFinite(studentWeight) ? studentWeight : 50;

    // Build maps for easier lookup
    const panelistMap = {};
    panelistGrades.forEach(g => {
        if (!panelistMap[g.criteria_id]) panelistMap[g.criteria_id] = [];
        if (g.score !== null && g.score !== undefined) panelistMap[g.criteria_id].push(parseFloat(g.score));
    });

    const studentMap = {};
    studentGrades.forEach(g => {
        if (!studentMap[g.criteria_id]) studentMap[g.criteria_id] = [];
        if (g.score !== null && g.score !== undefined) studentMap[g.criteria_id].push(parseFloat(g.score));
    });

    let totalScore = 0;
    let maxPossible = 0;

    criteria.forEach(crit => {
        const pct = Number(crit.percentage) || 0;
        const maxScore = Number(crit.max_score) || pct || 100;

        const panelistAvg = panelistMap[crit.id] && panelistMap[crit.id].length > 0
            ? panelistMap[crit.id].reduce((a, b) => a + b, 0) / panelistMap[crit.id].length
            : 0;
        const studentAvg = studentMap[crit.id] && studentMap[crit.id].length > 0
            ? studentMap[crit.id].reduce((a, b) => a + b, 0) / studentMap[crit.id].length
            : 0;

        const panelistNorm = maxScore > 0 ? panelistAvg / maxScore : 0;
        const studentNorm = maxScore > 0 ? studentAvg / maxScore : 0;

        const combinedNorm = (panelistNorm * (pw / 100)) + (studentNorm * (sw / 100));
        const criteriaContribution = combinedNorm * pct;

        totalScore += criteriaContribution;
        maxPossible += pct;
    });

    const displayScore = maxPossible > 0 ? (totalScore / maxPossible * 100).toFixed(2) : 0;
    document.getElementById('totalScoreDisplay').textContent = displayScore + '/100';
}

function displayOverview(criteria, panelistGrades, studentGrades, weights) {
    const aggregateTotal = (grades, weightShare) => {
        let total = 0;
        criteria.forEach(crit => {
            const critGrades = grades.filter(g => g.criteria_id === crit.id && g.score !== null);
            if (critGrades.length === 0) return;
            const avg = critGrades.reduce((a, b) => a + parseFloat(b.score), 0) / critGrades.length;
            const maxScore = crit.max_score || 100;
            const norm = maxScore > 0 ? avg / maxScore : 0;
            total += norm * (crit.percentage || 0) * (weightShare / 100);
        });
        return total.toFixed(2);
    };

    const panelistTotal = panelistGrades.length ? aggregateTotal(panelistGrades, weights.panelist_weight || 50) : '--';
    const studentTotal = studentGrades.length ? aggregateTotal(studentGrades, weights.student_weight || 50) : '--';

    const overviewHtml = `
        <div style="display:grid; grid-template-columns: repeat(auto-fit,minmax(220px,1fr)); gap:12px;">
            <div style="border:1px solid #e6e0d8; border-radius:12px; padding:16px; background:#fff;">
                <div style="font-weight:700; color:#388e3c; font-size:0.95rem; margin-bottom:6px;">Panelist Total Grade</div>
                <div style="font-size:2rem; font-weight:800; color:#388e3c;">${panelistTotal}</div>
                <div style="color:#666; font-size:0.9rem;">Out of weighted 100</div>
            </div>
            <div style="border:1px solid #e6e0d8; border-radius:12px; padding:16px; background:#fff;">
                <div style="font-weight:700; color:#1976d2; font-size:0.95rem; margin-bottom:6px;">Student Total Grade</div>
                <div style="font-size:2rem; font-weight:800; color:#1976d2;">${studentTotal}</div>
                <div style="color:#666; font-size:0.9rem;">Out of weighted 100</div>
            </div>
        </div>
    `;

    document.getElementById('overviewContent').innerHTML = overviewHtml;
}

// Utility to compute totals and breakdown per grader
function mapGradesByGrader(criteria, grades, idKey, nameKey) {
    const byGrader = {};
    grades.forEach(g => {
        if (g.score === null || g.score === undefined) return;
        const graderId = g[idKey] ?? g.panelist_id ?? g.student_id ?? g.log_target_id ?? g[nameKey] ?? 'unknown';
        if (!byGrader[graderId]) {
            const resolvedId = g[idKey] ?? g.panelist_id ?? g.student_id ?? g.log_target_id ?? null;
            byGrader[graderId] = { id: resolvedId, name: g[nameKey] || g.full_name || 'Unknown', items: [], lastEdit: null };
        }
        const crit = criteria.find(c => c.id === g.criteria_id);
        if (crit) {
            const lastEdit = g.last_edited_by ? {
                by: g.last_edited_by,
                at: g.last_edited_at,
                oldScore: g.last_old_score,
                newScore: g.last_new_score
            } : null;
            if (lastEdit && !byGrader[graderId].lastEdit) {
                byGrader[graderId].lastEdit = lastEdit;
            }
            byGrader[graderId].items.push({
                criteriaName: crit.criteria_name,
                score: parseFloat(g.score),
                max: crit.max_score || 100,
                percentage: crit.percentage || 0,
                criteriaId: crit.id
            });
        }
    });

    // compute total per grader
    Object.values(byGrader).forEach(grader => {
        grader.total = grader.items.reduce((sum, item) => {
            return sum + (item.score / item.max) * item.percentage;
        }, 0);
    });

    // return only graders who submitted at least one score
    return Object.values(byGrader);
}

function renderGraderAccordion(graderList, accentColor, type) {
    if (!graderList.length) {
        return '<p style="color:#999;">No grades submitted yet.</p>';
    }
    return graderList.map(grader => `
        <details style="border:1px solid #e6e0d8; border-radius:10px; padding:12px; background:#fff; margin-bottom:10px;">
            <summary style="display:flex; justify-content:space-between; align-items:center; cursor:pointer; font-weight:700; color:${accentColor};">
                <span>${grader.name}</span>
                <span style="font-size:1.1rem;">${grader.total.toFixed(2)}</span>
            </summary>
            <div style="margin-top:10px; color:#333;">
                ${grader.items.map(item => `
                    <div style="display:flex; justify-content:space-between; padding:6px 0; border-bottom:1px solid #f1ede6;">
                        <span>${item.criteriaName} (${item.percentage}%)</span>
                        <span style="display:flex; align-items:center; gap:8px; color:${accentColor}; font-weight:700;">
                            ${item.score} / ${item.max}
                            <button class="btn btn-secondary" type="button" style="padding:4px 8px; font-size:0.8rem;"
                                onclick="event.preventDefault(); event.stopPropagation(); handleUpdateGrade('${type}', ${grader.id !== null && grader.id !== undefined ? grader.id : 'null'}, ${item.criteriaId}, ${item.max}); return false;">Edit</button>
                            <button class="btn btn-secondary" type="button" style="padding:4px 8px; font-size:0.8rem;"
                                onclick="event.preventDefault(); event.stopPropagation(); showGradeHistory('${type}', ${grader.id !== null && grader.id !== undefined ? grader.id : 'null'}, ${item.criteriaId}); return false;">Details</button>
                        </span>
                    </div>
                `).join('')}
                ${grader.lastEdit ? `
                    <div style="margin-top:8px; font-size:0.9rem; color:#555;">
                        Last edited by <strong>${grader.lastEdit.by}</strong> on ${new Date(grader.lastEdit.at).toLocaleString()} (prev: ${grader.lastEdit.oldScore ?? 'N/A'}, new: ${grader.lastEdit.newScore ?? 'N/A'})
                    </div>
                ` : ''}
            </div>
        </details>
    `).join('');
}

function displayStudentGrades(criteria, studentGrades) {
    const normalized = studentGrades.map(g => ({
        ...g,
        grader_id: g.grader_id ?? g.student_id ?? g.log_target_id ?? null
    }));
    const graders = mapGradesByGrader(criteria, normalized, 'grader_id', 'name')
        .filter(g => g.items.length > 0);
    window.__latestStudentGrades = normalized;
    const html = renderGraderAccordion(graders, '#1976d2', 'student');
    document.getElementById('studentGradesContent').innerHTML = html;
}

function displayPanelistGrades(criteria, panelistGrades) {
    const normalized = panelistGrades.map(g => ({
        ...g,
        grader_id: g.grader_id ?? g.panelist_id ?? g.log_target_id ?? null
    }));
    const graders = mapGradesByGrader(criteria, normalized, 'grader_id', 'full_name')
        .filter(g => g.items.length > 0);
    window.__latestPanelistGrades = normalized;
    const html = renderGraderAccordion(graders, '#388e3c', 'panelist');
    document.getElementById('panelistGradesContent').innerHTML = html;
}

async function handleUpdateGrade(type, graderId, criteriaId, maxScore) {
    if (!currentParticipantId || !currentEventId) return;
    const participantIdNum = parseInt(currentParticipantId, 10);
    const criteriaIdNum = parseInt(criteriaId, 10);
    if (!participantIdNum || !criteriaIdNum) {
        alert('Missing participant or criteria reference.');
        return;
    }
    const gradesSource = type === 'panelist' ? window.__latestPanelistGrades || [] : window.__latestStudentGrades || [];
    // Try to match by both criteria and the passed graderId when available
    let match = null;
    if (graderId) {
        match = gradesSource.find(g =>
            Number(g.criteria_id) === criteriaIdNum &&
            [g.grader_id, g.panelist_id, g.student_id, g.log_target_id].some(id => Number(id) === Number(graderId))
        );
    }
    if (!match) {
        // fallback to first grade for the criteria
        match = gradesSource.find(g => Number(g.criteria_id) === criteriaIdNum) || null;
    }
    const resolvedId = match ? (match.grader_id ?? match.panelist_id ?? match.student_id ?? match.log_target_id ?? graderId) : graderId;
    const resolvedName = match ? (match.full_name || match.name || null) : null;
    const resolvedIdNum = Number(resolvedId);
    graderId = Number.isFinite(resolvedIdNum) && resolvedIdNum > 0 ? resolvedIdNum : null;
    const adminUser = JSON.parse(localStorage.getItem('adminUser') || '{}');
    const adminId = adminUser && adminUser.id ? Number(adminUser.id) : null;
    const fallbackName = resolvedName || adminUser?.username || 'Admin Override';
    if (!graderId && !fallbackName) {
        alert('Could not determine who gave this grade, so it cannot be edited.');
        return;
    }
    const raw = prompt(`Enter new score (0 - ${maxScore}):`);
    if (raw === null) return;
    const score = parseFloat(raw);
    if (Number.isNaN(score) || score < 0 || score > maxScore) {
        alert(`Please enter a number between 0 and ${maxScore}.`);
        return;
    }

    const payload = {
        participant_id: participantIdNum,
        criteria_id: criteriaIdNum,
        panelist_id: type === 'panelist' ? (graderId || adminId || null) : null,
        student_id: type === 'student' ? graderId : null,
        panelist_name: type === 'panelist' ? fallbackName : null,
        student_name: type === 'student' ? fallbackName : null,
        score: Number(score),
        event_id: currentEventId ? Number(currentEventId) : null,
        role: type,
        admin_id: adminId
    };
    console.log('[handleUpdateGrade] payload -> API', payload);

    let result;
    if (type === 'panelist') {
        result = await adminApi.adminUpdatePanelistGrade(payload);
    } else {
        result = await adminApi.adminUpdateStudentGrade(payload);
    }

    if (result && result.success) {
        // reload breakdown to reflect changes
        await selectParticipant(currentEventId, currentParticipantId);
    } else {
        alert(result.message || 'Failed to update grade.');
    }
}

function showGradeHistory(type, graderId, criteriaId) {
    if (!currentParticipantId || !currentEventId) return;
    const gradesSource = type === 'panelist' ? window.__latestPanelistGrades || [] : window.__latestStudentGrades || [];
    const match = gradesSource.find(g => g.criteria_id === criteriaId && (g.grader_id === graderId));
    if (!match || !match.last_old_score) {
        alert('No previous grade recorded for this entry.');
        return;
    }
    const msg = `Previous grade: ${match.last_old_score}\nLast edited by: ${match.last_edited_by || 'Unknown'}\nOn: ${match.last_edited_at ? new Date(match.last_edited_at).toLocaleString() : 'Unknown'}`;
    alert(msg);
}

function setupBreakdownTabs() {
    const tabs = document.querySelectorAll('.breakdown-tab');
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            // Remove active class from all tabs
            tabs.forEach(t => t.classList.remove('active'));
            // Hide all content
            document.querySelectorAll('.breakdown-tab-content').forEach(content => {
                content.style.display = 'none';
            });
            // Add active to clicked tab
            tab.classList.add('active');
            // Show corresponding content
            const tabName = tab.getAttribute('data-tab');
            document.getElementById(tabName + 'Tab').style.display = 'block';
        });
    });

}

async function loadTeamMembers(eventId, teamName) {
    const container = document.getElementById('teamMembersContent');
    if (!container) return;

    if (!teamName) {
        container.innerHTML = '<p class="text-muted">No team name recorded for this participant.</p>';
        return;
    }

    container.innerHTML = '<p class="text-muted">Loading team members...</p>';
    const res = await adminApi.getEventParticipants(eventId);
    if (!res.success) {
        container.innerHTML = '<p class="text-muted">Unable to load team members.</p>';
        return;
    }

    currentTeamMembers = res.data.filter(p => p.team_name === teamName);
    displayTeamMembers();
}

function displayTeamMembers() {
    const container = document.getElementById('teamMembersContent');
    if (!container) return;

    if (!currentTeamMembers || currentTeamMembers.length === 0) {
        container.innerHTML = '<p class="text-muted">No members found for this team.</p>';
        return;
    }

    container.innerHTML = `
        <div class="card">
            <div class="card-header" style="margin-bottom: 0.75rem;">
                <div>
                    <div class="criteria-name">Team: ${currentTeamName}</div>
                    <div class="text-muted" style="font-size:0.9rem;">Members in this event</div>
                </div>
            </div>
            <ul style="list-style:none; padding:0; margin:0;">
                ${currentTeamMembers.map(member => `
                    <li style="padding:8px 0; border-bottom:1px solid #eee; display:flex; justify-content:space-between; align-items:center; gap:8px;">
                        <span>${member.participant_name}</span>
                        <span style="color:#9B0F06;">Reg #${member.registration_number || '-'}</span>
                    </li>
                `).join('')}
            </ul>
        </div>
    `;
}

function switchEventDetailsTab(tabId) {
    const panels = document.querySelectorAll('.event-details-tab-panel');
    panels.forEach((panel) => {
        panel.style.display = panel.id === tabId ? 'block' : 'none';
    });

    const buttons = document.querySelectorAll('.event-details-tab');
    buttons.forEach((btn) => {
        const target = btn.getAttribute('data-tab-target');
        btn.classList.toggle('active', target === tabId);
    });
}

function setupEventDetailsTabs() {
    const tabButtons = document.querySelectorAll('.event-details-tab');
    if (!tabButtons.length) return;

    tabButtons.forEach((btn) => {
        btn.addEventListener('click', () => {
            const target = btn.getAttribute('data-tab-target');
            if (!target) return;
            switchEventDetailsTab(target);
        });
    });

    switchEventDetailsTab('eventBreakdownTab');
}

// Add styling for active tabs
const style = document.createElement('style');
style.textContent = `
    .breakdown-tab.active {
        border-bottom: 3px solid #1976d2;
        color: #1976d2;
        font-weight: 600;
    }
    .breakdown-tab {
        transition: all 0.3s ease;
    }
    .breakdown-tab:hover {
        color: #1976d2;
    }
    .event-details-tab.active {
        background: #9B0F06 !important;
        color: #fff !important;
        border-color: #9B0F06 !important;
    }
`;
if (document.head) document.head.appendChild(style);

// Event Modal Handlers
document.addEventListener('DOMContentLoaded', () => {
    setupEventDetailsTabs();

    const addEventBtn = document.getElementById('addEventBtn');
    if (addEventBtn) {
        addEventBtn.addEventListener('click', () => {
            document.getElementById('criteriaFieldsContainer').innerHTML = '';
            document.getElementById('addEventForm').reset();
            showModal('addEventModal');
            // Reset criteria requirement indicator
            updateCriteriaRequirement();
            // Show one criteria block by default so name/details/percentage are visible immediately.
            addCriteriaField();
        });
    }

    // Tournament checkbox toggle
    const isTournamentCheckbox = document.getElementById('isTournamentEvent');
    if (isTournamentCheckbox) {
        isTournamentCheckbox.addEventListener('change', updateCriteriaRequirement);
    }

    // delete buttons
    const deleteEventBtn = document.getElementById('deleteEventBtn');
    if (deleteEventBtn) {
        deleteEventBtn.addEventListener('click', () => {
            deleteEventConfirm(currentEventId);
        });
    }
    const deleteParticipantBtn = document.getElementById('deleteParticipantBtn');
    if (deleteParticipantBtn) {
        deleteParticipantBtn.addEventListener('click', () => {
            deleteParticipantConfirm(currentParticipantId);
        });
    }

    const sortDirSelect = document.getElementById('participantSortDirection');
    const problemNameInput = document.getElementById('participantProblemNameInput');
    const limitInput = document.getElementById('participantsLimitInput');
    const applySortBtn = document.getElementById('applyParticipantSortBtn');
    if (applySortBtn && sortDirSelect && limitInput) {
        applySortBtn.addEventListener('click', () => {
            participantSortDirection = sortDirSelect.value === 'asc' ? 'asc' : 'desc';
            participantProblemNameFilter = (problemNameInput?.value || '').trim();
            const limitVal = parseInt(limitInput.value, 10);
            participantLimit = isNaN(limitVal) || limitVal <= 0 ? null : limitVal;
            if (currentEventId) loadEventParticipants(currentEventId);
        });
    }

    const addCriteriaFieldBtn = document.getElementById('addCriteriaFieldBtn');
    if (addCriteriaFieldBtn) {
        addCriteriaFieldBtn.addEventListener('click', addCriteriaField);
    }
    const criteriaPercentageInput = document.getElementById('criteriaPercentage');
    if (criteriaPercentageInput) {
        criteriaPercentageInput.addEventListener('input', updateSingleCriteriaIndicator);
    }

    const createTopParticipantsEventBtn = document.getElementById('createTopParticipantsEventBtn');
    if (createTopParticipantsEventBtn) {
        createTopParticipantsEventBtn.addEventListener('click', createTopParticipantsEvent);
    }

    const importSubmissionsBtn = document.getElementById('importSubmissionsBtn');
    const refreshSubmissionsBtn = document.getElementById('refreshSubmissionsBtn');
    if (importSubmissionsBtn) {
        importSubmissionsBtn.addEventListener('click', importSubmissionsFromGoogleSheet);
    }
    if (refreshSubmissionsBtn) {
        refreshSubmissionsBtn.addEventListener('click', () => loadSubmissionsTable(currentEventId || null));
    }

    const exportTopBestExcelBtn = document.getElementById('exportTopBestExcelBtn');
    const exportTopBestWordBtn = document.getElementById('exportTopBestWordBtn');
    if (exportTopBestExcelBtn) {
        exportTopBestExcelBtn.addEventListener('click', () => downloadTopBestCategory('excel'));
    }
    if (exportTopBestWordBtn) {
        exportTopBestWordBtn.addEventListener('click', () => downloadTopBestCategory('word'));
    }

    const addEventForm = document.getElementById('addEventForm');
    if (addEventForm) {
        addEventForm.addEventListener('submit', handleAddEvent);
    }

    const editEventBtn = document.getElementById('editEventBtn');
    if (editEventBtn) {
        editEventBtn.addEventListener('click', () => {
            // Find current event and open edit modal
            const eventId = currentEventId;
            if (eventId) {
                const eventTitle = document.getElementById('eventTitle').textContent;
                // We need to fetch full event details for the modal
                adminApi.getEventDetails(eventId).then(result => {
                    if (result.success) {
                        const event = result.data.event;
                        openEditEventModal(eventId, event.event_name, event.description || '', event.start_date || '', event.end_date || '');
                    }
                });
            }
        });
    }

    const editEventForm = document.getElementById('editEventForm');
    if (editEventForm) {
        editEventForm.addEventListener('submit', handleEditEvent);
    }

    const addParticipantBtn = document.getElementById('addParticipantBtn');
    if (addParticipantBtn) {
        addParticipantBtn.addEventListener('click', () => {
            document.getElementById('addParticipantForm').reset();
            const problemInput = document.getElementById('participantProblemNameModal');
            if (problemInput) problemInput.value = '';
            resetMembersForm();
            updateTeamEnrollmentCount();
            showModal('addParticipantModal');
        });
    }

    const downloadParticipantTemplateBtn = document.getElementById('downloadParticipantTemplateBtn');
    if (downloadParticipantTemplateBtn) {
        downloadParticipantTemplateBtn.addEventListener('click', downloadParticipantTemplate);
    }
    const downloadParticipantTemplateBtnTop = document.getElementById('downloadParticipantTemplateBtnTop');
    if (downloadParticipantTemplateBtnTop) {
        downloadParticipantTemplateBtnTop.addEventListener('click', downloadParticipantTemplate);
    }

    const importParticipantsBtn = document.getElementById('importParticipantsBtn');
    const importParticipantsInput = document.getElementById('importParticipantsInput');
    if (importParticipantsBtn && importParticipantsInput) {
        importParticipantsBtn.addEventListener('click', () => importParticipantsInput.click());
        importParticipantsInput.addEventListener('change', handleImportParticipants);
    }

    const editParticipantForm = document.getElementById('editParticipantForm');
    if (editParticipantForm) {
        editParticipantForm.addEventListener('submit', handleEditParticipant);
        // Event delegation for remove member buttons in edit form
        editParticipantForm.addEventListener('click', (e) => {
            if (e.target.classList.contains('remove-member')) {
                e.preventDefault();
                e.target.parentElement.remove();
                updateRemoveButtonVisibilityEditor();
            }
        });
    }

    const editAddMemberBtn = document.getElementById('editAddMemberBtn');
    if (editAddMemberBtn) {
        editAddMemberBtn.addEventListener('click', (e) => {
            e.preventDefault();
            addMemberFieldEditor();
        });
    }

    const addMemberBtn = document.getElementById('addMemberBtn');
    if (addMemberBtn) {
        addMemberBtn.addEventListener('click', (e) => {
            e.preventDefault();
            addMemberField();
        });
    }

    // Team name input - update enrollment count on change
    const teamNameInput = document.getElementById('teamNameInput');
    if (teamNameInput) {
        teamNameInput.addEventListener('change', updateTeamEnrollmentCount);
    }

    const addParticipantForm = document.getElementById('addParticipantForm');
    if (addParticipantForm) {
        addParticipantForm.addEventListener('submit', handleAddParticipant);
        // Event delegation for remove member buttons
        addParticipantForm.addEventListener('click', (e) => {
            if (e.target.classList.contains('remove-member')) {
                e.preventDefault();
                e.target.parentElement.remove();
                updateRemoveButtonVisibility();
            }
        });
    }

    const addCriteriaBtn = document.getElementById('addCriteriaBtn');
    if (addCriteriaBtn) {
        addCriteriaBtn.addEventListener('click', () => {
            document.getElementById('addCriteriaForm').reset();
            updateSingleCriteriaIndicator();
            showModal('addCriteriaModal');
        });
    }

    const deleteAllParticipantsBtn = document.getElementById('deleteAllParticipantsBtn');
    if (deleteAllParticipantsBtn) {
        deleteAllParticipantsBtn.addEventListener('click', async () => {
            if (!currentEventId) return;
            const typed = prompt('Type "delete all" to remove every participant in this event. This cannot be undone.');
            if (typed && typed.trim().toLowerCase() === 'delete all') {
                const result = await adminApi.deleteAllParticipants(currentEventId);
                if (result.success) {
                    alert('All participants deleted.');
                    loadEventParticipants(currentEventId);
                } else {
                    alert(result.message || 'Error deleting participants.');
                }
            }
        });
    }

    const addCriteriaForm = document.getElementById('addCriteriaForm');
    if (addCriteriaForm) {
        addCriteriaForm.addEventListener('submit', handleAddCriteria);
    }

    // Setup search listeners
    setupEventSearchListeners();
    setupParticipantSearchListeners();
    initEventWeightControls();
});

// Update criteria requirement based on tournament checkbox
function updateCriteriaRequirement() {
    const isTournament = document.getElementById('isTournamentEvent').checked;
    const tournamentNote = document.getElementById('tournamentNote');
    const criteriaRequired = document.getElementById('criteriaRequired');
    
    if (isTournament) {
        // Show note that criteria is optional
        tournamentNote.style.display = 'block';
        // Hide asterisk (not required)
        criteriaRequired.style.display = 'none';
    } else {
        // Hide note
        tournamentNote.style.display = 'none';
        // Show asterisk (required)
        criteriaRequired.style.display = 'inline';
    }
}

function addCriteriaField() {
    const container = document.getElementById('criteriaFieldsContainer');
    const fieldCount = container.children.length + 1;
    const field = document.createElement('div');
    field.className = 'form-group';
    field.innerHTML = `
        <label>Criteria ${fieldCount}</label>
        <input type="text" class="criteria-name" name="criteria_name[]" aria-label="Criteria name" placeholder="Criteria name" required>
        <label style="margin-top:6px;">Details (optional)</label>
        <textarea class="criteria-details" name="criteria_details[]" aria-label="Criteria details" placeholder="Criteria details (optional)" rows="2"></textarea>
        <input type="number" class="criteria-percentage" name="criteria_percentage[]" aria-label="Criteria percentage" placeholder="Percentage" min="0" max="100" required>
        <button type="button" class="btn btn-secondary" onclick="removeCriteriaField(this)">Remove</button>
    `;
    container.appendChild(field);

    const percentageInput = field.querySelector('.criteria-percentage');
    if (percentageInput) {
        percentageInput.addEventListener('input', updateCriteriaTotalIndicator);
        percentageInput.addEventListener('blur', updateCriteriaTotalIndicator);
    }

    updateCriteriaTotalIndicator();
}

function removeCriteriaField(buttonEl) {
    if (!buttonEl || !buttonEl.parentElement) return;
    buttonEl.parentElement.remove();
    updateCriteriaTotalIndicator();
}

function getCriteriaTotalFromFields() {
    let total = 0;
    document.querySelectorAll('#criteriaFieldsContainer .criteria-percentage').forEach((input) => {
        total += parseFloat(input.value) || 0;
    });
    return total;
}

function updateCriteriaTotalIndicator() {
    const indicator = document.getElementById('criteriaTotalIndicator');
    if (!indicator) return;

    const total = getCriteriaTotalFromFields();
    indicator.textContent = total > 100
        ? `Total: ${total}% (exceeds 100%)`
        : `Total: ${total}%`;
    indicator.style.color = total > 100 ? '#d32f2f' : '#2e7d32';
}

function getCurrentCriteriaTotalFromList() {
    let total = 0;
    document.querySelectorAll('#criteriaList .criteria-percentage').forEach((el) => {
        const match = (el.textContent || '').match(/([0-9]+(?:\.[0-9]+)?)%/);
        if (match) total += parseFloat(match[1]) || 0;
    });
    return total;
}

function updateSingleCriteriaIndicator() {
    const indicator = document.getElementById('singleCriteriaTotalIndicator');
    const pctInput = document.getElementById('criteriaPercentage');
    if (!indicator || !pctInput) return;

    const nextValue = parseFloat(pctInput.value) || 0;
    const currentTotal = getCurrentCriteriaTotalFromList();
    const projected = currentTotal + nextValue;
    indicator.textContent = projected > 100
        ? `Projected total: ${projected}% (exceeds 100%)`
        : `Projected total: ${projected}%`;
    indicator.style.color = projected > 100 ? '#d32f2f' : '#2e7d32';
}

async function handleAddEvent(e) {
    e.preventDefault();

    const eventName = document.getElementById('eventName').value;
    const description = document.getElementById('eventDescription').value;
    const startDate = document.getElementById('startDate').value;
    const endDate = document.getElementById('endDate').value;
    const isTournament = document.getElementById('isTournamentEvent').checked;

    const criteria = [];
    document.querySelectorAll('#criteriaFieldsContainer .form-group').forEach(field => {
        const name = field.querySelector('.criteria-name').value;
        const details = field.querySelector('.criteria-details')?.value || '';
        const percentage = parseFloat(field.querySelector('.criteria-percentage').value);
        if (name && percentage) {
            criteria.push({ criteria_name: name, criteria_details: details, percentage, max_score: percentage });
        }
    });

    const totalPercentage = criteria.reduce((sum, c) => sum + (parseFloat(c.percentage) || 0), 0);
    if (!isTournament && totalPercentage > 100) {
        alert(`Total criteria percentage is ${totalPercentage}%. Please keep it at 100% or below.`);
        return;
    }

    // Criteria are only required if NOT a tournament event
    if (!isTournament && criteria.length === 0) {
        alert('Please add at least one criteria (or mark as Tournament Event to skip)');
        return;
    }

    const result = await adminApi.createEvent({
        event_name: eventName,
        description,
        start_date: startDate || null,
        end_date: endDate || null,
        is_tournament: isTournament,
        criteria: criteria.length > 0 ? criteria : [{ criteria_name: 'Tournament', percentage: 100, max_score: 100 }]
    });

    if (result.success) {
        hideModal('addEventModal');
        loadEvents();
    } else {
        alert(result.message || 'Error creating event');
    }
}

async function handleAddParticipant(e) {
    e.preventDefault();

    const eventId = currentEventId || sessionStorage.getItem('currentEventId');
    const teamName = document.getElementById('teamNameInput').value;
    const problemName = document.getElementById('participantProblemNameModal')?.value || '';

    if (!eventId) {
        alert('No event selected. Please choose an event before adding participants.');
        return;
    }

    if (!teamName || teamName.trim() === '') {
        alert('Team name is required');
        return;
    }

    // Collect all member names
    const memberInputs = document.querySelectorAll('.member-name-input');
    const members = [];
    memberInputs.forEach(input => {
        if (input.value && input.value.trim()) {
            members.push(input.value.trim());
        }
    });

    if (members.length === 0) {
        alert('At least one member name is required');
        return;
    }

    const payload = {
        event_id: eventId,
        team_name: teamName.trim(),
        problem_name: problemName,
        members: members
    };
    console.log('Adding team participants payload:', payload);
    const result = await adminApi.addParticipant(payload);

    if (result.success) {
        hideModal('addParticipantModal');
        document.getElementById('teamNameInput').readOnly = false;
        loadEventParticipants(eventId);
    } else {
        alert(result.message || 'Error adding participants');
    }
}

function resetMembersForm() {
    const container = document.getElementById('membersContainer');
    container.innerHTML = `
        <div class="member-input-group">
            <input type="text" class="member-name-input" name="member_name[]" aria-label="Team member name" placeholder="Member name" required>
            <button type="button" class="btn btn-danger btn-small remove-member" style="display:none;">Remove</button>
        </div>
    `;
    updateRemoveButtonVisibility();
}

function addMemberField() {
    const container = document.getElementById('membersContainer');
    const newField = document.createElement('div');
    newField.className = 'member-input-group';
    newField.innerHTML = `
        <input type="text" class="member-name-input" name="member_name[]" aria-label="Team member name" placeholder="Member name">
        <button type="button" class="btn btn-danger btn-small remove-member">Remove</button>
    `;
    container.appendChild(newField);
    updateRemoveButtonVisibility();
}

// Download participant import template (CSV for Excel)
async function downloadParticipantTemplate() {
    const eventId = currentEventId || sessionStorage.getItem('currentEventId');
    if (!eventId) {
        alert('Please select an event first.');
        return;
    }
    try {
        const headers = adminApi.getHeaders();
        // remove content-type so browser can handle binary
        delete headers['Content-Type'];
        const resp = await fetch(`${API_BASE_URL}/participants/admin/export-teams-custom?event_id=${eventId}`, {
            method: 'GET',
            headers,
            cache: 'no-store'
        });
        if (!resp.ok) {
            alert('Failed to download template.');
            return;
        }
        const blob = await resp.blob();
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'hackathon_30_teams_template.xlsx';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    } catch (err) {
        console.error('Download template error:', err);
        alert('Network error while downloading template.');
    }
}

async function handleImportParticipants(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    if (!currentEventId) {
        alert('Please select an event first.');
        return;
    }

    const formData = new FormData();
    formData.append('file', file);
    formData.append('event_id', currentEventId);

    try {
        const headers = adminApi.getHeaders();
        delete headers['Content-Type']; // let browser set boundary
        const resp = await fetch(`${API_BASE_URL}/participants/admin/import-teams-custom`, {
            method: 'POST',
            headers,
            body: formData,
        });
        const result = await resp.json();
        if (result.success) {
            const data = result.data || {};
            alert(`Import complete. Teams processed: ${data.processed || 0}, new teams: ${data.teamsCreated || 0}, members added: ${data.membersAdded || 0}, duplicates: ${data.duplicates || 0}, limit skipped: ${data.limitSkipped || 0}.`);
            loadEventParticipants(currentEventId);
        } else {
            alert(result.message || 'Import failed.');
        }
    } catch (err) {
        console.error('Import participants error:', err);
        alert('Network error during import.');
    }
    e.target.value = ''; // reset file input
}

async function handleParticipantSingleFileSelected(participantId, inputEl, fileType) {
    const file = inputEl?.files && inputEl.files[0] ? inputEl.files[0] : null;
    if (!file) return;

    const isPdf = fileType === 'pdf';
    const isVideo = fileType === 'video';

    if (isPdf && !/\.pdf$/i.test(file.name)) {
        alert('Please select a PDF file.');
        inputEl.value = '';
        return;
    }
    if (isVideo && !/\.(mp4|mov|webm|mkv)$/i.test(file.name)) {
        alert('Please select a supported video file (mp4, mov, webm, mkv).');
        inputEl.value = '';
        return;
    }

    const formData = new FormData();
    if (isPdf) formData.append('pdf_file', file);
    if (isVideo) formData.append('video_file', file);

    const result = await adminApi.uploadParticipantFiles(participantId, formData);
    if (result.success) {
        alert(`${isPdf ? 'PDF' : 'Video'} uploaded successfully.`);
        if (currentEventId) {
            await loadEventParticipants(currentEventId);
        }
    } else {
        alert(result.message || 'Error uploading file.');
    }

    inputEl.value = '';
}

function updateRemoveButtonVisibility() {
    const container = document.getElementById('membersContainer');
    const groups = container.querySelectorAll('.member-input-group');
    const removeButtons = container.querySelectorAll('.remove-member');
    
    removeButtons.forEach(btn => {
        btn.style.display = groups.length > 1 ? 'inline-block' : 'none';
    });
}

function buildTopParticipantsFromRows(participants) {
    return (participants || [])
        .map((row) => ({
            id: row.id,
            participantName: (row.participant_name || '').trim(),
            teamName: (row.team_name || '').trim() || null,
            registrationNumber: row.registration_number || null,
            problemName: row.problem_name || '',
            score: Number.isFinite(parseFloat(row.total_score)) ? parseFloat(row.total_score) : null
        }))
        .filter((row) => row.participantName && row.score !== null)
        .sort((a, b) => b.score - a.score);
}

async function createTopParticipantsEvent() {
    const eventId = currentEventId || sessionStorage.getItem('currentEventId');
    if (!eventId) {
        alert('Please select an event first.');
        return;
    }

    const createBtn = document.getElementById('createTopParticipantsEventBtn');
    const topCountInput = document.getElementById('topParticipantsCount');
    const eventNameInput = document.getElementById('topParticipantsEventName');
    const topCountRaw = String(topCountInput?.value || '').trim().toLowerCase();
    const topCountMatch = topCountRaw.match(/\d+/);
    const topCount = topCountMatch ? parseInt(topCountMatch[0], 10) : NaN;

    if (!Number.isFinite(topCount) || topCount <= 0) {
        alert('Please enter a valid participant count (example: top3).');
        return;
    }

    if (createBtn) createBtn.disabled = true;

    try {
        const [eventDetailsResult, participantsResult] = await Promise.all([
            adminApi.getEventDetails(eventId),
            adminApi.getEventParticipants(eventId)
        ]);

        if (!eventDetailsResult.success) {
            alert(eventDetailsResult.message || 'Unable to load event details.');
            return;
        }
        if (!participantsResult.success) {
            alert(participantsResult.message || 'Unable to load participants.');
            return;
        }

        const rankedParticipants = buildTopParticipantsFromRows(participantsResult.data || []);
        const selectedParticipants = rankedParticipants.slice(0, topCount);

        if (selectedParticipants.length === 0) {
            alert('No ranked participants found for this event yet.');
            return;
        }

        const sourceEvent = eventDetailsResult.data?.event || {};
        const sourceCriteria = Array.isArray(eventDetailsResult.data?.criteria) ? eventDetailsResult.data.criteria : [];
        const providedName = (eventNameInput?.value || '').trim();
        const newEventName = providedName || `${sourceEvent.event_name || 'Event'} - Top ${selectedParticipants.length} Participants`;

        const createResult = await adminApi.createEvent({
            event_name: newEventName,
            description: `Top ${selectedParticipants.length} participants from ${sourceEvent.event_name || 'source event'}`,
            start_date: null,
            end_date: null,
            is_tournament: false,
            criteria: sourceCriteria.length > 0
                ? sourceCriteria.map(c => ({
                    criteria_name: c.criteria_name,
                    criteria_details: c.criteria_details || '',
                    percentage: c.percentage,
                    max_score: c.max_score
                }))
                : [{ criteria_name: 'Overall', criteria_details: 'Top participants selection', percentage: 100, max_score: 100 }]
        });

        if (!createResult.success) {
            alert(createResult.message || 'Failed to create top event.');
            return;
        }

        const newEventId = createResult.data?.event_id;
        if (!newEventId) {
            alert('Event was created but new event ID was not returned.');
            return;
        }

        let insertedParticipants = 0;
        for (const participant of selectedParticipants) {
            const addResult = await adminApi.addParticipant({
                event_id: newEventId,
                participant_name: participant.participantName,
                team_name: participant.teamName,
                registration_number: participant.registrationNumber,
                problem_name: participant.problemName
            });
            if (addResult.success) {
                insertedParticipants += 1;
            }
        }

        alert(`Created "${newEventName}" with top ${insertedParticipants}/${selectedParticipants.length} participants.`);
        if (eventNameInput) eventNameInput.value = '';
        await loadEvents();
        await selectEvent(newEventId);
    } catch (error) {
        console.error('createTopParticipantsEvent error:', error);
        alert('Error creating top event.');
    } finally {
        if (createBtn) createBtn.disabled = false;
    }
}

// Prefill add-member modal for an existing team (team name locked)
function openAddMemberForTeam(teamName) {
    const teamInput = document.getElementById('teamNameInput');
    if (!teamInput) return;
    document.getElementById('addParticipantForm').reset();
    resetMembersForm();
    teamInput.value = teamName || '';
    teamInput.readOnly = true;
    const problemSelect = document.getElementById('participantProblemNameModal');
    if (problemSelect && currentEventId) {
        adminApi.getEventParticipants(currentEventId).then((result) => {
            if (!result.success) return;
            const match = (result.data || []).find(p => (p.team_name || '') === (teamName || '') && p.problem_name);
            if (match) problemSelect.value = String(match.problem_name).toLowerCase();
        });
    }
    updateRemoveButtonVisibility();
    updateTeamEnrollmentCount();
    showModal('addParticipantModal');
}

async function updateTeamEnrollmentCount() {
    const teamName = document.getElementById('teamNameInput').value;
    const eventId = currentEventId || sessionStorage.getItem('currentEventId');
    
    if (!teamName || !eventId) {
        document.getElementById('teamEnrollmentCount').textContent = '0';
        return;
    }
    
    // Count existing participants with this team name in this event
    const result = await adminApi.getEventParticipants(eventId);
    if (result.success) {
        const count = result.data.filter(p => p.team_name === teamName).length;
        document.getElementById('teamEnrollmentCount').textContent = count;
    }
}

async function handleAddCriteria(e) {
    e.preventDefault();

    const eventId = currentEventId;
    const criteriaName = document.getElementById('criteriaName').value;
    const criteriaDetails = document.getElementById('criteriaDetails').value;
    const percentage = parseFloat(document.getElementById('criteriaPercentage').value);

    const eventDetails = await adminApi.getEventDetails(eventId);
    if (!eventDetails.success) {
        alert(eventDetails.message || 'Unable to validate criteria percentage.');
        return;
    }
    const currentTotal = (eventDetails.data.criteria || []).reduce((sum, c) => sum + (parseFloat(c.percentage) || 0), 0);
    const projected = currentTotal + (parseFloat(percentage) || 0);
    if (projected > 100) {
        alert(`Cannot add criteria. Total would become ${projected}% (max is 100%).`);
        return;
    }

    const result = await adminApi.addCriteria({
        event_id: eventId,
        criteria_name: criteriaName,
        criteria_details: criteriaDetails,
        percentage
    });

    if (result.success) {
        hideModal('addCriteriaModal');
        const eventDetails = await adminApi.getEventDetails(eventId);
        if (eventDetails.success) {
            loadEventCriteria(eventDetails.data.criteria);
        }
    } else {
        alert(result.message || 'Error adding criteria');
    }
}

async function deleteCriteria(criteriaId) {
    if (confirm('Are you sure you want to delete this criteria?')) {
        const result = await adminApi.deleteCriteria(criteriaId);

        if (result.success) {
            const eventDetails = await adminApi.getEventDetails(currentEventId);
            if (eventDetails.success) {
                loadEventCriteria(eventDetails.data.criteria);
            }
        }
    }
}

// destructively remove an event after typing confirm
async function deleteEventConfirm(eventId) {
    if (!eventId) return;
    const typed = prompt('Type "confirm" to delete this event. This action cannot be undone.');
    if (typed && typed.trim().toLowerCase() === 'confirm') {
        const result = await adminApi.deleteEvent(eventId);
        if (result.success) {
            alert('Event deleted');
            currentEventId = null;
            sessionStorage.removeItem('currentEventId');
            loadEvents();
            switchSection('events');
        } else {
            alert(result.message || 'Error deleting event');
        }
    }
}

// remove participant after confirm typing
async function deleteParticipantConfirm(participantId) {
    if (!participantId) return;
    const typed = prompt('Type "confirm" to delete this participant. This action cannot be undone.');
    if (typed && typed.trim().toLowerCase() === 'confirm') {
        const result = await adminApi.deleteParticipant(participantId);
        if (result.success) {
            alert('Participant deleted');
            currentParticipantId = null;
            // refresh participants list and go back
            loadEventParticipants(currentEventId);
            switchSection('eventDetails');
        } else {
            alert(result.message || 'Error deleting participant');
        }
    }
}

async function openUpdateCriteriaPrompt(criteriaId, currentName, currentDetails, currentPercentage) {
    const nextName = prompt('Update criteria name:', currentName || '');
    if (nextName === null) return;
    if (!nextName.trim()) {
        alert('Criteria name is required.');
        return;
    }

    const nextDetails = prompt('Update criteria details/description:', currentDetails || '');
    if (nextDetails === null) return;

    const percentageRaw = prompt('Update criteria percentage (0-100):', String(currentPercentage ?? '0'));
    if (percentageRaw === null) return;

    const nextPercentage = parseFloat(percentageRaw);
    if (!Number.isFinite(nextPercentage) || nextPercentage < 0 || nextPercentage > 100) {
        alert('Please enter a valid percentage between 0 and 100.');
        return;
    }

    const eventDetails = await adminApi.getEventDetails(currentEventId);
    if (!eventDetails.success) {
        alert(eventDetails.message || 'Unable to validate criteria update.');
        return;
    }
    const otherTotal = (eventDetails.data.criteria || [])
        .filter(c => Number(c.id) !== Number(criteriaId))
        .reduce((sum, c) => sum + (parseFloat(c.percentage) || 0), 0);
    const projected = otherTotal + nextPercentage;
    if (projected > 100) {
        alert(`Cannot update criteria. Total would become ${projected}% (max is 100%).`);
        return;
    }

    const result = await adminApi.updateCriteria(criteriaId, {
        criteria_name: nextName.trim(),
        criteria_details: nextDetails.trim(),
        percentage: nextPercentage
    });

    if (!result.success) {
        alert(result.message || 'Error updating criteria');
        return;
    }

    const refreshed = await adminApi.getEventDetails(currentEventId);
    if (refreshed.success) {
        loadEventCriteria(refreshed.data.criteria);
    }
}

// Delete all participants for a given team name in current event
async function deleteTeamParticipants(teamName) {
    if (!teamName) return;
    const confirmTxt = prompt(`Type "confirm" to delete all members of team "${teamName}". This cannot be undone.`);
    if (!confirmTxt || confirmTxt.trim().toLowerCase() !== 'confirm') return;
    const eventId = currentEventId || sessionStorage.getItem('currentEventId');
    const result = await adminApi.getEventParticipants(eventId);
    if (result.success) {
        const matches = result.data.filter(p => (p.team_name || '') === teamName);
        for (const p of matches) {
            await adminApi.deleteParticipant(p.id);
        }
        loadEventParticipants(eventId);
    }
}

function formatDate(dateString) {
    if (!dateString) return null;
    return new Date(dateString).toLocaleString();
}

function openEditEventModal(eventId, eventName, description, startDate, endDate) {
    document.getElementById('editEventId').value = eventId;
    document.getElementById('editEventName').value = eventName;
    document.getElementById('editEventDescription').value = description;
    document.getElementById('editStartDate').value = startDate;
    document.getElementById('editEndDate').value = endDate;
    showModal('editEventModal');
}

async function handleEditEvent(e) {
    e.preventDefault();

    const eventId = document.getElementById('editEventId').value;
    const eventName = document.getElementById('editEventName').value;
    const description = document.getElementById('editEventDescription').value;
    const startDate = document.getElementById('editStartDate').value;
    const endDate = document.getElementById('editEndDate').value;

    const result = await adminApi.updateEvent(eventId, {
        event_name: eventName,
        description,
        start_date: startDate || null,
        end_date: endDate || null
    });

    if (result.success) {
        hideModal('editEventModal');
        // Reload the event details to show updated info
        selectEvent(eventId);
        loadEvents();
    } else {
        alert(result.message || 'Error updating event');
    }
}

function openEditParticipantModal(participantId, teamName, eventId) {
    document.getElementById('editParticipantId').value = participantId;
    document.getElementById('editTeamName').value = teamName;
    
    // Reset members form
    const container = document.getElementById('editMembersContainer');
    container.innerHTML = `
        <div class="member-input-group">
            <input type="text" class="member-name-input" name="edit_member_name[]" aria-label="Team member name" placeholder="Member name" required>
            <button type="button" class="btn btn-danger btn-small remove-member" style="display:none;">Remove</button>
        </div>
    `;
    
    showModal('editParticipantModal');
}

async function handleEditParticipant(e) {
    e.preventDefault();

    const participantId = document.getElementById('editParticipantId').value;
    const teamName = document.getElementById('editTeamName').value;
    
    // Collect all member names
    const memberInputs = document.querySelectorAll('#editMembersContainer .member-name-input');
    const members = [];
    memberInputs.forEach(input => {
        if (input.value && input.value.trim()) {
            members.push(input.value.trim());
        }
    });

    if (members.length === 0) {
        alert('Participant name is required');
        return;
    }

    if (members.length > 1) {
        alert('Please enter only one participant name when editing an existing participant.');
        return;
    }

    const eventId = currentEventId || sessionStorage.getItem('currentEventId');

    const result = await adminApi.updateParticipant(participantId, {
        participant_name: members[0],
        team_name: teamName
    });

    if (result.success) {
        hideModal('editParticipantModal');
        loadEventParticipants(eventId);
    } else {
        alert(result.message || 'Error updating participant');
    }
}

function addMemberFieldEditor() {
    const container = document.getElementById('editMembersContainer');
    const newField = document.createElement('div');
    newField.className = 'member-input-group';
    newField.innerHTML = `
        <input type="text" class="member-name-input" name="edit_member_name[]" aria-label="Team member name" placeholder="Member name">
        <button type="button" class="btn btn-danger btn-small remove-member">Remove</button>
    `;
    container.appendChild(newField);
    updateRemoveButtonVisibilityEditor();
}

function updateRemoveButtonVisibilityEditor() {
    const container = document.getElementById('editMembersContainer');
    const groups = container.querySelectorAll('.member-input-group');
    const removeButtons = container.querySelectorAll('.remove-member');
    
    removeButtons.forEach(btn => {
        btn.style.display = groups.length > 1 ? 'inline-block' : 'none';
    });
}

// Search/Filter functionality
function setupEventSearchListeners() {
    const eventsSearchBox = document.getElementById('eventsSearchBox');
    
    if (eventsSearchBox) {
        eventsSearchBox.addEventListener('keyup', filterEvents);
    }
}

async function importSubmissionsFromGoogleSheet() {
    const sheetInput = document.getElementById('googleSheetUrlInput');
    const url = (sheetInput?.value || '').trim();
    if (!url) {
        alert('Please enter a public Google Sheet URL.');
        return;
    }

    const result = await adminApi.importSubmissionsFromGoogleSheet(url, null);
    if (!result.success) {
        alert(result.message || 'Failed to import submissions.');
        return;
    }

    const imported = result.data?.imported ?? 0;
    const skipped = result.data?.skipped ?? 0;
    const skipDetails = Array.isArray(result.data?.skipDetails) ? result.data.skipDetails : [];
    let message = `Import complete. Imported: ${imported}, Skipped: ${skipped}.`;
    if (skipDetails.length) {
        const lines = skipDetails.map((d) => `Row ${d.row}: ${d.reason}`);
        message += `\n\nSkipped rows:\n${lines.join('\n')}`;
    }
    alert(message);
    await loadSubmissionsTable(currentEventId || null);
}

async function downloadTopBestCategory(format) {
    if (!currentEventId) {
        alert('Please select an event first.');
        return;
    }

    const result = await adminApi.exportTopBestCategory(currentEventId, format);
    if (!result.success) {
        alert(result.message || 'Failed to export top best category data.');
        return;
    }

    const blob = result.data?.blob;
    const filename = result.data?.filename || (format === 'word' ? 'top_best_category.doc' : 'top_best_category.xlsx');
    if (!blob) {
        alert('No file data returned by server.');
        return;
    }

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
}

async function loadSubmissionsTable(eventId = null) {
    const body = document.getElementById('submissionsTableBody');
    if (!body) return;

    body.innerHTML = '<tr><td colspan="5" class="text-muted" style="padding:10px;">Loading submissions...</td></tr>';
    const result = await adminApi.getSubmissions(null);
    if (!result.success) {
        body.innerHTML = `<tr><td colspan="5" class="text-muted" style="padding:10px;">${result.message || 'Unable to load submissions.'}</td></tr>`;
        return;
    }

    const rows = Array.isArray(result.data) ? result.data : [];
    if (!rows.length) {
        body.innerHTML = '<tr><td colspan="5" class="text-muted" style="padding:10px;">No imported submissions yet.</td></tr>';
        return;
    }

    body.innerHTML = rows.map((row) => `
        <tr>
            <td style="padding:8px; border-bottom:1px solid #f1ede6;">${row.team_name || ''}</td>
            <td style="padding:8px; border-bottom:1px solid #f1ede6;">${row.team_leader || ''}</td>
            <td style="padding:8px; border-bottom:1px solid #f1ede6;">${row.problem_name || ''}</td>
            <td style="padding:8px; border-bottom:1px solid #f1ede6;">
                ${row.pdf_link ? `<a class="btn btn-secondary" href="${row.pdf_link}" target="_blank" rel="noopener">View PDF</a>` : '<span class="text-muted">N/A</span>'}
            </td>
            <td style="padding:8px; border-bottom:1px solid #f1ede6;">
                ${row.video_link ? `<a class="btn btn-secondary" href="${row.video_link}" target="_blank" rel="noopener">Watch Video</a>` : '<span class="text-muted">N/A</span>'}
            </td>
        </tr>
    `).join('');
}

// Event-level weight controls
function initEventWeightControls() {
    const updateBtn = document.getElementById('updateWeightsBtnEvent');
    const sInput = document.getElementById('eventStudentWeightInput');
    const pInput = document.getElementById('eventPanelistWeightInput');
    if (!updateBtn || !sInput || !pInput) return;

    updateBtn.addEventListener('click', async () => {
        const studentWeight = parseInt(sInput.value, 10);
        const panelistWeight = parseInt(pInput.value, 10);

        if (isNaN(studentWeight) || isNaN(panelistWeight)) {
            alert('Please enter valid numbers');
            return;
        }

        if (studentWeight + panelistWeight !== 100) {
            alert('Student and Panelist weights must sum to 100%');
            return;
        }

        const result = await adminApi.updateEventScoringWeights(currentEventId, studentWeight, panelistWeight);
        if (result.success) {
            alert('Scoring weights updated successfully');
            // refresh current participant view if open
            if (currentParticipantId) {
                selectParticipant(currentEventId, currentParticipantId);
            }
            // refresh list totals to reflect new weights
            loadEventParticipants(currentEventId);
        } else {
            alert(result.message || 'Error updating weights');
        }
    });

    const updateEventWeightSum = () => {
        const sum = (parseInt(sInput.value) || 0) + (parseInt(pInput.value) || 0);
        const sumEl = document.getElementById('eventWeightSum');
        if (sumEl) {
            sumEl.textContent = `${sum}% total`;
            sumEl.style.color = sum === 100 ? '#2e7d32' : '#d32f2f';
        }
    };

    sInput.addEventListener('input', updateEventWeightSum);
    pInput.addEventListener('input', updateEventWeightSum);
    // expose for selectEvent
    window.updateEventWeightSum = updateEventWeightSum;
}

function filterEvents(e) {
    const searchTerm = e.target.value.toLowerCase();
    const eventCards = document.querySelectorAll('.event-card');
    
    eventCards.forEach(card => {
        const eventTitle = card.querySelector('h3').textContent.toLowerCase();
        const eventDesc = card.querySelector('p').textContent.toLowerCase();
        
        if (eventTitle.startsWith(searchTerm) || eventDesc.startsWith(searchTerm)) {
            card.style.display = '';
        } else {
            card.style.display = 'none';
        }
    });
}

function setupParticipantSearchListeners() {
    const participantsSearchBox = document.getElementById('participantsSearchBox');
    
    if (participantsSearchBox) {
        participantsSearchBox.addEventListener('keyup', filterParticipants);
    }
}

function filterParticipants(e) {
    const searchTerm = e.target.value.toLowerCase();
    const participantCards = document.querySelectorAll('.participant-card');
    
    participantCards.forEach(card => {
        const participantName = card.querySelector('h3').textContent.toLowerCase();
        const teamName = card.textContent.toLowerCase();
        
        if (participantName.startsWith(searchTerm) || teamName.startsWith(searchTerm)) {
            card.style.display = '';
        } else {
            card.style.display = 'none';
        }
    });
}
