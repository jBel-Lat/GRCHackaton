const state = {
    matches: [],
    selectedEventId: '',
    expandedMatchId: null,
    refreshTimer: null,
    maxRoundSeen: 0
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
    const eventsMap = new Map();
    state.matches.forEach((m) => {
        const id = String(m.event_id || '');
        if (id && !eventsMap.has(id)) eventsMap.set(id, m.event_name || `Event ${id}`);
    });
    const prev = state.selectedEventId;
    select.innerHTML = '<option value="">All events</option>';
    [...eventsMap.entries()].forEach(([id, name]) => {
        const opt = document.createElement('option');
        opt.value = id;
        opt.textContent = name;
        if (prev && prev === id) opt.selected = true;
        select.appendChild(opt);
    });
    if (prev && !eventsMap.has(prev)) state.selectedEventId = '';
}

function renderMatches() {
    const container = document.getElementById('tournamentMatchesContainer');
    if (!container) return;
    const filtered = state.selectedEventId
        ? state.matches.filter((m) => String(m.event_id) === String(state.selectedEventId))
        : state.matches;

    renderBracketBoard(filtered);
    if (!filtered.length) {
        container.innerHTML = '<div class="round-section"><p>No matches available for the selected event.</p></div>';
        return;
    }

    const groupedByEvent = filtered.reduce((acc, m) => {
        const key = `${m.event_id}::${m.event_name || `Event ${m.event_id}`}`;
        if (!acc[key]) acc[key] = [];
        acc[key].push(m);
        return acc;
    }, {});

    container.innerHTML = Object.entries(groupedByEvent).map(([key, matches]) => {
        const [, eventName] = key.split('::');
        const hasDouble = matches.some((m) => ['upper', 'lower', 'grand_final', 'grand_final_reset'].includes(String(m.bracket_type || '').toLowerCase()));
        if (!hasDouble) {
            const latest = Math.max(...matches.map((m) => Number(m.round_number || 1)));
            const latestMatches = matches.filter((m) => Number(m.round_number || 1) === latest).sort((a, b) => Number(a.match_order || 0) - Number(b.match_order || 0));
            return `<section class="round-section"><h2 class="round-title">${escapeHtml(eventName)} - ${escapeHtml(latestMatches[0]?.round_name || `Round ${latest}`)}</h2><div class="match-list">${latestMatches.map(renderMatchCard).join('')}</div></section>`;
        }

        const upper = matches.filter((m) => String(m.bracket_type || '').toLowerCase() === 'upper').sort(byOrder);
        const lower = matches.filter((m) => String(m.bracket_type || '').toLowerCase() === 'lower').sort(byOrder);
        const finals = matches.filter((m) => ['grand_final', 'grand_final_reset'].includes(String(m.bracket_type || '').toLowerCase())).sort(byOrder);
        return `
            <section class="round-section"><h2 class="round-title">${escapeHtml(eventName)} - Double Elimination</h2></section>
            ${renderTypeSection('UPPER BRACKET', upper)}
            ${renderTypeSection('LOWER BRACKET', lower)}
            ${renderTypeSection('FINALS', finals)}
        `;
    }).join('');
}

function renderTypeSection(title, matches) {
    if (!matches.length) return '';
    return `<section class="round-section"><h2 class="round-title">${escapeHtml(title)}</h2><div class="match-list">${matches.map(renderMatchCard).join('')}</div></section>`;
}

