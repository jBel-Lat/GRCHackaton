// Admin API Client

const API_BASE_URL = (window.location.hostname === 'localhost' && window.location.port === '8000')
    ? 'http://localhost:5000/api'
    : '/api';

function detectAdminBasePath() {
    const path = window.location.pathname || '';
    const match = path.match(/^\/[^/]+/);
    return match ? match[0] : '/admin';
}

class AdminApi {
    constructor() {
        this.token = localStorage.getItem('adminToken') || localStorage.getItem('token');
        this.authRedirectInProgress = false;
        this.adminBase = detectAdminBasePath();
    }

    isOnAdminLoginPage() {
        const path = window.location.pathname || '';
        return (
            path === `${this.adminBase}/` ||
            path === `${this.adminBase}` ||
            path.endsWith(`${this.adminBase}/index.html`) ||
            path.endsWith('/index.html')
        );
    }

    handleUnauthorized(message = '') {
        if (this.authRedirectInProgress) return;
        this.authRedirectInProgress = true;
        this.logout();

        if (!this.isOnAdminLoginPage()) {
            const reason = encodeURIComponent(message || 'Session expired. Please log in again.');
            window.location.href = `${this.adminBase}/?reason=${reason}`;
        }
    }

    getHeaders() {
        // Always pull latest token in case it changed.
        // No redirect here to avoid redirect loops during failed auth/API retries.
        this.token = localStorage.getItem('adminToken') || localStorage.getItem('token');
        const headers = {
            'Content-Type': 'application/json'
        };
        if (this.token) {
            headers['Authorization'] = `Bearer ${this.token}`;
        }
        return headers;
    }

