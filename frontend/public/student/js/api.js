// Student API Client

const API_BASE_URL = (window.location.hostname === 'localhost' && window.location.port === '8000')
    ? 'http://localhost:5000/api'
    : '/api';

class StudentApi {
    constructor() {
        this.token = localStorage.getItem('studentToken');
    }

    getHeaders() {
        return {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.token}`
        };
    }

    async login(name, studentNumber) {
        try {
            const response = await fetch(`${API_BASE_URL}/auth/student/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, student_number: studentNumber })
            });
            const data = await response.json();
            if (data.success) {
                this.token = data.token;
                localStorage.setItem('studentToken', data.token);
                localStorage.setItem('studentUser', JSON.stringify(data.user));
            }
            return data;
        } catch (error) {
            console.error('Login error:', error);
            return { success: false, message: 'Network error' };
        }
    }

    async logout() {
        localStorage.removeItem('studentToken');
        localStorage.removeItem('studentUser');
        this.token = null;
    }

    async getAssignedEvents() {
        try {
            const response = await fetch(`${API_BASE_URL}/students/assigned-events`, {
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
            const response = await fetch(`${API_BASE_URL}/participants/student/event/${eventId}`, {
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
            const response = await fetch(`${API_BASE_URL}/participants/student/${eventId}/${participantId}`, {
                headers: this.getHeaders()
            });
            return await response.json();
        } catch (error) {
            console.error('Get participant grades error:', error);
            return { success: false, message: 'Network error' };
        }
    }

    async submitGrade(participantId, criteriaId, score) {
        try {
            const response = await fetch(`${API_BASE_URL}/participants/grade/submit/student`, {
                method: 'POST',
                headers: this.getHeaders(),
                body: JSON.stringify({
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
}

const studentApi = new StudentApi();
