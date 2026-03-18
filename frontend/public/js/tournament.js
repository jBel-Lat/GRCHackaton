const state = {
    matches: [],
    selectedEventId: '',
    expandedMatchId: null,
    refreshTimer: null
};

const API_BASE = '/api';
const TEAM_COLOR_PALETTE = [
    '#60a5fa', '#34d399', '#f59e0b', '#f472b6', '#a78bfa',
    '#22d3ee', '#f87171', '#84cc16', '#fb7185', '#38bdf8'
];

function initTournamentPage() {
    document.getElementById('eventFilterSelect')?.addEventListener('change', (e) => {
        state.selectedEventId = e.target.value || '';
        state.expandedMatchId = null;
        renderMatches();
    });
    document.getElementById('refreshTournamentBtn')?.addEventListener('click', fetchMatches);
    fetchMatches();
    state.refreshTimer = setInterval(fetchMatches, 10000);
}

async function fetchMatches() {
    try {
        const response = await fetch(`${API_BASE}/matches`, { cache: 'no-store' });
        const data = await response.json();
        if (!response.ok || !data.success) throw new Error(data.message || 'Unable to load matches.');
        state.matches = Array.isArray(data.data) ? data.data : [];
        syncEventFilter();
        updateRoundCounter();
        renderMatches();
    } catch (error) {
        setStatus(error.message || 'Failed to fetch matches.', 'error');
    }
}

function syncEventFilter() {
    const select = document.getElementById('eventFilterSelect');
    if (!select) return;

    const eventMap = new Map();
    state.matches.forEach((m) => {
        const id = String(m.event_id || '');
        if (id && !eventMap.has(id)) eventMap.set(id, m.event_name || `Event ${id}`);
    });

    const prev = state.selectedEventId;
    select.innerHTML = '<option value="">All events</option>';
    [...eventMap.entries()].forEach(([id, name]) => {
        const option = document.createElement('option');
        option.value = id;
        option.textContent = name;
        if (prev && prev === id) option.selected = true;
        select.appendChild(option);
    });

    if (prev && !eventMap.has(prev)) state.selectedEventId = '';
}

function getFilteredMatches() {
    return state.selectedEventId
        ? state.matches.filter((m) => String(m.event_id) === String(state.selectedEventId))
        : state.matches;
}

function renderMatches() {
    const container = document.getElementById('tournamentMatchesContainer');
    if (!container) return;

    const filtered = getFilteredMatches();
    renderBracketBoard(filtered);

    if (!filtered.length) {
        container.innerHTML = '<div class="round-section"><p>No matches available for the selected event.</p></div>';
        return;
    }

    const byEvent = filtered.reduce((acc, match) => {
        const key = `${match.event_id}::${match.event_name || `Event ${match.event_id}`}`;
        if (!acc[key]) acc[key] = [];
        acc[key].push(match);
        return acc;
    }, {});

    container.innerHTML = Object.entries(byEvent).map(([key, eventMatches]) => {
        const [, eventName] = key.split('::');
        const hasDouble = eventMatches.some((m) => isDoubleBracketType(m.bracket_type));

        if (!hasDouble) {
            const latestRound = Math.max(...eventMatches.map((m) => Number(m.round_number || 1)));
            const latestMatches = eventMatches
                .filter((m) => Number(m.round_number || 1) === latestRound)
                .sort(byRoundOrder);
            return `
                <section class="round-section">
                    <h2 class="round-title">${escapeHtml(eventName)} - ${escapeHtml(latestMatches[0]?.round_name || `Round ${latestRound}`)}</h2>
                    <div class="match-list">${latestMatches.map(renderMatchCard).join('')}</div>
                </section>
            `;
        }

        const upper = eventMatches.filter((m) => String(m.bracket_type || '').toLowerCase() === 'upper').sort(byRoundOrder);
        const lower = eventMatches
            .filter((m) => String(m.bracket_type || '').toLowerCase() === 'lower')
            .sort(byRoundOrder);
        const finals = eventMatches
            .filter((m) => ['grand_final', 'grand_final_reset'].includes(String(m.bracket_type || '').toLowerCase()))
            .sort(byRoundOrder);

        return `
            <section class="round-section"><h2 class="round-title">${escapeHtml(eventName)} - Double Elimination</h2></section>
            ${renderTypeSection('UPPER BRACKET', upper)}
            ${renderTypeSection('LOWER BRACKET', lower)}
            ${renderTypeSection('FINALS', finals)}
        `;
    }).join('');
}

