/**
 * Tournament Management Module
 * Admin view: team management + bracket matches with per-match live links.
 */

let tournamentState = {
    selectedEventId: null,
    selectedTeams: [],
    eventTeams: [],
    matches: [],
    expandedMatchId: null,
    autoRefreshTimer: null,
    activeBracketTab: 'upper'
};

const TEAM_COLOR_PALETTE = [
    '#60a5fa', '#34d399', '#f59e0b', '#f472b6', '#a78bfa',
    '#22d3ee', '#f87171', '#84cc16', '#fb7185', '#38bdf8'
];

function initTournament() {
    setupEventListeners();
}

function setupEventListeners() {
    document.getElementById('createTournamentBtn')?.addEventListener('click', openCreateTournamentModal);
    document.getElementById('createTournamentForm')?.addEventListener('submit', handleCreateTournament);
    document.getElementById('tournamentEventSelect')?.addEventListener('change', handleTournamentEventSelect);
    document.getElementById('addTeamToTournamentBtn')?.addEventListener('click', openAddTeamModal);
    document.getElementById('addTeamToTournamentForm')?.addEventListener('submit', handleAddTeamToTournament);
    document.getElementById('generateBracketBtn')?.addEventListener('click', generateBracket);
    document.getElementById('resetBracketBtn')?.addEventListener('click', resetBracket);
    document.getElementById('refreshMatchesBtn')?.addEventListener('click', () => {
        if (tournamentState.selectedEventId) loadMatchesForEvent(tournamentState.selectedEventId);
    });
    document.getElementById('advanceRoundBtn')?.addEventListener('click', advanceToNextRound);

    document.getElementById('bracketTypeSelect')?.addEventListener('change', updateBracketButtonLabel);
    document.querySelectorAll('.admin-bracket-tab').forEach((btn) => {
        btn.addEventListener('click', () => {
            const tab = String(btn.dataset.bracketTab || '').toLowerCase();
            if (!tab) return;
            setActiveBracketTab(tab);
        });
    });

    document.querySelectorAll('.modal .close-btn').forEach((btn) => btn.addEventListener('click', closeAllModals));
    document.querySelectorAll('.close-btn-action').forEach((btn) => btn.addEventListener('click', closeAllModals));

    const tournamentSection = document.getElementById('tournamentSection');
    if (!tournamentSection) return;

    const observer = new MutationObserver(() => {
        const isActive = tournamentSection.classList.contains('active');
        if (isActive) {
            loadTournamentEvents();
            startAutoRefresh();
            if (tournamentState.selectedEventId) {
                loadMatchesForEvent(tournamentState.selectedEventId);
            }
        } else {
            stopAutoRefresh();
        }
    });

    observer.observe(tournamentSection, { attributes: true, attributeFilter: ['class'] });
}

function updateBracketButtonLabel() {
    const btn = document.getElementById('generateBracketBtn');
    const select = document.getElementById('bracketTypeSelect');
    if (!btn || !select) return;
    if (select.value === 'mobile_legends') {
        btn.textContent = 'Generate Mobile Legends Bracket';
    } else if (select.value === 'double_elimination') {
        btn.textContent = 'Generate Double Elimination Bracket';
    } else {
        btn.textContent = 'Generate Bracket';
    }
}

function startAutoRefresh() {
    stopAutoRefresh();
    tournamentState.autoRefreshTimer = setInterval(() => {
        if (tournamentState.selectedEventId) {
            loadMatchesForEvent(tournamentState.selectedEventId, { silent: true });
        }
    }, 10000);
}

function stopAutoRefresh() {
    if (tournamentState.autoRefreshTimer) {
        clearInterval(tournamentState.autoRefreshTimer);
        tournamentState.autoRefreshTimer = null;
    }
}

async function loadTournamentEvents() {
    try {
        const result = await adminApi.getEvents();
        if (!result.success || !Array.isArray(result.data)) {
            throw new Error(result.message || 'Unable to load events.');
        }

        const tournamentEvents = result.data.filter((event) => (
            event.is_tournament === true || event.is_tournament === 1 || String(event.is_tournament) === '1'
        ));

        const select = document.getElementById('tournamentEventSelect');
        if (!select) return;

        const selectedBefore = String(tournamentState.selectedEventId || '');
        select.innerHTML = '<option value="">-- Choose a tournament event --</option>';

        tournamentEvents.forEach((event) => {
            const option = document.createElement('option');
            option.value = event.id;
            option.textContent = event.event_name || event.name;
            if (selectedBefore && selectedBefore === String(event.id)) {
                option.selected = true;
            }
            select.appendChild(option);
        });

        if (!tournamentEvents.length) {
            showTournamentMessage('No tournament events found. Create an event and enable tournament mode.', 'info');
        }
    } catch (error) {
        console.error('Error loading tournament events:', error);
        showTournamentMessage(`Error loading events: ${error.message}`, 'error');
    }
}

async function handleTournamentEventSelect(e) {
    const eventId = Number(e.target.value) || null;
    tournamentState.selectedEventId = eventId;
    tournamentState.expandedMatchId = null;
    tournamentState.activeBracketTab = 'upper';

    const teamsArea = document.getElementById('teamsManagementArea');
    const bracketArea = document.getElementById('bracketGenerationArea');

    if (!eventId) {
        tournamentState.eventTeams = [];
        tournamentState.selectedTeams = [];
        tournamentState.matches = [];
        if (teamsArea) teamsArea.style.display = 'none';
        if (bracketArea) bracketArea.style.display = 'none';
        renderTournamentTeamsList([]);
        renderMatches([]);
        return;
    }

    if (teamsArea) teamsArea.style.display = 'block';
    if (bracketArea) bracketArea.style.display = 'block';

    await loadTeamsForEvent(eventId);
    await loadMatchesForEvent(eventId);
}

