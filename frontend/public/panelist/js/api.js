// Panelist API Client

const API_BASE_URL = (window.location.hostname === 'localhost' && window.location.port === '8000')
    ? 'http://localhost:5000/api'
    : '/api';

class PanelistApi {
    constructor() {
        this.token = localStorage.getItem('panelistToken');
    }

    getHeaders() {
        return {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.token}`
        };
    }

    async login(username, password) {
        try {
            const response = await fetch(`${API_BASE_URL}/auth/panelist/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });
            const data = await response.json();
            if (data.success) {
                this.token = data.token;
                localStorage.setItem('panelistToken', data.token);
                localStorage.setItem('panelistUser', JSON.stringify(data.user));
            }
            return data;
        } catch (error) {
            console.error('Login error:', error);
            return { success: false, message: 'Network error' };
        }
    }

    async logout() {
        localStorage.removeItem('panelistToken');
        localStorage.removeItem('panelistUser');
        this.token = null;
    }

    async getAssignedEvents() {
        try {
            const response = await fetch(`${API_BASE_URL}/panelists/assigned-events`, {
                headers: this.getHeaders()
            });
            return await response.json();
        } catch (error) {
            console.error('Get assigned events error:', error);
            return { success: false, message: 'Network error' };
        }
    }

    async getEventParticipants(eventId) {
        try {
            const response = await fetch(`${API_BASE_URL}/participants/panelist/event/${eventId}`, {
                headers: this.getHeaders()
            });
            return await response.json();
        } catch (error) {
            console.error('Get participants error:', error);
            return { success: false, message: 'Network error' };
        }
    }

    async getParticipantGrades(eventId, participantId) {
        try {
            const response = await fetch(`${API_BASE_URL}/participants/panelist/${eventId}/${participantId}`, {
                headers: this.getHeaders()
            });
            return await response.json();
        } catch (error) {
            console.error('Get participant grades error:', error);
            return { success: false, message: 'Network error' };
        }
    }

    async submitGrade(eventId, participantId, criteriaId, score) {
        try {
            const response = await fetch(`${API_BASE_URL}/participants/grade/submit`, {
                method: 'POST',
                headers: this.getHeaders(),
                body: JSON.stringify({
                    event_id: eventId,
                    participant_id: participantId,
                    criteria_id: criteriaId,
                    score: parseFloat(score)
                })
            });
            return await response.json();
        } catch (error) {
            console.error('Submit grade error:', error);
            return { success: false, message: 'Network error' };
        }
    }

    async setBestCategory(eventId, participantId, isBest, category) {
        try {
            const response = await fetch(`${API_BASE_URL}/participants/panelist/best-category`, {
                method: 'POST',
                headers: this.getHeaders(),
                body: JSON.stringify({
                    event_id: Number(eventId),
                    participant_id: Number(participantId),
                    is_best: Boolean(isBest),
                    category
                })
            });
            return await response.json();
        } catch (error) {
            console.error('Set best category error:', error);
            return { success: false, message: 'Network error' };
        }
    }
}

const panelistApi = new PanelistApi();