function renderTypeSection(title, matches) {
    const visibleMatches = matches.filter((m) => !isHiddenMatch(m));
    if (!visibleMatches.length) return '';
    return `
        <section class="round-section">
            <h2 class="round-title">${escapeHtml(title)}</h2>
            <div class="match-list">${visibleMatches.map(renderMatchCard).join('')}</div>
        </section>
    `;
}

function renderBracketBoard(matches) {
    const board = document.getElementById('tournamentBracketBoard');
    if (!board) return;
    if (!matches.length) {
        board.innerHTML = '';
        return;
    }

    const firstEventId = String(matches[0].event_id);
    const eventMatches = matches.filter((m) => String(m.event_id) === firstEventId);
    const hasDouble = eventMatches.some((m) => isDoubleBracketType(m.bracket_type));

    if (!hasDouble) {
        const rounds = eventMatches.reduce((acc, m) => {
            const r = Number(m.round_number || 1);
            if (!acc[r]) acc[r] = [];
            acc[r].push(m);
            return acc;
        }, {});
        const cols = Object.keys(rounds).map(Number).sort((a, b) => a - b).map((roundNo) => {
            const cards = rounds[roundNo].slice().sort(byRoundOrder).map(renderBracketMatch).join('');
            return `<section class="bracket-col"><h3>${escapeHtml(rounds[roundNo][0]?.round_name || `Round ${roundNo}`)}</h3>${cards}</section>`;
        }).join('');
        board.innerHTML = `<div class="bracket-wrap">${cols}</div>`;
        return;
    }

    const groups = [
        ['UPPER BRACKET FLOW', eventMatches.filter((m) => String(m.bracket_type || '').toLowerCase() === 'upper'), 'public-flow-upper'],
        ['LOWER BRACKET FLOW', eventMatches.filter((m) => String(m.bracket_type || '').toLowerCase() === 'lower'), 'public-flow-lower'],
        ['FINALS FLOW', eventMatches.filter((m) => ['grand_final', 'grand_final_reset'].includes(String(m.bracket_type || '').toLowerCase())), 'public-flow-finals']
    ].filter(([, arr]) => arr.length);

    const sections = groups.map(([title, groupMatches, cls]) => renderFlowSection(title, groupMatches, cls)).join('');
    board.innerHTML = `<div class="public-flow-wrap">${sections}</div>`;
}

function renderFlowSection(title, matches, sectionClass = '') {
    const grouped = matches.filter((m) => !isHiddenMatch(m)).reduce((acc, m) => {
        const round = Number(m.round_number || 1);
        if (!acc[round]) acc[round] = [];
        acc[round].push(m);
        return acc;
    }, {});
    const rounds = Object.keys(grouped).map(Number).sort((a, b) => a - b);

    const roundsHtml = rounds.map((round, idx) => {
        const cards = grouped[round]
            .slice()
            .sort(byRoundOrder)
            .map((match) => {
                const status = String(match.status || 'pending').toLowerCase();
                const winner = match.winner_team_name ? `<div class="flow-winner-text">Winner: ${escapeHtml(match.winner_team_name)}</div>` : '';
                return `
                    <div class="flow-match ${status}">
                        <div class="flow-team">${escapeHtml(getVisibleTeamName(match.teamA))}</div>
                        <div class="flow-vs">vs</div>
                        <div class="flow-team">${escapeHtml(getVisibleTeamName(match.teamB))}</div>
                        <div class="flow-meta"><span>${escapeHtml(status)}</span></div>
                        ${winner}
                    </div>
                `;
            }).join('');
        return `
            <div class="flow-round ${idx < rounds.length - 1 ? 'has-next' : ''}">
                <h5>Round ${round}</h5>
                <div class="flow-round-matches">${cards}</div>
            </div>
        `;
    }).join('');

    return `
        <section class="public-flow-section ${sectionClass}">
            <h4>${escapeHtml(title)}</h4>
            <div class="flow-grid">${roundsHtml}</div>
        </section>
    `;
}