async function loadTeamsForEvent(eventId) {
    try {
        const result = await adminApi.getEventParticipants(eventId);
        if (!result.success || !Array.isArray(result.data)) {
            throw new Error(result.message || 'Unable to load teams.');
        }

        const groups = new Map();
        result.data.forEach((participant) => {
            const teamName = (participant.team_name || '').trim();
            if (!teamName) return;
            if (!groups.has(teamName)) {
                groups.set(teamName, {
                    id: participant.id,
                    team_name: teamName,
                    registration_number: participant.registration_number || ''
                });
            }
        });

        tournamentState.eventTeams = Array.from(groups.values());
        tournamentState.selectedTeams = [...tournamentState.eventTeams];
        renderTournamentTeamsList(tournamentState.selectedTeams);
    } catch (error) {
        console.error('Error loading teams for event:', error);
        showTournamentMessage(`Error loading teams: ${error.message}`, 'error');
    }
}

function renderTournamentTeamsList(teams) {
    const container = document.getElementById('tournamentTeamsList');
    if (!container) return;

    if (!teams.length) {
        container.innerHTML = '<p class="tourney-empty-note">No teams selected yet.</p>';
        return;
    }

    container.innerHTML = teams.map((team) => `
        <div class="tournament-team-card tournament-team-chip">
            <div class="tournament-team-copy">
                <div class="tournament-team-name">${escapeHtml(team.team_name)}</div>
                <div class="tournament-team-meta">${escapeHtml(team.registration_number || 'Team')}</div>
            </div>
            <button class="btn btn-danger btn-small" onclick="removeTeamFromTournament(${Number(team.id)})">Remove</button>
        </div>
    `).join('');
}

function removeTeamFromTournament(teamId) {
    tournamentState.selectedTeams = tournamentState.selectedTeams.filter((team) => Number(team.id) !== Number(teamId));
    renderTournamentTeamsList(tournamentState.selectedTeams);
}

function openCreateTournamentModal() {
    const modal = document.getElementById('createTournamentModal');
    if (modal) modal.style.display = 'block';
}

async function handleCreateTournament(e) {
    e.preventDefault();

    const name = document.getElementById('tournamentEventName')?.value?.trim() || '';
    const description = document.getElementById('tournamentEventDescription')?.value?.trim() || '';

    if (!name) {
        showTournamentMessage('Tournament name is required.', 'error');
        return;
    }

    const today = new Date().toISOString().split('T')[0];
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + 30);

    const result = await adminApi.createEvent({
        event_name: name,
        description,
        start_date: today,
        end_date: endDate.toISOString().split('T')[0],
        is_tournament: true,
        criteria: []
    });

    if (!result.success) {
        showTournamentMessage(result.message || 'Failed to create tournament event.', 'error');
        return;
    }

    showTournamentMessage('Tournament event created successfully.', 'success');
    closeAllModals();
    document.getElementById('createTournamentForm')?.reset();
    loadTournamentEvents();
}

function openAddTeamModal() {
    if (!tournamentState.selectedEventId) {
        showTournamentMessage('Please select a tournament event first.', 'error');
        return;
    }

    const select = document.getElementById('availableTeamsSelect');
    if (!select) return;

    const availableTeams = tournamentState.eventTeams.filter(
        (team) => !tournamentState.selectedTeams.some((selected) => Number(selected.id) === Number(team.id))
    );

    if (!availableTeams.length) {
        showTournamentMessage('No additional teams available for this tournament event.', 'info');
        return;
    }

    select.innerHTML = '<option value="">-- Choose a team --</option>';
    availableTeams.forEach((team) => {
        const option = document.createElement('option');
        option.value = team.id;
        option.textContent = team.team_name;
        select.appendChild(option);
    });

    const modal = document.getElementById('addTeamToTournamentModal');
    if (modal) modal.style.display = 'block';
}

function handleAddTeamToTournament(e) {
    e.preventDefault();

    const teamId = Number(document.getElementById('availableTeamsSelect')?.value);
    if (!Number.isFinite(teamId) || teamId <= 0) {
        showTournamentMessage('Please select a valid team.', 'error');
        return;
    }

    const team = tournamentState.eventTeams.find((entry) => Number(entry.id) === teamId);
    if (!team) {
        showTournamentMessage('Team not found.', 'error');
        return;
    }

    tournamentState.selectedTeams.push(team);
    renderTournamentTeamsList(tournamentState.selectedTeams);
    closeAllModals();
    document.getElementById('addTeamToTournamentForm')?.reset();
    showTournamentMessage('Team added to tournament pool.', 'success');
}

async function generateBracket() {
    if (!tournamentState.selectedEventId) {
        showTournamentMessage('Please select a tournament event first.', 'error');
        return;
    }

    if (tournamentState.selectedTeams.length < 2) {
        showTournamentMessage('At least 2 teams are required to generate a bracket.', 'error');
        return;
    }

    const bracketType = document.getElementById('bracketTypeSelect')?.value || 'single_elimination';
    const confirmToken = window.prompt(`Type CONFIRM to generate a new ${bracketType.replace('_', ' ')} bracket. This will reset current bracket matches for this event.`);
    if (!confirmToken || String(confirmToken).trim().toUpperCase() !== 'CONFIRM') {
        showTournamentMessage('Bracket generation cancelled.', 'info');
        return;
    }

    const payload = {
        event_id: tournamentState.selectedEventId,
        team_ids: tournamentState.selectedTeams.map((team) => team.id),
        bracket_type: bracketType
    };

    const result = await adminApi.generateMatches(payload);
    if (!result.success) {
        showTournamentMessage(result.message || 'Failed to generate bracket matches.', 'error');
        return;
    }

    tournamentState.expandedMatchId = null;
    showTournamentMessage('Bracket generated successfully.', 'success');
    await loadMatchesForEvent(tournamentState.selectedEventId);
}

