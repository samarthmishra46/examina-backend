import mongoose from 'mongoose';

const progressSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', unique: true },
  weakTopics: [String],
  completedTopics: [String],
  totalSessions: { type: Number, default: 0 },
  learningAnalytics: {
    questionsAsked: { type: Number, default: 0 },
    conceptsCovered: [String],
    lastActive: { type: Date, default: Date.now }
  }
});

export default mongoose.model('Progress', progressSchema);
