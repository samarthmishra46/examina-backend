import jwt from 'jsonwebtoken';
import Session from '../models/Session.js';
import User from '../models/User.js';
import Progress from '../models/Progress.js';
import PDF from '../models/PDF.js';
import { findRelevantChunks } from '../services/embeddings.js';
import { buildSystemPrompt, buildMessages } from '../services/contextBuilder.js';
import { streamTutorResponse } from '../services/claude.js';
import { pickExamQuestion, noticeForMissingPYQs } from '../services/examQuestionBank.js';

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret';

function ensureLectureState(session) {
  if (!session.lectureState) {
    session.lectureState = {
      phase: 'opening',
      openingStep: 1,
      currentTopicIdx: 0,
      currentSubStep: 'askFirst',
      energyLevel: 'unknown',
      completedTopicIds: [],
      examAttempts: []
    };
  }
  return session.lectureState;
}

function applyPhaseUpdate(state, update, plan) {
  if (!update || typeof update !== 'object') return;

  const allowedPhases = ['opening', 'teaching', 'testing', 'revision', 'complete'];
  if (allowedPhases.includes(update.phase)) state.phase = update.phase;
  if (typeof update.openingStep === 'number') state.openingStep = Math.min(9, Math.max(1, update.openingStep));
  if (typeof update.currentTopicIdx === 'number') state.currentTopicIdx = Math.max(0, update.currentTopicIdx);
  if (update.currentSubStep) state.currentSubStep = update.currentSubStep;
  if (update.energyLevel) state.energyLevel = update.energyLevel;
  if (update.markCompletedTopicId && !state.completedTopicIds.includes(update.markCompletedTopicId)) {
    state.completedTopicIds.push(update.markCompletedTopicId);
  }
  if (update.examQuestionDisclosure && state.pendingExamQuestion) {
    state.examAttempts.push({
      topicId: state.pendingExamQuestion.topicId,
      questionText: state.pendingExamQuestion.questionText,
      studentAnswer: '(see chat history)',
      diagnosis: 'awarded',
      awardedAt: new Date()
    });
    state.pendingExamQuestion = undefined;
  }

  if (state.phase === 'teaching' && plan?.topics?.length) {
    if (state.currentTopicIdx >= plan.topics.length) {
      state.phase = 'revision';
      state.currentSubStep = 'askFirst';
    }
  }
}

function chooseExamQuestionIfNeeded(state, plan) {
  const enteringTesting =
    state?.phase === 'testing' &&
    !state.pendingExamQuestion &&
    state.currentSubStep !== 'awaitingExamAnswer';
  if (!enteringTesting) return null;
  if (!plan?.topics?.[state.currentTopicIdx]) return null;

  const topicId = plan.topics[state.currentTopicIdx].id;
  const askedTexts = (state.examAttempts || []).map((a) => a.questionText);
  const q = pickExamQuestion({ lecturePlan: plan, topicId, alreadyAskedTexts: askedTexts });
  if (!q) return null;

  state.pendingExamQuestion = {
    topicId,
    questionText: q.text,
    source: q.source,
    year: q.year,
    board: q.board,
    marks: q.marks
  };
  return q;
}

function pickRelevantPageImages(plan, state, allImages) {
  if (!allImages?.length) return [];
  const topic = plan?.topics?.[state?.currentTopicIdx];
  if (!topic?.diagramRefs?.length) return [];
  const wanted = new Set(topic.diagramRefs.map((d) => d.pageNum));
  return allImages.filter((img) => wanted.has(img.pageNum)).slice(0, 3);
}