async function resetBracket() {
    if (!tournamentState.selectedEventId) {
        showTournamentMessage('Please select a tournament event first.', 'error');
        return;
    }

    const confirmToken = window.prompt('Type RESET to clear all matches for this tournament event.');
    if (!confirmToken || String(confirmToken).trim().toUpperCase() !== 'RESET') {
        showTournamentMessage('Bracket reset cancelled.', 'info');
        return;
    }

    const result = await adminApi.resetTournament(tournamentState.selectedEventId);
    if (!result.success) {
        showTournamentMessage(result.message || 'Unable to reset bracket.', 'error');
        return;
    }

    tournamentState.matches = [];
    tournamentState.expandedMatchId = null;
    renderMatches([]);
    showTournamentMessage(result.message || 'Bracket reset successfully.', 'success');
}

async function loadMatchesForEvent(eventId, options = {}) {
    const { silent = false } = options;
    if (!eventId) return;

    const result = await adminApi.getMatches(eventId);
    if (!result.success) {
        if (!silent) {
            showTournamentMessage(result.message || 'Unable to load matches.', 'error');
        }
        return;
    }

    tournamentState.matches = Array.isArray(result.data) ? result.data : [];
    renderMatches(tournamentState.matches);
}

function renderMatches(matches) {
    const container = document.getElementById('bracketContainer');
    if (!container) return;

    renderBracketFlow(matches);
    updateAdvanceRoundButton(matches);

    if (!matches.length) {
        setBracketTabsVisibility(false);
        container.innerHTML = '<p class="tourney-empty-note">No matches yet. Generate a bracket to create match cards.</p>';
        return;
    }

    const hasDouble = matches.some((m) => ['upper', 'lower', 'grand_final', 'grand_final_reset'].includes(String(m.bracket_type || '').toLowerCase()));
    const maxRound = Math.max(...matches.map((m) => Number(m.round_number || 1)));
    setBracketTabsVisibility(hasDouble);

    if (!hasDouble) {
        const grouped = matches.reduce((acc, match) => {
            const key = match.round_name || `Round ${match.round_number || 1}`;
            if (!acc[key]) acc[key] = [];
            acc[key].push(match);
            return acc;
        }, {});
        container.innerHTML = Object.keys(grouped).map((roundName) => {
            const roundMatches = grouped[roundName]
                .slice()
                .sort((a, b) => Number(a.match_order || 0) - Number(b.match_order || 0));
            return `
                <section class="admin-round-block">
                    <div class="admin-round-header">
                        <h4>${escapeHtml(roundName)}</h4>
                        <span>${roundMatches.length} match${roundMatches.length === 1 ? '' : 'es'}</span>
                    </div>
                    <div class="admin-round-grid">${roundMatches.map((match) => renderMatchCard(match, maxRound)).join('')}</div>
                </section>
            `;
        }).join('');
        return;
    }

    const byType = {
        upper: [],
        lower: [],
        grand_final: [],
        grand_final_reset: []
    };
    matches.forEach((m) => {
        const key = String(m.bracket_type || '').toLowerCase();
        if (byType[key]) byType[key].push(m);
    });

    const section = (title, arr, typeClass = '') => {
        if (!arr.length) return '';
        const visibleMatches = arr.filter(hasReadyOpponent);
        if (!visibleMatches.length) {
            return `<div class="admin-bracket-type-block ${escapeHtml(typeClass)}"><h3 class="admin-bracket-type-title">${escapeHtml(title)}</h3><p class="tourney-empty-note">No ready matchups yet for this bracket.</p></div>`;
        }
        const groupedByRound = visibleMatches.reduce((acc, match) => {
            const key = `${match.round_number || 1}::${match.round_name || `Round ${match.round_number || 1}`}`;
            if (!acc[key]) acc[key] = [];
            acc[key].push(match);
            return acc;
        }, {});
        const rounds = Object.entries(groupedByRound)
            .sort((a, b) => Number(a[0].split('::')[0]) - Number(b[0].split('::')[0]))
            .map(([key, roundMatches]) => {
                const roundName = key.split('::')[1];
                const sorted = roundMatches.slice().sort((a, b) => Number(a.match_order || 0) - Number(b.match_order || 0));
                return `
                    <section class="admin-round-block">
                        <div class="admin-round-header">
                            <h4>${escapeHtml(roundName)}</h4>
                            <span>${sorted.length} match${sorted.length === 1 ? '' : 'es'}</span>
                        </div>
                        <div class="admin-round-grid">${sorted.map((match) => renderMatchCard(match, maxRound)).join('')}</div>
                    </section>
                `;
            }).join('');
        return `<div class="admin-bracket-type-block ${escapeHtml(typeClass)}"><h3 class="admin-bracket-type-title">${escapeHtml(title)}</h3>${rounds}</div>`;
    };

    const tab = tournamentState.activeBracketTab;
    if (tab === 'lower') {
        container.innerHTML = section('LOWER BRACKET', byType.lower, 'bracket-lower');
    } else if (tab === 'finals') {
        container.innerHTML = section('FINALS', [...byType.grand_final, ...byType.grand_final_reset], 'bracket-finals');
    } else {
        container.innerHTML = section('UPPER BRACKET', byType.upper, 'bracket-upper');
    }
}

