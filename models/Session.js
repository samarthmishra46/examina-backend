import mongoose from 'mongoose';

const messageSchema = new mongoose.Schema({
  role: String,
  content: String,
  timestamp: { type: Date, default: Date.now }
}, { _id: false });

const whiteboardStepSchema = new mongoose.Schema({
  type: String,
  data: Object,
  timestamp: { type: Date, default: Date.now }
}, { _id: false });

const lectureStateSchema = new mongoose.Schema({
  phase: {
    type: String,
    enum: ['opening', 'teaching', 'testing', 'revision', 'complete'],
    default: 'opening'
  },
  openingStep: { type: Number, default: 1 },
  currentTopicIdx: { type: Number, default: 0 },
  currentSubStep: {
    type: String,
    enum: ['askFirst', 'awaitingAnswer', 'teach', 'check', 'adapt', 'convertToExam', 'activeRecall', 'questionPosed', 'awaitingExamAnswer'],
    default: 'askFirst'
  },
  energyLevel: { type: String, enum: ['fresh', 'sleepy', 'stressed', 'ready', 'unknown'], default: 'unknown' },
  completedTopicIds: [String],
  examAttempts: [{
    topicId: String,
    questionText: String,
    studentAnswer: String,
    diagnosis: String,
    awardedAt: { type: Date, default: Date.now }
  }],
  pendingExamQuestion: {
    topicId: String,
    questionText: String,
    source: String,
    year: String,
    board: String,
    marks: Number
  }
}, { _id: false });

const sessionSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  topic: { type: String, default: 'General Study' },
  activePdfId: { type: mongoose.Schema.Types.ObjectId, ref: 'PDF', default: null },
  messages: [messageSchema],
  whiteboardSteps: [whiteboardStepSchema],
  pdfReferences: [{ type: mongoose.Schema.Types.ObjectId, ref: 'PDF' }],
  lectureState: { type: lectureStateSchema, default: () => ({}) },
  summary: String,
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

sessionSchema.pre('save', function (next) {
  this.updatedAt = new Date();
  next();
});

export default mongoose.model('Session', sessionSchema);