export function initTutorSocket(io) {
  io.on('connection', (socket) => {
    console.log('Socket connected:', socket.id);

    socket.on('join_session', async ({ sessionId, userId, token }) => {
      try {
        const decoded = jwt.verify(token, JWT_SECRET);
        if (!decoded) {
          socket.emit('error', { message: 'Invalid token' });
          return;
        }

        let session = await Session.findById(sessionId);
        if (!session) {
          socket.emit('error', { message: 'Session not found' });
          return;
        }

        ensureLectureState(session);
        await session.save();

        const progress = await Progress.findOne({ userId: decoded.id });

        socket.join(sessionId);
        socket.userId = decoded.id;
        socket.sessionId = sessionId;

        socket.emit('session_ready', {
          session: {
            _id: session._id,
            topic: session.topic,
            messages: session.messages,
            whiteboardSteps: session.whiteboardSteps,
            lectureState: session.lectureState,
            activePdfId: session.activePdfId
          },
          progress: progress || {}
        });
      } catch (err) {
        console.error('join_session error:', err);
        socket.emit('error', { message: 'Failed to join session' });
      }
    });

    socket.on('set_active_pdf', async ({ sessionId, pdfId }) => {
      try {
        const session = await Session.findById(sessionId);
        if (!session) return;
        session.activePdfId = pdfId || null;
        if (pdfId && !session.pdfReferences.some((id) => id.toString() === pdfId)) {
          session.pdfReferences.push(pdfId);
        }
        await session.save();
        socket.emit('active_pdf_set', { activePdfId: session.activePdfId });
      } catch (err) {
        console.error('set_active_pdf error:', err);
      }
    });

    socket.on('student_message', async ({ message, sessionId, pdfId, isDoubt }) => {
      try {
        const session = await Session.findById(sessionId);
        if (!session) {
          socket.emit('ai_error', { message: 'Session not found', sessionId });
          return;
        }

        const effectivePdfId = pdfId || session.activePdfId;
        if (effectivePdfId && session.activePdfId?.toString() !== effectivePdfId.toString()) {
          session.activePdfId = effectivePdfId;
          if (!session.pdfReferences.some((id) => id.toString() === effectivePdfId.toString())) {
            session.pdfReferences.push(effectivePdfId);
          }
        }

        const pdf = effectivePdfId ? await PDF.findById(effectivePdfId) : null;
        const lecturePlan = pdf?.lecturePlan || null;
        const pageImages = pdf?.pageImages || [];

        const state = ensureLectureState(session);

        const examQuestionToPose = chooseExamQuestionIfNeeded(state, lecturePlan);
        const pyqAvailabilityNotice = lecturePlan ? noticeForMissingPYQs(lecturePlan) : null;

        const [relevantChunks] = await Promise.all([
          effectivePdfId ? findRelevantChunks(message, effectivePdfId, isDoubt ? 3 : 5) : Promise.resolve([])
        ]);

        const user = await User.findById(session.userId);
        const progress = await Progress.findOne({ userId: session.userId });

        const studentMessage = { role: 'user', content: message };
        session.messages.push(studentMessage);

        const systemPrompt = buildSystemPrompt({
          studentName: user?.name || 'Student',
          learningLevel: user?.learningLevel || 'beginner',
          topic: lecturePlan?.chapterTitle || session.topic,
          weakTopics: progress?.weakTopics || [],
          relevantChunks,
          previousSummary: session.summary,
          lecturePlan,
          lectureState: state,
          pageImages,
          examQuestionToPose,
          pyqAvailabilityNotice
        });

        const historyForClaude = buildMessages(session.messages.slice(0, -1));
        historyForClaude.push({ role: 'user', content: message });

        const isQuickDoubt =
          isDoubt === true ||
          message.length < 100 ||
          /^(what|why|how|when|where|who|is|are|does)/i.test(message.trim());

        const visionImages = pickRelevantPageImages(lecturePlan, state, pageImages);

        const aiResult = await streamTutorResponse({
          systemPrompt,
          messages: historyForClaude,
          socket,
          sessionId,
          isQuickDoubt,
          visionImages
        });

        if (aiResult.phaseUpdate) {
          applyPhaseUpdate(state, aiResult.phaseUpdate, lecturePlan);
        }

        const assistantMessage = {
          role: 'assistant',
          content: JSON.stringify(aiResult)
        };
        session.messages.push(assistantMessage);

        if (aiResult.nextStep?.startsWith('SUMMARY:')) {
          session.summary = aiResult.nextStep.replace('SUMMARY:', '').trim();
          state.phase = 'complete';
        }

        if (progress) {
          progress.learningAnalytics.questionsAsked = (progress.learningAnalytics.questionsAsked || 0) + 1;
          progress.learningAnalytics.lastActive = new Date();
          await progress.save();
        }

        session.markModified('lectureState');
        await session.save();

        socket.emit('lecture_state', { lectureState: state });
      } catch (err) {
        console.error('student_message error:', err);
        socket.emit('ai_error', { message: 'Failed to process message', sessionId });
      }
    });

    socket.on('clear_whiteboard', ({ sessionId }) => {
      io.to(sessionId).emit('whiteboard_cleared');
    });

    socket.on('reset_lecture', async ({ sessionId }) => {
      try {
        const session = await Session.findById(sessionId);
        if (!session) return;
        session.lectureState = {
          phase: 'opening',
          openingStep: 1,
          currentTopicIdx: 0,
          currentSubStep: 'askFirst',
          energyLevel: 'unknown',
          completedTopicIds: [],
          examAttempts: []
        };
        session.markModified('lectureState');
        await session.save();
        socket.emit('lecture_state', { lectureState: session.lectureState });
      } catch (err) {
        console.error('reset_lecture error:', err);
      }
    });

    socket.on('save_whiteboard_step', async ({ sessionId, step }) => {
      try {
        await Session.findByIdAndUpdate(sessionId, {
          $push: { whiteboardSteps: { type: step.type, data: step.data } }
        });
      } catch (err) {
        console.error('save_whiteboard_step error:', err);
      }
    });

    socket.on('disconnect', () => {
      console.log('Socket disconnected:', socket.id);
    });
  });
}