function renderBracketFlow(matches) {
    const flowContainer = document.getElementById('bracketFlowContainer');
    if (!flowContainer) return;

    if (!matches.length) {
        flowContainer.innerHTML = '';
        return;
    }
    const byType = {
        upper: matches.filter((m) => String(m.bracket_type || '').toLowerCase() === 'upper'),
        lower: matches.filter((m) => String(m.bracket_type || '').toLowerCase() === 'lower'),
        finals: matches.filter((m) => ['grand_final', 'grand_final_reset'].includes(String(m.bracket_type || '').toLowerCase())),
        single: matches.filter((m) => String(m.bracket_type || '').toLowerCase() === 'single')
    };

    if (byType.single.length && !byType.upper.length) {
        flowContainer.innerHTML = renderPreviewBracketBoard('Single Elimination', byType.single, { showChampion: true });
        return;
    }

    const tab = tournamentState.activeBracketTab;
    if (tab === 'lower') {
        flowContainer.innerHTML = renderPreviewBracketBoard('Lower Bracket', byType.lower);
    } else if (tab === 'finals') {
        flowContainer.innerHTML = renderPreviewBracketBoard('Finals', byType.finals, { showChampion: true });
    } else {
        flowContainer.innerHTML = renderPreviewBracketBoard('Upper Bracket', byType.upper);
    }
}

function renderPreviewBracketBoard(title, matches, options = {}) {
    const { showChampion = false } = options;
    if (!matches.length) {
        return `
            <div class="admin-bracket-hq-shell">
                <div class="admin-bracket-hq-header">
                    <div>
                        <div class="admin-bracket-hq-kicker">Visual Bracket</div>
                        <h3>${escapeHtml(title)}</h3>
                    </div>
                </div>
                <p class="tourney-empty-note">No matchups available yet.</p>
            </div>
        `;
    }

    const grouped = groupMatchesByRound(matches);
    const roundNumbers = Object.keys(grouped).map(Number).sort((a, b) => a - b);
    const rounds = roundNumbers.map((roundNumber) => grouped[roundNumber]);
    const champion = showChampion ? getPreviewChampionName(matches) : '';
    const baseMatches = Math.max(1, rounds[0]?.length || 1);
    const matchHeight = 108;

    const columnsHtml = rounds.map((roundMatches, roundIdx) => {
        const cellHeight = (baseMatches / Math.max(1, roundMatches.length)) * matchHeight;
        const cards = roundMatches.map((match, matchIdx) => {
            const topPad = matchIdx === 0
                ? Math.max(0, (cellHeight / 2) - (matchHeight / 2))
                : Math.max(0, cellHeight - matchHeight);
            const connector = roundIdx < rounds.length - 1
                ? renderPreviewConnector(cellHeight, matchIdx % 2 === 0, matchHeight)
                : '';
            return `
                <div class="admin-bracket-hq-wrap" style="padding-top:${topPad}px">
                    ${renderPreviewMatchCard(match)}
                    ${connector}
                </div>
            `;
        }).join('');

        return `
            <div class="admin-bracket-hq-column">
                <div class="admin-bracket-hq-round">${escapeHtml(getPreviewRoundLabel(roundMatches, roundIdx, rounds.length))}</div>
                <div class="admin-bracket-hq-list">${cards}</div>
            </div>
        `;
    }).join('');

    return `
        <div class="admin-bracket-hq-shell">
            <div class="admin-bracket-hq-header">
                <div>
                    <div class="admin-bracket-hq-kicker">Visual Bracket</div>
                    <h3>${escapeHtml(title)}</h3>
                </div>
                <div class="admin-bracket-hq-note">Click a match to jump to its admin controls below.</div>
            </div>
            <div class="admin-bracket-hq-scroll">
                <div class="admin-bracket-hq-row">
                    ${columnsHtml}
                    ${showChampion ? renderPreviewChampionCard(champion) : ''}
                </div>
            </div>
        </div>
    `;
}

function groupMatchesByRound(matches) {
    return matches.reduce((acc, match) => {
        const round = Number(match.round_number || 1);
        if (!acc[round]) acc[round] = [];
        acc[round].push(match);
        acc[round].sort((a, b) => Number(a.match_order || 0) - Number(b.match_order || 0));
        return acc;
    }, {});
}

function getPreviewRoundLabel(roundMatches, roundIdx, totalRounds) {
    const explicit = String(roundMatches[0]?.round_name || '').trim();
    if (explicit) return explicit;
    if (roundIdx === totalRounds - 1) return 'Final';
    return `Round ${roundIdx + 1}`;
}

function renderPreviewMatchCard(match) {
    const matchId = Number(match.id);
    const status = String(match.status || 'pending').toLowerCase();
    const winner = String(match.winner_team_name || '').trim();
    const teamA = String(match.teamA || 'TBD').trim() || 'TBD';
    const teamB = String(match.teamB || 'TBD').trim() || 'TBD';
    const teamAWins = Math.max(0, Number(match.teamA_wins || 0));
    const teamBWins = Math.max(0, Number(match.teamB_wins || 0));
    const isClickable = matchId > 0;
    const classes = ['admin-bracket-hq-match'];
    if (isClickable) classes.push('clickable');
    if (status === 'ongoing') classes.push('is-live');
    if (status === 'finished') classes.push('is-done');

    return `
        <div class="admin-bracket-hq-outer">
            <div class="admin-bracket-hq-num ${status === 'ongoing' ? 'is-next' : ''} ${status === 'finished' ? 'is-done' : ''}">
                <span class="admin-bracket-hq-dot"></span>
                Match #${Number(match.match_order || match.match_number || match.id)}
            </div>
            <button
                type="button"
                class="${classes.join(' ')}"
                onclick="${isClickable ? `focusMatchCard(${matchId})` : ''}"
                title="Open match controls for ${escapeAttr(teamA)} vs ${escapeAttr(teamB)}"
            >
                ${renderPreviewSlot(teamA, teamAWins, getPreviewSlotState(teamA, winner, status))}
                ${renderPreviewSlot(teamB, teamBWins, getPreviewSlotState(teamB, winner, status))}
            </button>
        </div>
    `;
}