function renderBracketBoard(matches) {
    const board = document.getElementById('tournamentBracketBoard');
    if (!board) return;
    if (!matches.length) {
        board.innerHTML = '';
        return;
    }

    const firstEvent = String(matches[0].event_id);
    const eventMatches = matches.filter((m) => String(m.event_id) === firstEvent);
    const hasDouble = eventMatches.some((m) => ['upper', 'lower', 'grand_final', 'grand_final_reset'].includes(String(m.bracket_type || '').toLowerCase()));

    if (!hasDouble) {
        const rounds = eventMatches.reduce((acc, m) => {
            const round = Number(m.round_number || 1);
            if (!acc[round]) acc[round] = [];
            acc[round].push(m);
            return acc;
        }, {});
        const cols = Object.keys(rounds).map(Number).sort((a, b) => a - b).map((r) => {
            const cards = rounds[r].sort(byOrder).map(renderBracketMatch).join('');
            return `<section class="bracket-col"><h3>${escapeHtml(rounds[r][0]?.round_name || `Round ${r}`)}</h3>${cards}</section>`;
        }).join('');
        board.innerHTML = `<div class="bracket-wrap">${cols}</div>`;
        return;
    }

    const groups = [
        ['UPPER BRACKET', eventMatches.filter((m) => String(m.bracket_type || '').toLowerCase() === 'upper')],
        ['LOWER BRACKET', eventMatches.filter((m) => String(m.bracket_type || '').toLowerCase() === 'lower')],
        ['FINALS', eventMatches.filter((m) => ['grand_final', 'grand_final_reset'].includes(String(m.bracket_type || '').toLowerCase()))]
    ].filter(([, arr]) => arr.length);

    const cols = groups.map(([title, arr]) => `<section class="bracket-col"><h3>${escapeHtml(title)}</h3>${arr.sort(byOrder).map(renderBracketMatch).join('')}</section>`).join('');
    board.innerHTML = `<div class="bracket-wrap">${cols}</div>`;
}

function renderBracketMatch(match) {
    const status = String(match.status || 'pending').toLowerCase();
    const teamAColor = getTeamColor(match.teamA || '');
    const teamBColor = getTeamColor(match.teamB || '');
    const matchBorder = getMatchBorderColor(match.id);
    const winner = match.winner_team_name ? `<div class="bracket-winner">Winner: ${escapeHtml(match.winner_team_name)}</div>` : '';
    return `
        <article class="bracket-match ${status === 'ongoing' ? 'ongoing' : ''}" style="border:1px solid ${matchBorder}; border-left:4px solid ${teamAColor}; border-right:4px solid ${teamBColor}; box-shadow:0 0 0 1px ${matchBorder}33;">
            <div class="bracket-team"><span class="team-indicator" style="background:${teamAColor};"></span>${escapeHtml(match.teamA || 'TBD')}</div>
            <div class="bracket-vs">VS</div>
            <div class="bracket-team"><span class="team-indicator" style="background:${teamBColor};"></span>${escapeHtml(match.teamB || 'TBD')}</div>
            <div class="bracket-meta"><span>${escapeHtml(match.round_name || '')}</span><span class="bracket-status-pill ${escapeHtml(status)}">${escapeHtml(status)}</span></div>
            ${winner}
        </article>
    `;
}

function updateRoundCounter() {
    const counter = document.getElementById('bracketRoundCounter');
    if (!counter) return;
    const filtered = state.selectedEventId ? state.matches.filter((m) => String(m.event_id) === String(state.selectedEventId)) : state.matches;
    if (!filtered.length) return void (counter.textContent = 'Round: --');
    const hasDouble = filtered.some((m) => ['upper', 'lower', 'grand_final', 'grand_final_reset'].includes(String(m.bracket_type || '').toLowerCase()));
    if (hasDouble) {
        const active = filtered.filter((m) => String(m.status || '').toLowerCase() !== 'finished').length;
        counter.textContent = `Double Elimination • ${active} active match${active === 1 ? '' : 'es'}`;
    } else {
        const maxRound = Math.max(...filtered.map((m) => Number(m.round_number || 1)));
        const latest = filtered.filter((m) => Number(m.round_number || 1) === maxRound);
        const remaining = latest.filter((m) => String(m.status || '').toLowerCase() !== 'finished').length;
        counter.textContent = `Round ${maxRound} • ${remaining} active set${remaining === 1 ? '' : 's'}`;
    }
}