    async login(username, password) {
        try {
            const response = await fetch(`${API_BASE_URL}/auth/admin/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });
            const data = await response.json();
            if (data.success) {
                this.token = data.token;
                localStorage.setItem('adminToken', data.token);
                localStorage.setItem('token', data.token);
                localStorage.setItem('adminUser', JSON.stringify(data.user));
            }
            return data;
        } catch (error) {
            console.error('Login error:', error);
            return { success: false, message: 'Network error' };
        }
    }

    async logout() {
        localStorage.removeItem('adminToken');
        localStorage.removeItem('token');
        localStorage.removeItem('adminUser');
        this.token = null;
    }

    // Events
    async getEvents() {
        try {
            const response = await fetch(`${API_BASE_URL}/events`, {
                headers: this.getHeaders()
            });
            const data = await response.json();
            if (response.status === 401) {
                this.handleUnauthorized(data?.message);
            }
            return data;
        } catch (error) {
            console.error('Get events error:', error);
            return { success: false, message: 'Network error' };
        }
    }

    async getEventDetails(eventId) {
        try {
            const response = await fetch(`${API_BASE_URL}/events/${eventId}`, {
                headers: this.getHeaders()
            });
            return await response.json();
        } catch (error) {
            console.error('Get event details error:', error);
            return { success: false, message: 'Network error' };
        }
    }

    async createEvent(eventData) {
        try {
            const response = await fetch(`${API_BASE_URL}/events`, {
                method: 'POST',
                headers: this.getHeaders(),
                body: JSON.stringify(eventData)
            });
            return await response.json();
        } catch (error) {
            console.error('Create event error:', error);
            return { success: false, message: 'Network error' };
        }
    }

    async updateEvent(eventId, eventData) {
        try {
            const response = await fetch(`${API_BASE_URL}/events/${eventId}`, {
                method: 'PUT',
                headers: this.getHeaders(),
                body: JSON.stringify(eventData)
            });
            return await response.json();
        } catch (error) {
            console.error('Update event error:', error);
            return { success: false, message: 'Network error' };
        }
    }

    async deleteEvent(eventId) {
        try {
            const response = await fetch(`${API_BASE_URL}/events/${eventId}`, {
                method: 'DELETE',
                headers: this.getHeaders()
            });
            return await response.json();
        } catch (error) {
            console.error('Delete event error:', error);
            return { success: false, message: 'Network error' };
        }
    }

    // Criteria
    async addCriteria(criteriaData) {
        try {
            const response = await fetch(`${API_BASE_URL}/events/criteria/add`, {
                method: 'POST',
                headers: this.getHeaders(),
                body: JSON.stringify(criteriaData)
            });
            return await response.json();
        } catch (error) {
            console.error('Add criteria error:', error);
            return { success: false, message: 'Network error' };
        }
    }

    async deleteCriteria(criteriaId) {
        try {
            const response = await fetch(`${API_BASE_URL}/events/criteria/${criteriaId}`, {
                method: 'DELETE',
                headers: this.getHeaders()
            });
            return await response.json();
        } catch (error) {
            console.error('Delete criteria error:', error);
            return { success: false, message: 'Network error' };
        }
    }

    async updateCriteria(criteriaId, criteriaData) {
        try {
            const response = await fetch(`${API_BASE_URL}/events/criteria/${criteriaId}`, {
                method: 'PUT',
                headers: this.getHeaders(),
                body: JSON.stringify(criteriaData)
            });
            return await response.json();
        } catch (error) {
            console.error('Update criteria error:', error);
            return { success: false, message: 'Network error' };
        }
    }

    // Participants
    async getEventParticipants(eventId) {
        try {
            const response = await fetch(`${API_BASE_URL}/participants/admin/event/${eventId}`, {
                headers: {
                    ...this.getHeaders(),
                    'Cache-Control': 'no-cache'
                },
                cache: 'no-store'
            });
            return await response.json();
        } catch (error) {
            console.error('Get participants error:', error);
            return { success: false, message: 'Network error' };
        }
    }

    async getParticipantDetails(eventId, participantId) {
        try {
            const response = await fetch(`${API_BASE_URL}/participants/admin/${eventId}/${participantId}`, {
                headers: {
                    ...this.getHeaders(),
                    'Cache-Control': 'no-cache'
                },
                cache: 'no-store'
            });
            return await response.json();
        } catch (error) {
            console.error('Get participant details error:', error);
            return { success: false, message: 'Network error' };
        }
    }

    async getParticipantGradesBreakdown(eventId, participantId) {
        try {
            const response = await fetch(`${API_BASE_URL}/participants/admin/${eventId}/${participantId}/breakdown`, {
                headers: {
                    ...this.getHeaders(),
                    'Cache-Control': 'no-cache'
                },
                cache: 'no-store'
            });
            return await response.json();
        } catch (error) {
            console.error('Get participant grades breakdown error:', error);
            return { success: false, message: 'Network error' };
        }
    }

    async getTopBestCategory(eventId) {
        try {
            const response = await fetch(`${API_BASE_URL}/participants/admin/event/${eventId}/top-best-category`, {
                headers: this.getHeaders(),
                cache: 'no-store'
            });
            return await response.json();
        } catch (error) {
            console.error('Get top best category error:', error);
            return { success: false, message: 'Network error' };
        }
    }

    async exportTopBestCategory(eventId, format = 'excel') {
        try {
            const response = await fetch(
                `${API_BASE_URL}/participants/admin/event/${eventId}/top-best-category/export?format=${encodeURIComponent(format)}`,
                {
                    headers: this.getHeaders(),
                    cache: 'no-store'
                }
            );

            if (response.status === 401) {
                let data = null;
                try { data = await response.json(); } catch (_) {}
                this.handleUnauthorized(data?.message);
                return { success: false, message: data?.message || 'Unauthorized' };
            }

            if (!response.ok) {
                let message = 'Export failed';
                try {
                    const data = await response.json();
                    message = data?.message || message;
                } catch (_) {}
                return { success: false, message };
            }

            const blob = await response.blob();
            const contentDisposition = response.headers.get('content-disposition') || '';
            const fileMatch = contentDisposition.match(/filename="?([^"]+)"?/i);
            const filename = fileMatch ? fileMatch[1] : (format === 'word' ? 'top_best_category.doc' : 'top_best_category.xlsx');
            return { success: true, data: { blob, filename } };
        } catch (error) {
            console.error('Export top best category error:', error);
            return { success: false, message: 'Network error' };
        }
    }

    async updateEventScoringWeights(eventId, studentWeight, panelistWeight) {
        try {
            const response = await fetch(`${API_BASE_URL}/participants/admin/event/${eventId}/weights`, {
                method: 'PUT',
                headers: this.getHeaders(),
                body: JSON.stringify({ student_weight: studentWeight, panelist_weight: panelistWeight })
            });
            return await response.json();
        } catch (error) {
            console.error('Update scoring weights error:', error);
            return { success: false, message: 'Network error' };
        }
    }

    async adminUpdatePanelistGrade(payload) {
        try {
            console.log('[api] adminUpdatePanelistGrade request', payload);
            const response = await fetch(`${API_BASE_URL}/participants/admin/grade/panelist`, {
                method: 'PUT',
                headers: this.getHeaders(),
                body: JSON.stringify({
                    participant_id: Number(payload.participant_id),
                    criteria_id: Number(payload.criteria_id),
                    event_id: payload.event_id ? Number(payload.event_id) : null,
                    panelist_id: Number.isFinite(Number(payload.panelist_id)) && Number(payload.panelist_id) > 0 ? Number(payload.panelist_id) : null,
                    panelist_name: payload.panelist_name || null,
                    score: Number(payload.score)
                })
            });
            const data = await response.json();
            console.log('[api] adminUpdatePanelistGrade response', response.status, data);
            return data;
        } catch (error) {
            console.error('Admin update panelist grade error:', error);
            return { success: false, message: 'Network error' };
        }
    }

    async adminUpdateStudentGrade(payload) {
        try {
            const response = await fetch(`${API_BASE_URL}/participants/admin/grade/student`, {
                method: 'PUT',
                headers: this.getHeaders(),
                body: JSON.stringify({
                    participant_id: Number(payload.participant_id),
                    criteria_id: Number(payload.criteria_id),
                    student_id: payload.student_id ? Number(payload.student_id) : null,
                    student_name: payload.student_name || null,
                    score: payload.score !== undefined ? Number(payload.score) : null
                })
            });
            return await response.json();
        } catch (error) {
            console.error('Admin update student grade error:', error);
            return { success: false, message: 'Network error' };
        }
    }

    async addParticipant(participantData) {
        try {
            const response = await fetch(`${API_BASE_URL}/participants/admin/add`, {
                method: 'POST',
                headers: this.getHeaders(),
                body: JSON.stringify(participantData)
            });
            return await response.json();
        } catch (error) {
            console.error('Add participant error:', error);
            return { success: false, message: 'Network error' };
        }
    }

    async uploadParticipantFiles(participantId, formData) {
        try {
            const headers = this.getHeaders();
            delete headers['Content-Type'];
            const response = await fetch(`${API_BASE_URL}/participants/admin/${participantId}/files`, {
                method: 'POST',
                headers,
                body: formData
            });
            return await response.json();
        } catch (error) {
            console.error('Upload participant files error:', error);
            return { success: false, message: 'Network error' };
        }
    }

    async updateParticipant(participantId, participantData) {
        try {
            const response = await fetch(`${API_BASE_URL}/participants/admin/${participantId}`, {
                method: 'PUT',
                headers: this.getHeaders(),
                body: JSON.stringify(participantData)
            });
            return await response.json();
        } catch (error) {
            console.error('Update participant error:', error);
            return { success: false, message: 'Network error' };
        }
    }

    async deleteParticipant(participantId) {
        try {
            const response = await fetch(`${API_BASE_URL}/participants/admin/${participantId}`, {
                method: 'DELETE',
                headers: this.getHeaders()
            });
            return await response.json();
        } catch (error) {
            console.error('Delete participant error:', error);
            return { success: false, message: 'Network error' };
        }
    }

    async deleteAllParticipants(eventId) {
        try {
            let response = await fetch(`${API_BASE_URL}/participants/admin/event/${eventId}/participants`, {
                method: 'DELETE',
                headers: this.getHeaders()
            });
            if (response.status === 404) {
                // try alias path
                response = await fetch(`${API_BASE_URL}/participants/admin/event/${eventId}/participants/delete`, {
                    method: 'DELETE',
                    headers: this.getHeaders()
                });
            }
            return await response.json();
        } catch (error) {
            console.error('Delete all participants error:', error);
            return { success: false, message: 'Network error' };
        }
    }

    // Panelists
    async getPanelists() {
        try {
            const response = await fetch(`${API_BASE_URL}/panelists`, {
                headers: this.getHeaders()
            });
            const data = await response.json();
            if (response.status === 401) {
                this.handleUnauthorized(data?.message);
            }
            return data;
        } catch (error) {
            console.error('Get panelists error:', error);
            return { success: false, message: 'Network error' };
        }
    }

    async createPanelist(panelistData) {
        try {
            const response = await fetch(`${API_BASE_URL}/panelists`, {
                method: 'POST',
                headers: this.getHeaders(),
                body: JSON.stringify(panelistData)
            });
            return await response.json();
        } catch (error) {
            console.error('Create panelist error:', error);
            return { success: false, message: 'Network error' };
        }
    }

    async updatePanelist(panelistId, panelistData) {
        try {
            const response = await fetch(`${API_BASE_URL}/panelists/${panelistId}`, {
                method: 'PUT',
                headers: this.getHeaders(),
                body: JSON.stringify(panelistData)
            });
            return await response.json();
        } catch (error) {
            console.error('Update panelist error:', error);
            return { success: false, message: 'Network error' };
        }
    }

    async deletePanelist(panelistId) {
        try {
            const response = await fetch(`${API_BASE_URL}/panelists/${panelistId}`, {
                method: 'DELETE',
                headers: this.getHeaders()
            });
            return await response.json();
        } catch (error) {
            console.error('Delete panelist error:', error);
            return { success: false, message: 'Network error' };
        }
    }

    async assignPanelistToEvent(panelistId, eventId) {
        try {
            const response = await fetch(`${API_BASE_URL}/panelists/assign-event`, {
                method: 'POST',
                headers: this.getHeaders(),
                body: JSON.stringify({ panelist_id: panelistId, event_id: eventId })
            });
            return await response.json();
        } catch (error) {
            console.error('Assign panelist error:', error);
            return { success: false, message: 'Network error' };
        }
    }

    async getPanelistAssignedEvents(panelistId) {
        try {
            const response = await fetch(`${API_BASE_URL}/panelists/${panelistId}/events`, {
                headers: this.getHeaders()
            });
            return await response.json();
        } catch (error) {
            console.error('Get panelist assigned events error:', error);
            return { success: false, message: 'Network error' };
        }
    }

    async removePanelistFromEvent(panelistId, eventId) {
        try {
            const response = await fetch(`${API_BASE_URL}/panelists/${panelistId}/event/${eventId}`, {
                method: 'DELETE',
                headers: this.getHeaders()
            });
            return await response.json();
        } catch (error) {
            console.error('Remove panelist error:', error);
            return { success: false, message: 'Network error' };
        }
    }

    // Students
    async getStudents() {
        try {
            const response = await fetch(`${API_BASE_URL}/students`, {
                headers: this.getHeaders()
            });
            const data = await response.json();
            if (response.status === 401) {
                this.handleUnauthorized(data?.message);
            }
            return data;
        } catch (error) {
            console.error('Get students error:', error);
            return { success: false, message: 'Network error' };
        }
    }

    async createStudent(studentData) {
        try {
            const response = await fetch(`${API_BASE_URL}/students`, {
                method: 'POST',
                headers: this.getHeaders(),
                body: JSON.stringify(studentData)
            });
            return await response.json();
        } catch (error) {
            console.error('Create student error:', error);
            return { success: false, message: 'Network error' };
        }
    }

    async updateStudent(studentId, studentData) {
        try {
            const response = await fetch(`${API_BASE_URL}/students/${studentId}`, {
                method: 'PUT',
                headers: this.getHeaders(),
                body: JSON.stringify(studentData)
            });
            return await response.json();
        } catch (error) {
            console.error('Update student error:', error);
            return { success: false, message: 'Network error' };
        }
    }

    async deleteStudent(studentId) {
        try {
            const response = await fetch(`${API_BASE_URL}/students/${studentId}`, {
                method: 'DELETE',
                headers: this.getHeaders()
            });
            return await response.json();
        } catch (error) {
            console.error('Delete student error:', error);
            return { success: false, message: 'Network error' };
        }
    }

    async assignStudentToEvent(studentId, eventId) {
        try {
            const response = await fetch(`${API_BASE_URL}/students/assign-event`, {
                method: 'POST',
                headers: this.getHeaders(),
                body: JSON.stringify({ student_id: studentId, event_id: eventId })
            });
            return await response.json();
        } catch (error) {
            console.error('Assign student error:', error);
            return { success: false, message: 'Network error' };
        }
    }

    async getStudentAssignedEvents(studentId) {
        try {
            const response = await fetch(`${API_BASE_URL}/students/${studentId}/events`, {
                headers: this.getHeaders()
            });
            return await response.json();
        } catch (error) {
            console.error('Get student assigned events error:', error);
            return { success: false, message: 'Network error' };
        }
    }

    async removeStudentFromEvent(studentId, eventId) {
        try {
            const response = await fetch(`${API_BASE_URL}/students/${studentId}/event/${eventId}`, {
                method: 'DELETE',
                headers: this.getHeaders()
            });
            return await response.json();
        } catch (error) {
            console.error('Remove student error:', error);
            return { success: false, message: 'Network error' };
        }
    }

    async assignEventsToAllStudents(eventIds) {
        try {
            const response = await fetch(`${API_BASE_URL}/students/assign-events-bulk`, {
                method: 'POST',
                headers: this.getHeaders(),
                body: JSON.stringify({ event_ids: eventIds })
            });
            return await response.json();
        } catch (error) {
            console.error('Bulk assign events error:', error);
            return { success: false, message: 'Network error' };
        }
    }

    async importSubmissionsFromGoogleSheet(sheetUrl, eventId = null) {
        try {
            const response = await fetch(`${API_BASE_URL}/submissions/import-google-sheet`, {
                method: 'POST',
                headers: this.getHeaders(),
                body: JSON.stringify({
                    sheet_url: sheetUrl,
                    event_id: eventId
                })
            });
            return await response.json();
        } catch (error) {
            console.error('Import submissions from Google Sheet error:', error);
            return { success: false, message: 'Network error' };
        }
    }

    async getSubmissions(eventId = null) {
        try {
            const query = eventId ? `?event_id=${encodeURIComponent(eventId)}` : '';
            const response = await fetch(`${API_BASE_URL}/submissions${query}`, {
                headers: this.getHeaders(),
                cache: 'no-store'
            });
            const data = await response.json();
            if (response.status === 401) {
                this.handleUnauthorized(data?.message);
            }
            return data;
        } catch (error) {
            console.error('Get submissions error:', error);
            return { success: false, message: 'Network error' };
        }
    }

    async getMatches(eventId = null) {
        try {
            const query = eventId ? `?event_id=${encodeURIComponent(eventId)}` : '';
            const response = await fetch(`${API_BASE_URL}/matches${query}`, {
                headers: this.getHeaders(),
                cache: 'no-store'
            });
            return await response.json();
        } catch (error) {
            console.error('Get matches error:', error);
            return { success: false, message: 'Network error' };
        }
    }

    async generateMatches(payload) {
        try {
            const response = await fetch(`${API_BASE_URL}/matches/generate`, {
                method: 'POST',
                headers: this.getHeaders(),
                body: JSON.stringify(payload)
            });
            return await response.json();
        } catch (error) {
            console.error('Generate matches error:', error);
            return { success: false, message: 'Network error' };
        }
    }

    async advanceMatchesRound(eventId) {
        try {
            const response = await fetch(`${API_BASE_URL}/matches/advance-round`, {
                method: 'POST',
                headers: this.getHeaders(),
                body: JSON.stringify({ event_id: eventId })
            });
            return await response.json();
        } catch (error) {
            console.error('Advance matches round error:', error);
            return { success: false, message: 'Network error' };
        }
    }

    async updateMatchLiveUrl(matchId, facebookLiveUrl) {
        try {
            const response = await fetch(`${API_BASE_URL}/matches/${matchId}/live`, {
                method: 'PUT',
                headers: this.getHeaders(),
                body: JSON.stringify({ facebook_live_url: facebookLiveUrl || '' })
            });
            return await response.json();
        } catch (error) {
            console.error('Update match live URL error:', error);
            return { success: false, message: 'Network error' };
        }
    }

    async updateMatchStatus(matchId, status) {
        try {
            const response = await fetch(`${API_BASE_URL}/matches/${matchId}/status`, {
                method: 'PUT',
                headers: this.getHeaders(),
                body: JSON.stringify({ status })
            });
            return await response.json();
        } catch (error) {
            console.error('Update match status error:', error);
            return { success: false, message: 'Network error' };
        }
    }

    async updateMatchWinner(matchId, winnerSide) {
        try {
            const response = await fetch(`${API_BASE_URL}/matches/${matchId}/winner`, {
                method: 'PUT',
                headers: this.getHeaders(),
                body: JSON.stringify({ winner_side: winnerSide })
            });
            return await response.json();
        } catch (error) {
            console.error('Update match winner error:', error);
            return { success: false, message: 'Network error' };
        }
    }

    async updateMatchOpponents(matchId, payload) {
        try {
            const response = await fetch(`${API_BASE_URL}/matches/${matchId}/opponents`, {
                method: 'PUT',
                headers: this.getHeaders(),
                body: JSON.stringify(payload)
            });
            return await response.json();
        } catch (error) {
            console.error('Update match opponents error:', error);
            return { success: false, message: 'Network error' };
        }
    }
}

const adminApi = new AdminApi();
