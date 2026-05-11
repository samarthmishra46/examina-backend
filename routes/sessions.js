import express from 'express';
import Session from '../models/Session.js';
import authMiddleware from '../middleware/auth.js';

const router = express.Router();

router.use(authMiddleware);

router.get('/', async (req, res) => {
  try {
    const sessions = await Session.find({ userId: req.user.id })
      .sort({ createdAt: -1 })
      .select('topic createdAt updatedAt summary messages');
    res.json({ sessions });
  } catch (err) {
    res.status(500).json({ error: true, message: 'Server error', code: 'SERVER_ERROR' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const session = await Session.findOne({ _id: req.params.id, userId: req.user.id });
    if (!session) {
      return res.status(404).json({ error: true, message: 'Session not found', code: 'NOT_FOUND' });
    }
    res.json({ session });
  } catch (err) {
    res.status(500).json({ error: true, message: 'Server error', code: 'SERVER_ERROR' });
  }
});

router.post('/', async (req, res) => {
  try {
    const { topic } = req.body;
    const session = await Session.create({
      userId: req.user.id,
      topic: topic || 'General Study',
      messages: [],
      whiteboardSteps: []
    });
    res.status(201).json({ session });
  } catch (err) {
    res.status(500).json({ error: true, message: 'Server error', code: 'SERVER_ERROR' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const session = await Session.findOneAndDelete({ _id: req.params.id, userId: req.user.id });
    if (!session) {
      return res.status(404).json({ error: true, message: 'Session not found', code: 'NOT_FOUND' });
    }
    res.json({ message: 'Session deleted' });
  } catch (err) {
    res.status(500).json({ error: true, message: 'Server error', code: 'SERVER_ERROR' });
  }
});

export default router;