function renderPreviewSlot(teamName, wins, state) {
    const name = String(teamName || 'TBD').trim() || 'TBD';
    const displayName = name === 'TBD' ? 'Waiting...' : name;
    const score = Number.isFinite(Number(wins)) ? Math.max(0, Number(wins)) : 0;
    return `
        <span class="admin-bracket-hq-slot ${state}">
            <span class="admin-bracket-hq-seed"></span>
            <span class="admin-bracket-hq-name ${name === 'TBD' ? 'tbd' : ''}">${escapeHtml(displayName)}</span>
            <span class="admin-bracket-hq-score">${score > 0 ? score : ''}</span>
        </span>
    `;
}

function getPreviewSlotState(teamName, winner, status) {
    const normalized = String(teamName || '').trim();
    if (!normalized || normalized.toUpperCase() === 'TBD') return '';
    if (normalized.toUpperCase() === 'BYE') return 's-bye';
    if (status === 'finished' && winner) {
        return normalized === winner ? 's-win' : 's-lose';
    }
    return '';
}

function renderPreviewConnector(cellHeight, isTop, matchHeight) {
    const half = cellHeight / 2;
    return `
        <div class="admin-bracket-hq-connector" style="height:${matchHeight}px">
            ${isTop
                ? `<div style="flex:1"></div><div class="admin-bracket-hq-line-h"></div><div class="admin-bracket-hq-line-v" style="height:${half}px"></div>`
                : `<div class="admin-bracket-hq-line-v" style="height:${half}px"></div><div class="admin-bracket-hq-line-h"></div><div style="flex:1"></div>`}
        </div>
    `;
}

function renderPreviewChampionCard(champion) {
    return `
        <div class="admin-bracket-hq-champion-wrap">
            <div class="admin-bracket-hq-champion">
                <div class="admin-bracket-hq-cup">Cup</div>
                <div class="admin-bracket-hq-title">Champion</div>
                <div class="admin-bracket-hq-name-final">${champion ? escapeHtml(champion) : 'TBD'}</div>
            </div>
        </div>
    `;
}

function getPreviewChampionName(matches) {
    const finalMatch = matches
        .slice()
        .sort((a, b) => Number(b.round_number || 0) - Number(a.round_number || 0) || Number(b.match_order || 0) - Number(a.match_order || 0))[0];
    return String(finalMatch?.winner_team_name || '').trim();
}

function setActiveBracketTab(tabName) {
    const normalized = ['upper', 'lower', 'finals'].includes(tabName) ? tabName : 'upper';
    tournamentState.activeBracketTab = normalized;
    document.querySelectorAll('.admin-bracket-tab').forEach((btn) => {
        const tab = String(btn.dataset.bracketTab || '').toLowerCase();
        btn.classList.toggle('active', tab === normalized);
    });
    renderMatches(tournamentState.matches || []);
}

function setBracketTabsVisibility(isVisible) {
    const tabs = document.getElementById('adminBracketTabs');
    if (!tabs) return;
    tabs.style.display = isVisible ? 'flex' : 'none';
}

function updateAdvanceRoundButton(matches) {
    const btn = document.getElementById('advanceRoundBtn');
    if (!btn) return;

    if (!matches.length) {
        btn.style.display = 'none';
        return;
    }

    const hasNonSingle = matches.some((m) => String(m.bracket_type || 'single') !== 'single');
    if (hasNonSingle) {
        btn.style.display = 'none';
        return;
    }

    const maxRound = Math.max(...matches.map((m) => Number(m.round_number || 1)));
    const latestRoundMatches = matches.filter((m) => Number(m.round_number || 1) === maxRound);
    const allReady = latestRoundMatches.length > 0 && latestRoundMatches.every((match) => (
        String(match.status || '').toLowerCase() === 'finished' && Number(match.winner_team_id || 0) > 0
    ));
    const isFinalRoundAlreadyDone = latestRoundMatches.length === 1 && allReady;
    btn.style.display = allReady && !isFinalRoundAlreadyDone ? '' : 'none';
}

