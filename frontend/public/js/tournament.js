const state = {
    matches: [],
    selectedEventId: '',
    expandedMatchId: null,
    refreshTimer: null,
    maxRoundSeen: 0
};

const API_BASE = '/api';

function initTournamentPage() {
    document.getElementById('eventFilterSelect')?.addEventListener('change', (e) => {
        state.selectedEventId = e.target.value || '';
        state.expandedMatchId = null;
        updateRoundCounter();
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

        if (!response.ok || !data.success) {
            throw new Error(data.message || 'Unable to load matches.');
        }

        state.matches = Array.isArray(data.data) ? data.data : [];

        const currentMaxRound = state.matches.length
            ? Math.max(...state.matches.map((m) => Number(m.round_number || 1)))
            : 0;

        // Stop currently open stream when a new round appears.
        if (state.maxRoundSeen > 0 && currentMaxRound > state.maxRoundSeen) {
            state.expandedMatchId = null;
            setStatus(`Round ${currentMaxRound} has started. Stream panel was reset for the new set.`, 'success');
        }
        state.maxRoundSeen = currentMaxRound;

        // If opened match is no longer ongoing, auto-close the stream.
        if (state.expandedMatchId) {
            const opened = state.matches.find((m) => Number(m.id) === Number(state.expandedMatchId));
            const openedStatus = String(opened?.status || '').toLowerCase();
            if (!opened || openedStatus === 'finished') {
                state.expandedMatchId = null;
            }
        }

        syncEventFilter();
        updateRoundCounter();
        renderMatches();
        if (!document.getElementById('tournamentStatusMessage')?.textContent) {
            setStatus('Matches updated.', 'success');
        }
    } catch (error) {
        console.error('Fetch matches error:', error);
        setStatus(error.message || 'Failed to fetch matches.', 'error');
    }
}

function syncEventFilter() {
    const select = document.getElementById('eventFilterSelect');
    if (!select) return;

    const eventsMap = new Map();
    state.matches.forEach((match) => {
        const eventId = String(match.event_id || '');
        if (!eventId) return;
        if (!eventsMap.has(eventId)) {
            eventsMap.set(eventId, match.event_name || `Event ${eventId}`);
        }
    });

    const previousValue = state.selectedEventId;
    select.innerHTML = '<option value="">All events</option>';

    [...eventsMap.entries()]
        .sort((a, b) => a[1].localeCompare(b[1]))
        .forEach(([eventId, eventName]) => {
            const option = document.createElement('option');
            option.value = eventId;
            option.textContent = eventName;
            if (previousValue && previousValue === eventId) {
                option.selected = true;
            }
            select.appendChild(option);
        });

    if (previousValue && !eventsMap.has(previousValue)) {
        state.selectedEventId = '';
    }
}

function renderMatches() {
    const container = document.getElementById('tournamentMatchesContainer');
    if (!container) return;

    const filtered = state.selectedEventId
        ? state.matches.filter((m) => String(m.event_id) === String(state.selectedEventId))
        : state.matches;

    if (!filtered.length) {
        container.innerHTML = '<div class="round-section"><p>No matches available for the selected event.</p></div>';
        return;
    }

    const grouped = filtered.reduce((acc, match) => {
        const eventKey = `${match.event_id}::${match.event_name || `Event ${match.event_id}`}`;
        if (!acc[eventKey]) acc[eventKey] = {};

        const roundName = match.round_name || `Round ${match.round_number || 1}`;
        if (!acc[eventKey][roundName]) acc[eventKey][roundName] = [];
        acc[eventKey][roundName].push(match);
        return acc;
    }, {});

    const html = Object.entries(grouped).map(([eventKey, rounds]) => {
        const [, eventName] = eventKey.split('::');
        const roundsHtml = Object.entries(rounds).map(([roundName, matches]) => {
            const matchHtml = matches
                .slice()
                .sort((a, b) => Number(a.match_order || 0) - Number(b.match_order || 0))
                .map(renderMatchCard)
                .join('');

            return `
                <section class="round-section">
                    <h2 class="round-title">${escapeHtml(eventName)} - ${escapeHtml(roundName)}</h2>
                    <div class="match-list">${matchHtml}</div>
                </section>
            `;
        }).join('');

        return roundsHtml;
    }).join('');

    container.innerHTML = html;
}

function updateRoundCounter() {
    const counter = document.getElementById('bracketRoundCounter');
    if (!counter) return;

    const filtered = state.selectedEventId
        ? state.matches.filter((m) => String(m.event_id) === String(state.selectedEventId))
        : state.matches;

    if (!filtered.length) {
        counter.textContent = 'Round: --';
        return;
    }

    const maxRound = Math.max(...filtered.map((m) => Number(m.round_number || 1)));
    const latestMatches = filtered.filter((m) => Number(m.round_number || 1) === maxRound);
    const remaining = latestMatches.filter((m) => String(m.status || '').toLowerCase() !== 'finished').length;
    counter.textContent = `Round ${maxRound} • ${remaining} active set${remaining === 1 ? '' : 's'}`;
}

function renderMatchCard(match) {
    const matchId = Number(match.id);
    const status = String(match.status || 'pending').toLowerCase();
    const hasLive = Boolean((match.facebook_live_url || '').trim());
    const isOpen = state.expandedMatchId === matchId;
    const showLiveBadge = status === 'ongoing' && hasLive;

    return `
        <article class="match-card ${status === 'ongoing' ? 'ongoing' : ''}">
            <div class="match-header">
                <div>
                    <div class="match-id">Match #${Number(match.match_order || 0)}</div>
                    <div class="match-teams">${escapeHtml(match.teamA)} <span>vs</span> ${escapeHtml(match.teamB)}</div>
                </div>
                <div class="badge-row">
                    <span class="badge ${escapeHtml(status)}">${escapeHtml(status)}</span>
                    ${showLiveBadge ? '<span class="badge live">LIVE</span>' : ''}
                </div>
            </div>
            <div class="match-actions">
                <button class="btn btn-primary" onclick="toggleVideo(${matchId})">Watch Video</button>
                ${isOpen ? '<button class="btn btn-secondary" onclick="minimizeVideo()">Minimize Video</button>' : ''}
            </div>
            <div class="video-panel ${isOpen ? 'open' : ''}">
                ${isOpen ? renderVideoPanel(match) : ''}
            </div>
        </article>
    `;
}

function renderVideoPanel(match) {
    const liveUrl = (match.facebook_live_url || '').trim();
    if (!liveUrl) {
        return `
            <div class="video-inner">
                <p style="margin:0 0 8px 0; color:#475569;">Live stream not available for this battle yet.</p>
                <button class="btn btn-secondary" onclick="minimizeVideo()">Minimize Video</button>
            </div>
        `;
    }

    const embedUrl = toFacebookEmbedUrl(liveUrl);
    return `
        <div class="video-inner">
            <div class="video-embed">
                <iframe
                    src="${escapeAttr(embedUrl)}"
                    allow="autoplay; clipboard-write; encrypted-media; picture-in-picture; web-share"
                    allowfullscreen
                    loading="lazy"
                    title="Live match ${Number(match.id)}"
                ></iframe>
            </div>
            <div class="video-actions">
                <a class="btn btn-secondary" href="${escapeAttr(liveUrl)}" target="_blank" rel="noopener">Watch on Facebook</a>
                <button class="btn btn-secondary" onclick="minimizeVideo()">Minimize Video</button>
            </div>
        </div>
    `;
}

function toggleVideo(matchId) {
    const id = Number(matchId);
    if (!Number.isFinite(id) || id <= 0) return;

    if (state.expandedMatchId === id) {
        state.expandedMatchId = null;
    } else {
        state.expandedMatchId = id;
    }
    renderMatches();
}

function minimizeVideo() {
    state.expandedMatchId = null;
    renderMatches();
}

function toFacebookEmbedUrl(url) {
    const cleaned = String(url || '').trim();
    if (!cleaned) return '';
    if (cleaned.includes('facebook.com/plugins/video.php')) return cleaned;
    return `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(cleaned)}&show_text=false&width=1280`;
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

    // Keep message short-lived so the dashboard can update frequently.
    setTimeout(() => {
        if (el.textContent === message) {
            el.style.display = 'none';
            el.textContent = '';
        }
    }, 3000);
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

window.toggleVideo = toggleVideo;
window.minimizeVideo = minimizeVideo;

document.addEventListener('DOMContentLoaded', initTournamentPage);
