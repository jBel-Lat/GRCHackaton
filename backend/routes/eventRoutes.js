const express = require('express');
const router = express.Router();
const eventController = require('../controllers/eventController');
const { adminAuthMiddleware } = require('../middleware/auth');

// All admin event routes require admin authentication
router.use(adminAuthMiddleware);

// Event management
router.get('/', eventController.getAllEvents);
router.get('/:id', eventController.getEventDetails);
router.post('/', eventController.createEvent);
router.put('/:id', eventController.updateEvent);
router.delete('/:id', eventController.deleteEvent);

// Criteria management
router.post('/criteria/add', eventController.addCriteria);
router.put('/criteria/:id', eventController.updateCriteria);
router.delete('/criteria/:id', eventController.deleteCriteria);

module.exports = router;