function renderMatchCard(match, maxRound) {
    const matchId = Number(match.id);
    const isExpanded = tournamentState.expandedMatchId === matchId;
    const status = String(match.status || 'pending').toLowerCase();
    const hasWinner = Boolean(match.winner_team_name) || Number(match.winner_team_id || 0) > 0;
    const isLockedRound = status === 'finished' && hasWinner;
    const teamAColor = getTeamColor(match.teamA || '');
    const teamBColor = getTeamColor(match.teamB || '');
    const matchBorder = getMatchBorderColor(match.id);
    const statusColor = status === 'ongoing' ? '#b91c1c' : status === 'finished' ? '#166534' : '#475569';
    const hasLive = Boolean((match.facebook_live_url || '').trim());
    const showLiveBadge = status === 'ongoing' && hasLive;
    const winnerName = String(match.winner_team_name || '').trim();
    const winnerSide = winnerName && winnerName === String(match.teamA || '').trim()
        ? 'teamA'
        : (winnerName && winnerName === String(match.teamB || '').trim() ? 'teamB' : 'none');
    const winnerLabel = winnerSide === 'teamA'
        ? `${match.teamA} (Team A)`
        : (winnerSide === 'teamB' ? `${match.teamB} (Team B)` : 'Not selected');
    const sourceAValue = String(match.source_label_teamA || '').trim();
    const sourceBValue = String(match.source_label_teamB || '').trim();
    const sourceA = (sourceAValue && !/seed/i.test(sourceAValue)) ? `<div class="admin-source-label">A: ${escapeHtml(sourceAValue)}</div>` : '';
    const sourceB = (sourceBValue && !/seed/i.test(sourceBValue)) ? `<div class="admin-source-label">B: ${escapeHtml(sourceBValue)}</div>` : '';
    const bracketLabel = String(match.bracket_type || 'single').replace(/_/g, ' ').toUpperCase();
    const nextWinner = match.next_match_winner_id ? `W→#${Number(match.next_match_winner_id)}${String(match.next_match_winner_slot || 'A').toUpperCase()}` : 'W→—';
    const nextLoser = match.next_match_loser_id ? `L→#${Number(match.next_match_loser_id)}${String(match.next_match_loser_slot || 'A').toUpperCase()}` : 'L→—';
    const winTarget = Math.max(1, Number(match.win_target || 1));
    const teamAWins = Math.max(0, Number(match.teamA_wins || 0));
    const teamBWins = Math.max(0, Number(match.teamB_wins || 0));

    return `
        <article class="admin-match-card ${status === 'ongoing' ? 'is-ongoing' : ''} ${isLockedRound ? 'round-locked' : ''}" data-match-id="${matchId}" style="border:1px solid ${matchBorder}; border-left:4px solid ${teamAColor}; border-right:4px solid ${teamBColor}; box-shadow:0 0 0 1px ${matchBorder}33;">
            <div class="admin-match-head">
                <div>
                    <div class="admin-match-id">Match #${Number(match.match_order || 0)}</div>
                    <div class="admin-match-title">
                        <span class="team-indicator" style="background:${teamAColor};"></span>${escapeHtml(match.teamA)}
                        <span>vs</span>
                        <span class="team-indicator" style="background:${teamBColor};"></span>${escapeHtml(match.teamB)}
                    </div>
                </div>
                <div class="admin-match-badges">
                    <span class="admin-status-pill" style="background:#334155;">${escapeHtml(bracketLabel)}</span>
                    <span class="admin-status-pill" style="background:${statusColor};">${escapeHtml(status)}</span>
                    ${isLockedRound ? '<span class="admin-live-pill" style="background:#64748b;">ROUND ENDED</span>' : ''}
                    ${showLiveBadge ? '<span class="admin-live-pill">LIVE</span>' : ''}
                </div>
            </div>
            <div class="admin-match-winner"><strong>Winner:</strong> ${escapeHtml(winnerLabel)}</div>
            <div class="admin-match-winner"><strong>Series:</strong> ${teamAWins} - ${teamBWins} (First to ${winTarget})</div>
            <div class="admin-source-row">${sourceA}${sourceB}</div>
            <div class="admin-source-row">
                <div class="admin-source-label">${escapeHtml(nextWinner)}</div>
                <div class="admin-source-label">${escapeHtml(nextLoser)}</div>
            </div>
            <div class="admin-match-controls admin-series-controls">
                <input type="number" id="matchWinTarget-${matchId}" value="${winTarget}" min="1" max="7" class="search-box" placeholder="Wins needed" ${isLockedRound ? 'disabled' : ''}>
                <input type="number" id="matchTeamAWins-${matchId}" value="${teamAWins}" min="0" max="7" class="search-box" placeholder="${escapeAttr(match.teamA)} wins" ${isLockedRound ? 'disabled' : ''}>
                <input type="number" id="matchTeamBWins-${matchId}" value="${teamBWins}" min="0" max="7" class="search-box" placeholder="${escapeAttr(match.teamB)} wins" ${isLockedRound ? 'disabled' : ''}>
                <button class="btn btn-secondary tourney-mini-btn" onclick="saveMatchSeries(${matchId})" ${isLockedRound ? 'disabled' : ''}>Update Series</button>
            </div>

            <div class="admin-match-controls">
                <input type="text" id="matchLiveUrl-${matchId}" value="${escapeAttr(match.facebook_live_url || '')}" placeholder="Paste Discord stream URL" class="search-box" style="width:100%;" ${isLockedRound ? 'disabled' : ''}>
                <button class="btn btn-secondary tourney-mini-btn" onclick="saveMatchLiveUrl(${matchId})" ${isLockedRound ? 'disabled' : ''}>Save Link</button>
                <button class="btn btn-secondary tourney-mini-btn" onclick="removeMatchLiveUrl(${matchId})" ${isLockedRound ? 'disabled' : ''}>Remove Link</button>
                <select id="matchStatus-${matchId}" class="search-box" style="padding:8px 10px;" ${isLockedRound ? 'disabled' : ''}>
                    <option value="pending" ${status === 'pending' ? 'selected' : ''}>Pending</option>
                    <option value="ongoing" ${status === 'ongoing' ? 'selected' : ''}>Ongoing</option>
                    <option value="finished" ${status === 'finished' ? 'selected' : ''}>Finished</option>
                </select>
            </div>

            <div class="admin-match-actions">
                <button class="btn btn-primary tourney-mini-btn" onclick="updateMatchStatus(${matchId})" ${isLockedRound ? 'disabled' : ''}>Update Status</button>
                <button class="btn btn-secondary tourney-mini-btn" onclick="toggleMatchVideo(${matchId})">${isExpanded ? 'Switch Video' : 'Watch Video'}</button>
            </div>
            <div class="admin-match-controls admin-match-opponents">
                <input type="text" id="matchTeamA-${matchId}" value="${escapeAttr(match.teamA || '')}" class="search-box" placeholder="Team A name" ${isLockedRound ? 'disabled' : ''}>
                <input type="text" id="matchTeamB-${matchId}" value="${escapeAttr(match.teamB || '')}" class="search-box" placeholder="Team B name" ${isLockedRound ? 'disabled' : ''}>
                <button class="btn btn-secondary tourney-mini-btn" onclick="saveMatchOpponents(${matchId})" ${isLockedRound ? 'disabled' : ''}>Update Opponents</button>
                <select id="matchWinner-${matchId}" class="search-box" style="padding:8px 10px;" ${isLockedRound ? 'disabled' : ''}>
                    <option value="none" ${winnerSide === 'none' ? 'selected' : ''}>No Winner</option>
                    <option value="teamA" ${winnerSide === 'teamA' ? 'selected' : ''}>Winner: ${escapeHtml(match.teamA || 'Team A')}</option>
                    <option value="teamB" ${winnerSide === 'teamB' ? 'selected' : ''}>Winner: ${escapeHtml(match.teamB || 'Team B')}</option>
                </select>
            </div>
            <div class="admin-match-actions">
                <button class="btn btn-primary tourney-mini-btn" onclick="saveMatchWinner(${matchId})" ${isLockedRound ? 'disabled' : ''}>Update Winner</button>
                <button class="btn btn-secondary tourney-mini-btn" onclick="revertMatchWinner(${matchId})" ${isLockedRound ? 'disabled' : ''}>Revert Winner</button>
            </div>
            ${isLockedRound ? '<div class="admin-lock-note">Round ended: controls are disabled.</div>' : ''}

            <div class="match-video-panel ${isExpanded ? 'expanded' : ''}" style="max-height:${isExpanded ? '700px' : '0'}; opacity:${isExpanded ? '1' : '0'};">
                ${isExpanded ? renderMatchVideoPanel(match) : ''}
            </div>
        </article>
    `;
}