function renderMatchCard(match) {
    const id = Number(match.id);
    const status = String(match.status || 'pending').toLowerCase();
    const isOpen = state.expandedMatchId === id;
    const teamAColor = getTeamColor(match.teamA || '');
    const teamBColor = getTeamColor(match.teamB || '');
    const matchBorder = getMatchBorderColor(match.id);
    const winner = match.winner_team_name ? `<div class="match-winner-label">Winner: ${escapeHtml(match.winner_team_name)}</div>` : '';
    const sourceA = match.source_label_teamA ? `<span class="match-source-pill">A: ${escapeHtml(match.source_label_teamA)}</span>` : '';
    const sourceB = match.source_label_teamB ? `<span class="match-source-pill">B: ${escapeHtml(match.source_label_teamB)}</span>` : '';

    return `
        <article class="match-card ${status === 'ongoing' ? 'ongoing' : ''}" style="border:1px solid ${matchBorder}; border-left:4px solid ${teamAColor}; border-right:4px solid ${teamBColor}; box-shadow:0 0 0 1px ${matchBorder}33;">
            <div class="match-header">
                <div>
                    <div class="match-id">Match #${Number(match.match_order || 0)}</div>
                    <div class="match-teams"><span class="team-indicator" style="background:${teamAColor};"></span>${escapeHtml(match.teamA)} <span>vs</span> <span class="team-indicator" style="background:${teamBColor};"></span>${escapeHtml(match.teamB)}</div>
                </div>
                <div class="badge-row"><span class="badge ${escapeHtml(status)}">${escapeHtml(status)}</span></div>
            </div>
            ${winner}
            <div class="match-source-row">${sourceA}${sourceB}</div>
            <div class="match-actions"><button class="btn btn-primary" onclick="toggleVideo(${id})">Watch Video</button></div>
            <div class="video-panel ${isOpen ? 'open' : ''}">${isOpen ? renderVideoPanel(match) : ''}</div>
        </article>
    `;
}

function renderVideoPanel(match) {
    const liveUrl = String(match.facebook_live_url || '').trim();
    if (!liveUrl) return `<div class="video-inner"><p style="margin:0 0 8px 0; color:#475569;">Discord stream link not available for this battle yet.</p><button class="btn btn-secondary" onclick="minimizeVideo()">Minimize Video</button></div>`;
    const embedUrl = toDiscordEmbedUrl(liveUrl);
    const embed = embedUrl ? `<div class="video-embed"><iframe src="${escapeAttr(embedUrl)}" allow="autoplay; clipboard-write; encrypted-media; picture-in-picture; web-share" allowfullscreen loading="lazy"></iframe></div>` : '<p style="margin:0 0 8px 0; color:#475569;">This Discord link cannot be embedded. Open it directly in Discord.</p>';
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

function setStatus(message, type = 'info') {
    const el = document.getElementById('tournamentStatusMessage');
    if (!el) return;
    if (!message) return void (el.style.display = 'none');
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
    return String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function escapeAttr(value) {
    return escapeHtml(value).replace(/`/g, '&#96;');
}

function getTeamColor(teamName) {
    const name = String(teamName || '').trim().toLowerCase();
    if (!name) return '#64748b';
    let hash = 0;
    for (let i = 0; i < name.length; i += 1) hash = ((hash << 5) - hash) + name.charCodeAt(i);
    return TEAM_COLOR_PALETTE[Math.abs(hash) % TEAM_COLOR_PALETTE.length];
}

function getMatchBorderColor(matchId) {
    const value = Number(matchId || 0);
    const idx = Math.abs(value) % TEAM_COLOR_PALETTE.length;
    return TEAM_COLOR_PALETTE[idx];
}

function byOrder(a, b) {
    return Number(a.round_number || 0) - Number(b.round_number || 0) || Number(a.match_order || 0) - Number(b.match_order || 0);
}

window.toggleVideo = toggleVideo;
window.minimizeVideo = minimizeVideo;
document.addEventListener('DOMContentLoaded', initTournamentPage);
