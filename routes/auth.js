import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { body, validationResult } from 'express-validator';
import User from '../models/User.js';
import Progress from '../models/Progress.js';
import authMiddleware from '../middleware/auth.js';

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret';

const generateToken = (user) =>
  jwt.sign({ id: user._id, email: user.email, name: user.name }, JWT_SECRET, { expiresIn: '7d' });

router.post(
  '/register',
  [
    body('name').trim().notEmpty().withMessage('Name is required'),
    body('email').isEmail().withMessage('Valid email required'),
    body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters')
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ error: true, message: errors.array()[0].msg, code: 'VALIDATION_ERROR' });
      }

      const { name, email, password, learningLevel } = req.body;

      const existing = await User.findOne({ email });
      if (existing) {
        return res.status(409).json({ error: true, message: 'Email already registered', code: 'EMAIL_EXISTS' });
      }

      const hashed = await bcrypt.hash(password, 12);
      const user = await User.create({ name, email, password: hashed, learningLevel: learningLevel || 'beginner' });

      await Progress.create({ userId: user._id });

      const token = generateToken(user);
      res.status(201).json({
        token,
        user: { id: user._id, name: user.name, email: user.email, learningLevel: user.learningLevel }
      });
    } catch (err) {
      console.error('Register error:', err);
      res.status(500).json({ error: true, message: 'Server error', code: 'SERVER_ERROR' });
    }
  }
);

router.post(
  '/login',
  [
    body('email').isEmail().withMessage('Valid email required'),
    body('password').notEmpty().withMessage('Password is required')
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ error: true, message: errors.array()[0].msg, code: 'VALIDATION_ERROR' });
      }

      const { email, password } = req.body;
      const user = await User.findOne({ email });
      if (!user) {
        return res.status(401).json({ error: true, message: 'Invalid credentials', code: 'INVALID_CREDENTIALS' });
      }

      const match = await bcrypt.compare(password, user.password);
      if (!match) {
        return res.status(401).json({ error: true, message: 'Invalid credentials', code: 'INVALID_CREDENTIALS' });
      }

      const token = generateToken(user);
      res.json({
        token,
        user: { id: user._id, name: user.name, email: user.email, learningLevel: user.learningLevel }
      });
    } catch (err) {
      console.error('Login error:', err);
      res.status(500).json({ error: true, message: 'Server error', code: 'SERVER_ERROR' });
    }
  }
);

router.get('/me', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password');
    if (!user) {
      return res.status(404).json({ error: true, message: 'User not found', code: 'USER_NOT_FOUND' });
    }
    res.json({ user });
  } catch (err) {
    res.status(500).json({ error: true, message: 'Server error', code: 'SERVER_ERROR' });
  }
});

export default router;
