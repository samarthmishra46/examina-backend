import mongoose from 'mongoose';

const chunkSchema = new mongoose.Schema({
  text: String,
  embedding: [Number],
  chunkIndex: Number
}, { _id: false });

const pageImageSchema = new mongoose.Schema({
  pageNum: Number,
  path: String,
  url: String,
  width: Number,
  height: Number
}, { _id: false });

const examQuestionSchema = new mongoose.Schema({
  text: String,
  source: { type: String, enum: ['actual', 'sample', 'generated'], default: 'generated' },
  year: { type: String, default: null },
  board: { type: String, default: null },
  marks: { type: Number, default: null },
  type: String,
  modelAnswer: String,
  keywords: [String],
  topicId: String
}, { _id: false });

const planTopicSchema = new mongoose.Schema({
  id: String,
  title: String,
  order: Number,
  summary: String,
  subtopics: [String],
  keyDefinitions: [{ term: String, definition: String, keywords: [String] }],
  commonMistake: String,
  thinkingQuestion: String,
  examAnswerHints: {
    oneMark: String,
    threeMarks: String,
    fiveMarks: String
  },
  diagramRefs: [{ pageNum: Number, name: String, description: String }],
  exampleAnalogy: String
}, { _id: false });

const lecturePlanSchema = new mongoose.Schema({
  chapterTitle: String,
  subject: String,
  exam: String,
  chapterContext: String,
  syllabusFit: String,
  whyItMatters: String,
  expectedWeightage: String,
  highYieldTopics: [String],
  commonExamConcepts: [String],
  commonConfusions: [String],
  topics: [planTopicSchema],
  examQuestions: [examQuestionSchema],
  hasActualPYQs: { type: Boolean, default: false },
  pyqSources: [String],
  finalChapterTestIds: [String],
  revisionPlan: String
}, { _id: false });

const pdfSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  fileName: String,
  originalName: String,
  filePath: String,
  extractedText: String,
  pageCount: { type: Number, default: 0 },
  pageImages: [pageImageSchema],
  chunks: [chunkSchema],
  lecturePlan: { type: lecturePlanSchema, default: null },
  planStatus: { type: String, enum: ['pending', 'rasterizing', 'planning', 'ready', 'failed'], default: 'pending' },
  planError: String,
  uploadedAt: { type: Date, default: Date.now }
});

export default mongoose.model('PDF', pdfSchema);
