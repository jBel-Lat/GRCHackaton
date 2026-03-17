const express = require('express');
const router = express.Router();
const participantController = require('../controllers/participantController');
const { adminAuthMiddleware, panelistAuthMiddleware, studentAuthMiddleware, authMiddleware } = require('../middleware/auth');

// Admin routes
router.get('/admin/event/:event_id', adminAuthMiddleware, participantController.getEventParticipants);
router.get('/admin/event/:event_id/top-best-category', adminAuthMiddleware, participantController.getTopBestCategoryParticipants);
router.get('/admin/event/:event_id/top-best-category/export', adminAuthMiddleware, participantController.exportTopBestCategoryParticipants);
router.get('/admin/:event_id/:participant_id/breakdown', adminAuthMiddleware, participantController.getParticipantGradesBreakdown);
router.get('/admin/:event_id/:participant_id', adminAuthMiddleware, participantController.getParticipantDetails);
router.post('/admin/add', adminAuthMiddleware, participantController.addParticipant);
router.post('/admin/:participant_id/files', adminAuthMiddleware, participantController.participantFilesUploadMiddleware, participantController.uploadParticipantFiles);
router.put('/admin/:id', adminAuthMiddleware, participantController.updateParticipant);
router.delete('/admin/:id', adminAuthMiddleware, participantController.deleteParticipant);
router.delete('/admin/event/:event_id/participants', adminAuthMiddleware, participantController.deleteAllParticipantsForEvent);
// alias path to avoid client 404s on some environments
router.delete('/admin/event/:event_id/participants/delete', adminAuthMiddleware, participantController.deleteAllParticipantsForEvent);
router.put('/admin/event/:event_id/weights', adminAuthMiddleware, participantController.updateEventScoringWeights);
router.put('/admin/grade/panelist', adminAuthMiddleware, participantController.adminUpdatePanelistGrade);
router.put('/admin/grade/student', adminAuthMiddleware, participantController.adminUpdateStudentGrade);
router.post('/admin/import-teams', adminAuthMiddleware, participantController.importUploadMiddleware, participantController.importTeams);
router.get('/admin/export-teams', adminAuthMiddleware, participantController.exportTeams);
router.post('/admin/import-teams-custom', adminAuthMiddleware, participantController.importUploadMiddleware, participantController.importTeamsCustomLayout);
router.get('/admin/export-teams-custom', adminAuthMiddleware, participantController.exportTeamsCustomLayout);

// Panelist routes
router.get('/panelist/event/:event_id', panelistAuthMiddleware, participantController.getEventParticipantsForPanelist);
router.post('/panelist/best-category', panelistAuthMiddleware, participantController.toggleBestCategorySelection);
router.get('/panelist/:event_id/:participant_id', panelistAuthMiddleware, participantController.getPanelistParticipantGrades);
router.post('/grade/submit', panelistAuthMiddleware, participantController.submitGrade);

// Student routes
router.get('/student/event/:event_id', studentAuthMiddleware, participantController.getEventParticipantsForStudent);
router.get('/student/:event_id/:participant_id', studentAuthMiddleware, participantController.getStudentParticipantGrades);
router.post('/grade/submit/student', studentAuthMiddleware, participantController.submitGradeByStudent);

module.exports = router;