function renderBracketMatch(match) {
    const status = String(match.status || 'pending').toLowerCase();
    const teamAColor = getTeamColor(match.teamA || '');
    const teamBColor = getTeamColor(match.teamB || '');
    const matchBorder = getMatchBorderColor(match.id);
    const winner = match.winner_team_name ? `<div class="bracket-winner">Winner: ${escapeHtml(match.winner_team_name)}</div>` : '';
    const series = renderSeriesIndicator(match, 'bracket-series-indicator');

    return `
        <article class="bracket-match ${status === 'ongoing' ? 'ongoing' : ''}" style="border:1px solid ${matchBorder}; border-left:4px solid ${teamAColor}; border-right:4px solid ${teamBColor}; box-shadow:0 0 0 1px ${matchBorder}33;">
            <div class="bracket-team"><span class="team-indicator" style="background:${teamAColor};"></span>${escapeHtml(getVisibleTeamName(match.teamA))}</div>
            <div class="bracket-vs">VS</div>
            <div class="bracket-team"><span class="team-indicator" style="background:${teamBColor};"></span>${escapeHtml(getVisibleTeamName(match.teamB))}</div>
            <div class="bracket-meta"><span>${escapeHtml(match.round_name || '')}</span><span class="bracket-status-pill ${escapeHtml(status)}">${escapeHtml(status)}</span></div>
            ${series}
            ${winner}
        </article>
    `;
}

function updateRoundCounter() {
    const counter = document.getElementById('bracketRoundCounter');
    if (!counter) return;
    const filtered = getFilteredMatches();
    if (!filtered.length) {
        counter.textContent = 'Round: --';
        return;
    }

    const hasDouble = filtered.some((m) => isDoubleBracketType(m.bracket_type));
    if (hasDouble) {
        const active = filtered.filter((m) => String(m.status || '').toLowerCase() !== 'finished').length;
        counter.textContent = `Double Elimination - ${active} active match${active === 1 ? '' : 'es'}`;
        return;
    }

    const maxRound = Math.max(...filtered.map((m) => Number(m.round_number || 1)));
    const latest = filtered.filter((m) => Number(m.round_number || 1) === maxRound);
    const remaining = latest.filter((m) => String(m.status || '').toLowerCase() !== 'finished').length;
    counter.textContent = `Round ${maxRound} - ${remaining} active set${remaining === 1 ? '' : 's'}`;
}

function renderMatchCard(match) {
    const id = Number(match.id);
    const status = String(match.status || 'pending').toLowerCase();
    const isOpen = state.expandedMatchId === id;
    const hasVideo = Boolean(String(match.facebook_live_url || '').trim());
    const teamAColor = getTeamColor(match.teamA || '');
    const teamBColor = getTeamColor(match.teamB || '');
    const matchBorder = getMatchBorderColor(match.id);
    const winner = match.winner_team_name ? `<div class="match-winner-label">Winner: ${escapeHtml(match.winner_team_name)}</div>` : '';
    const sourceAValue = String(match.source_label_teamA || '').trim();
    const sourceBValue = String(match.source_label_teamB || '').trim();
    const sourceA = (sourceAValue && !/seed/i.test(sourceAValue)) ? `<span class="match-source-pill">A: ${escapeHtml(sourceAValue)}</span>` : '';
    const sourceB = (sourceBValue && !/seed/i.test(sourceBValue)) ? `<span class="match-source-pill">B: ${escapeHtml(sourceBValue)}</span>` : '';
    const series = renderSeriesIndicator(match, 'match-series-indicator');

    return `
        <article class="match-card ${status === 'ongoing' ? 'ongoing' : ''}" style="border:1px solid ${matchBorder}; border-left:4px solid ${teamAColor}; border-right:4px solid ${teamBColor}; box-shadow:0 0 0 1px ${matchBorder}33;">
            <div class="match-header">
                <div>
                    <div class="match-id">Match #${Number(match.match_order || 0)}</div>
                    <div class="match-teams"><span class="team-indicator" style="background:${teamAColor};"></span>${escapeHtml(getVisibleTeamName(match.teamA))} <span>vs</span> <span class="team-indicator" style="background:${teamBColor};"></span>${escapeHtml(getVisibleTeamName(match.teamB))}</div>
                </div>
                <div class="badge-row"><span class="badge ${escapeHtml(status)}">${escapeHtml(status)}</span></div>
            </div>
            ${winner}
            ${series}
            <div class="match-source-row">${sourceA}${sourceB}</div>
            <div class="match-actions">
                <button class="btn btn-primary" onclick="${hasVideo ? `toggleVideo(${id})` : 'return false;'}" ${hasVideo ? '' : 'disabled'}>${hasVideo ? 'Watch Video' : 'No Video'}</button>
            </div>
            <div class="video-panel ${isOpen ? 'open' : ''}">${isOpen ? renderVideoPanel(match) : ''}</div>
        </article>
    `;
}