function renderMatchVideoPanel(match) {
    const rawUrl = (match.facebook_live_url || '').trim();
    if (!rawUrl) {
        return `
            <div style="padding:10px; border:1px dashed #cbd5e1; border-radius:8px; background:#f8fafc;">
                <p style="margin:0 0 8px 0; color:#475569;">Discord stream link not available for this battle yet.</p>
                <button class="btn btn-secondary" onclick="minimizeMatchVideo()">Minimize Video</button>
            </div>
        `;
    }

    const embedUrl = toDiscordEmbedUrl(rawUrl);
    const embedBlock = embedUrl
        ? `
            <div class="admin-video-frame">
                <iframe
                    src="${escapeAttr(embedUrl)}"
                    style="position:absolute; inset:0; width:100%; height:100%; border:0;"
                    allow="autoplay; clipboard-write; encrypted-media; picture-in-picture; web-share"
                    allowfullscreen
                    loading="lazy"
                    title="Match ${Number(match.id)} Discord stream"
                ></iframe>
            </div>
        `
        : '<p style="margin:0 0 8px 0; color:#475569;">This Discord link cannot be embedded. Open it directly in Discord.</p>';

    return `
        <div class="admin-video-wrap">
            ${embedBlock}
            <div class="admin-video-actions">
                <a class="btn btn-secondary" href="${escapeAttr(rawUrl)}" target="_blank" rel="noopener">Open in Discord</a>
                <button class="btn btn-secondary" onclick="minimizeMatchVideo()">Minimize Video</button>
            </div>
        </div>
    `;
}

function toDiscordEmbedUrl(url) {
    const trimmed = String(url || '').trim();
    if (!trimmed) return null;
    if (trimmed.includes('discord.com/widget')) return trimmed;

    const guildMatch = trimmed.match(/discord(?:app)?\.com\/channels\/(\d+)/i);
    if (guildMatch && guildMatch[1]) {
        return `https://discord.com/widget?id=${guildMatch[1]}&theme=dark`;
    }

    const inviteMatch = trimmed.match(/discord(?:app)?\.(?:gg|com\/invite)\/([a-zA-Z0-9-]+)/i);
    if (inviteMatch) return null;

    return null;
}

function toggleMatchVideo(matchId) {
    const parsedId = Number(matchId);
    if (!Number.isFinite(parsedId) || parsedId <= 0) return;

    if (tournamentState.expandedMatchId === parsedId) {
        tournamentState.expandedMatchId = null;
    } else {
        tournamentState.expandedMatchId = parsedId;
    }

    renderMatches(tournamentState.matches);
}

function minimizeMatchVideo() {
    tournamentState.expandedMatchId = null;
    renderMatches(tournamentState.matches);
}

async function saveMatchLiveUrl(matchId) {
    const input = document.getElementById(`matchLiveUrl-${matchId}`);
    const value = input ? input.value.trim() : '';

    const result = await adminApi.updateMatchLiveUrl(matchId, value);
    if (!result.success) {
        showTournamentMessage(result.message || 'Failed to save live link.', 'error');
        return;
    }

    showTournamentMessage('Live link updated.', 'success');
    await loadMatchesForEvent(tournamentState.selectedEventId);
}

async function removeMatchLiveUrl(matchId) {
    const result = await adminApi.updateMatchLiveUrl(matchId, '');
    if (!result.success) {
        showTournamentMessage(result.message || 'Failed to remove live link.', 'error');
        return;
    }

    if (tournamentState.expandedMatchId === Number(matchId)) {
        tournamentState.expandedMatchId = null;
    }

    showTournamentMessage('Live link removed.', 'success');
    await loadMatchesForEvent(tournamentState.selectedEventId);
}

async function updateMatchStatus(matchId) {
    const select = document.getElementById(`matchStatus-${matchId}`);
    const status = select ? select.value : '';

    const result = await adminApi.updateMatchStatus(matchId, status);
    if (!result.success) {
        showTournamentMessage(result.message || 'Failed to update match status.', 'error');
        return;
    }

    showTournamentMessage('Match status updated.', 'success');
    await loadMatchesForEvent(tournamentState.selectedEventId);
}

async function saveMatchWinner(matchId) {
    const winnerSelect = document.getElementById(`matchWinner-${matchId}`);
    const winnerSide = winnerSelect ? winnerSelect.value : 'none';
    const result = await adminApi.updateMatchWinner(matchId, winnerSide);
    if (!result.success) {
        showTournamentMessage(result.message || 'Failed to update winner.', 'error');
        return;
    }
    showTournamentMessage('Winner updated.', 'success');
    await loadMatchesForEvent(tournamentState.selectedEventId);
}

