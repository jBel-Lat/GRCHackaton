const express = require('express');
const router = express.Router();
const matchController = require('../controllers/matchController');
const { adminAuthMiddleware } = require('../middleware/auth');

router.get('/', matchController.getMatches);
router.post('/generate', adminAuthMiddleware, matchController.generateMatches);
router.post('/advance-round', adminAuthMiddleware, matchController.advanceToNextRound);
router.post('/reset', adminAuthMiddleware, matchController.resetTournament);
router.put('/:id/live', adminAuthMiddleware, matchController.updateMatchLiveUrl);
router.put('/:id/status', adminAuthMiddleware, matchController.updateMatchStatus);
router.put('/:id/winner', adminAuthMiddleware, matchController.updateMatchWinner);
router.put('/:id/teams', adminAuthMiddleware, matchController.updateMatchOpponents);
router.put('/:id/opponents', adminAuthMiddleware, matchController.updateMatchOpponents);

module.exports = router;