function renderSeriesIndicator(match, cls) {
    const target = Math.max(1, Number(match.win_target || 1));
    const aWins = Math.max(0, Number(match.teamA_wins || 0));
    const bWins = Math.max(0, Number(match.teamB_wins || 0));
    if (target <= 1 && aWins === 0 && bWins === 0) return '';
    return `<div class="${cls}">Current set score: ${aWins} - ${bWins} (First to ${target})</div>`;
}

function renderVideoPanel(match) {
    const liveUrl = String(match.facebook_live_url || '').trim();
    if (!liveUrl) {
        return `<div class="video-inner"><p style="margin:0 0 8px 0; color:#475569;">Discord stream link not available for this battle yet.</p><button class="btn btn-secondary" onclick="minimizeVideo()">Minimize Video</button></div>`;
    }
    const embedUrl = toDiscordEmbedUrl(liveUrl);
    const embed = embedUrl
        ? `<div class="video-embed"><iframe src="${escapeAttr(embedUrl)}" allow="autoplay; clipboard-write; encrypted-media; picture-in-picture; web-share" allowfullscreen loading="lazy"></iframe></div>`
        : '<p style="margin:0 0 8px 0; color:#475569;">This Discord link cannot be embedded. Open it directly in Discord.</p>';
    return `<div class="video-inner">${embed}<div class="video-actions"><a class="btn btn-secondary" href="${escapeAttr(liveUrl)}" target="_blank" rel="noopener">Open in Discord</a><button class="btn btn-secondary" onclick="minimizeVideo()">Minimize Video</button></div></div>`;
}

function toggleVideo(matchId) {
    const id = Number(matchId);
    if (!Number.isFinite(id) || id <= 0) return;
    state.expandedMatchId = state.expandedMatchId === id ? null : id;
    renderMatches();
}

function minimizeVideo() {
    state.expandedMatchId = null;
    renderMatches();
}

function toDiscordEmbedUrl(url) {
    const cleaned = String(url || '').trim();
    if (!cleaned) return null;
    if (cleaned.includes('discord.com/widget')) return cleaned;
    const guild = cleaned.match(/discord(?:app)?\.com\/channels\/(\d+)/i);
    return guild?.[1] ? `https://discord.com/widget?id=${guild[1]}&theme=dark` : null;
}

function isDoubleBracketType(type) {
    return ['upper', 'lower', 'grand_final', 'grand_final_reset'].includes(String(type || '').toLowerCase());
}

function isMatchActivated(match) {
    const teamA = String(match.teamA || '').trim();
    const teamB = String(match.teamB || '').trim();
    const status = String(match.status || '').toLowerCase();
    return (
        (teamA && teamA !== 'TBD') ||
        (teamB && teamB !== 'TBD') ||
        Boolean(match.winner_team_name) ||
        status === 'ongoing' ||
        status === 'finished'
    );
}

function isHiddenMatch(match) {
    const teamA = String(match.teamA || '').trim().toUpperCase();
    const teamB = String(match.teamB || '').trim().toUpperCase();
    const status = String(match.status || '').toLowerCase();
    const hasWinner = Boolean(match.winner_team_name);
    return teamA === 'TBD' && teamB === 'TBD' && status === 'pending' && !hasWinner;
}

function getVisibleTeamName(name) {
    const value = String(name || '').trim();
    return value.toUpperCase() === 'TBD' ? '' : value;
}

function byRoundOrder(a, b) {
    return Number(a.round_number || 0) - Number(b.round_number || 0) || Number(a.match_order || 0) - Number(b.match_order || 0);
}

function setStatus(message, type = 'info') {
    const el = document.getElementById('tournamentStatusMessage');
    if (!el) return;
    if (!message) {
        el.style.display = 'none';
        return;
    }
    el.textContent = message;
    el.style.display = 'block';
    if (type === 'error') {
        el.style.background = 'rgba(127, 29, 29, 0.28)';
        el.style.color = '#fecaca';
        el.style.borderLeftColor = '#ef4444';
    } else {
        el.style.background = 'rgba(6, 95, 70, 0.28)';
        el.style.color = '#bbf7d0';
        el.style.borderLeftColor = '#10b981';
    }
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
    }
    return TEAM_COLOR_PALETTE[Math.abs(hash) % TEAM_COLOR_PALETTE.length];
}

function getMatchBorderColor(matchId) {
    const id = Number(matchId || 0);
    return TEAM_COLOR_PALETTE[Math.abs(id) % TEAM_COLOR_PALETTE.length];
}

window.toggleVideo = toggleVideo;
window.minimizeVideo = minimizeVideo;
document.addEventListener('DOMContentLoaded', initTournamentPage);
