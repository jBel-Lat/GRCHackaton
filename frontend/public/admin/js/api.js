// Admin API Client

const API_BASE_URL = (window.location.hostname === 'localhost' && window.location.port === '8000')
    ? 'http://localhost:5000/api'
    : '/api';

class AdminApi {
    constructor() {
        this.token = localStorage.getItem('adminToken');
    }

    getHeaders() {
        // always pull latest token in case it changed (e.g., after navigation)
        this.token = localStorage.getItem('adminToken');
        if (!this.token) {
            // force re-auth if token is missing
            window.location.href = '/admin/index.html';
        }
        return {
            'Content-Type': 'application/json',
            'Authorization': this.token ? `Bearer ${this.token}` : ''
        };
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
        localStorage.removeItem('adminUser');
        this.token = null;
    }

    // Events
    async getEvents() {
        try {
            const response = await fetch(`${API_BASE_URL}/events`, {
                headers: this.getHeaders()
            });
            return await response.json();
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
            return await response.json();
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
            return await response.json();
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
}

const adminApi = new AdminApi();