async function saveMatchSeries(matchId) {
    const winTargetEl = document.getElementById(`matchWinTarget-${matchId}`);
    const teamAWinsEl = document.getElementById(`matchTeamAWins-${matchId}`);
    const teamBWinsEl = document.getElementById(`matchTeamBWins-${matchId}`);

    const payload = {
        win_target: Number(winTargetEl?.value || 1),
        teamA_wins: Number(teamAWinsEl?.value || 0),
        teamB_wins: Number(teamBWinsEl?.value || 0)
    };

    const result = await adminApi.updateMatchSeries(matchId, payload);
    if (!result.success) {
        showTournamentMessage(result.message || 'Failed to update series.', 'error');
        return;
    }

    showTournamentMessage(result.message || 'Series updated.', 'success');
    await loadMatchesForEvent(tournamentState.selectedEventId);
}

async function revertMatchWinner(matchId) {
    const result = await adminApi.updateMatchWinner(matchId, 'none');
    if (!result.success) {
        showTournamentMessage(result.message || 'Failed to revert winner.', 'error');
        return;
    }
    const winnerSelect = document.getElementById(`matchWinner-${matchId}`);
    if (winnerSelect) winnerSelect.value = 'none';
    showTournamentMessage('Winner reverted successfully.', 'success');
    await loadMatchesForEvent(tournamentState.selectedEventId);
}

async function saveMatchOpponents(matchId) {
    const teamAInput = document.getElementById(`matchTeamA-${matchId}`);
    const teamBInput = document.getElementById(`matchTeamB-${matchId}`);
    const teamA = teamAInput ? teamAInput.value.trim() : '';
    const teamB = teamBInput ? teamBInput.value.trim() : '';

    if (!teamA || !teamB) {
        showTournamentMessage('Both Team A and Team B are required.', 'error');
        return;
    }

    const current = tournamentState.matches.find((m) => Number(m.id) === Number(matchId));
    const payload = {
        teamA,
        teamB,
        teamA_participant_id: current?.teamA === teamA ? current?.teamA_participant_id : null,
        teamB_participant_id: current?.teamB === teamB ? current?.teamB_participant_id : null
    };

    const result = await adminApi.updateMatchOpponents(matchId, payload);
    if (!result.success) {
        showTournamentMessage(result.message || 'Failed to update opponents.', 'error');
        return;
    }
    showTournamentMessage('Opponents updated. Winner was reset to avoid mismatch.', 'success');
    await loadMatchesForEvent(tournamentState.selectedEventId);
}

async function advanceToNextRound() {
    if (!tournamentState.selectedEventId) {
        showTournamentMessage('Please select a tournament event first.', 'error');
        return;
    }

    const result = await adminApi.advanceMatchesRound(tournamentState.selectedEventId);
    if (!result.success) {
        showTournamentMessage(result.message || 'Unable to advance to next round.', 'error');
        return;
    }

    if (result.data?.completed) {
        showTournamentMessage('Tournament complete. Champion decided.', 'success');
    } else {
        showTournamentMessage(result.message || 'Advanced to next round.', 'success');
    }
    await loadMatchesForEvent(tournamentState.selectedEventId);
}

function showTournamentMessage(message, type = 'info') {
    const messageDiv = document.getElementById('tournamentMessage');
    if (!messageDiv) return;

    messageDiv.textContent = message;
    messageDiv.style.display = 'block';
    messageDiv.className = `tourney-message ${type}`;

    setTimeout(() => {
        messageDiv.style.display = 'none';
    }, 4500);
}

function escapeHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function escapeAttr(value) {
    return escapeHtml(value).replace(/`/g, '&#96;');
}

function getTeamColor(teamName) {
    const name = String(teamName || '').trim().toLowerCase();
    if (!name) return '#64748b';
    let hash = 0;
    for (let i = 0; i < name.length; i += 1) {
        hash = ((hash << 5) - hash) + name.charCodeAt(i);
        hash |= 0;
    }
    const idx = Math.abs(hash) % TEAM_COLOR_PALETTE.length;
    return TEAM_COLOR_PALETTE[idx];
}

function getMatchBorderColor(matchId) {
    const value = Number(matchId || 0);
    const idx = Math.abs(value) % TEAM_COLOR_PALETTE.length;
    return TEAM_COLOR_PALETTE[idx];
}

function hasReadyOpponent(match) {
    const teamA = String(match?.teamA || '').trim();
    const teamB = String(match?.teamB || '').trim();
    if (!teamA || !teamB) return false;
    if (teamA.toUpperCase() === 'TBD' || teamB.toUpperCase() === 'TBD') return false;
    return true;
}

function focusMatchCard(matchId) {
    const card = document.querySelector(`.admin-match-card[data-match-id="${Number(matchId)}"]`);
    if (!card) return;

    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    card.classList.add('preview-focused');
    window.setTimeout(() => {
        card.classList.remove('preview-focused');
    }, 1800);
}

function closeAllModals() {
    document.querySelectorAll('.modal').forEach((modal) => {
        modal.style.display = 'none';
    });
}

window.removeTeamFromTournament = removeTeamFromTournament;
window.toggleMatchVideo = toggleMatchVideo;
window.minimizeMatchVideo = minimizeMatchVideo;
window.saveMatchLiveUrl = saveMatchLiveUrl;
window.removeMatchLiveUrl = removeMatchLiveUrl;
window.updateMatchStatus = updateMatchStatus;
window.saveMatchWinner = saveMatchWinner;
window.saveMatchSeries = saveMatchSeries;
window.revertMatchWinner = revertMatchWinner;
window.saveMatchOpponents = saveMatchOpponents;
window.advanceToNextRound = advanceToNextRound;
window.focusMatchCard = focusMatchCard;

document.addEventListener('DOMContentLoaded', () => {
    initTournament();
    updateBracketButtonLabel();
});
