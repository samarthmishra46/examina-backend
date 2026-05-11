import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import PDF from '../models/PDF.js';
import { processPDF, buildPlanInBackground } from '../services/pdfProcessor.js';
import authMiddleware from '../middleware/auth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../uploads');
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const unique = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    cb(null, `${unique}${path.extname(file.originalname)}`);
  }
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed'));
    }
  },
  limits: { fileSize: 50 * 1024 * 1024 }
});

router.use(authMiddleware);

router.post('/upload', upload.single('pdf'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: true, message: 'No PDF file provided', code: 'NO_FILE' });
    }

    const pdf = await processPDF(req.file.path, req.user.id, req.file.originalname);
    res.status(201).json({ pdf });
  } catch (err) {
    console.error('PDF upload error:', err);
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    res.status(500).json({ error: true, message: err.message || 'PDF processing failed', code: 'PROCESSING_ERROR' });
  }
});

router.get('/', async (req, res) => {
  try {
    const pdfs = await PDF.find({ userId: req.user.id })
      .select('-chunks -extractedText')
      .sort({ uploadedAt: -1 });
    res.json({ pdfs });
  } catch (err) {
    res.status(500).json({ error: true, message: 'Server error', code: 'SERVER_ERROR' });
  }
});

router.get('/:id/plan', async (req, res) => {
  try {
    const pdf = await PDF.findOne({ _id: req.params.id, userId: req.user.id })
      .select('planStatus planError lecturePlan pageCount pageImages originalName');
    if (!pdf) return res.status(404).json({ error: true, message: 'PDF not found' });
    res.json({
      planStatus: pdf.planStatus,
      planError: pdf.planError,
      pageCount: pdf.pageCount,
      hasImages: pdf.pageImages?.length || 0,
      lecturePlan: pdf.lecturePlan,
      originalName: pdf.originalName
    });
  } catch (err) {
    res.status(500).json({ error: true, message: 'Server error' });
  }
});

router.post('/:id/replan', async (req, res) => {
  try {
    const pdf = await PDF.findOne({ _id: req.params.id, userId: req.user.id });
    if (!pdf) return res.status(404).json({ error: true, message: 'PDF not found' });
    pdf.planStatus = 'pending';
    pdf.planError = undefined;
    await pdf.save();
    buildPlanInBackground(pdf._id);
    res.json({ message: 'Replan queued', planStatus: 'pending' });
  } catch (err) {
    res.status(500).json({ error: true, message: 'Server error' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const pdf = await PDF.findOneAndDelete({ _id: req.params.id, userId: req.user.id });
    if (!pdf) {
      return res.status(404).json({ error: true, message: 'PDF not found', code: 'NOT_FOUND' });
    }
    if (pdf.filePath && fs.existsSync(pdf.filePath)) {
      fs.unlinkSync(pdf.filePath);
    }
    res.json({ message: 'PDF deleted' });
  } catch (err) {
    res.status(500).json({ error: true, message: 'Server error', code: 'SERVER_ERROR' });
  }
});

export default router;
