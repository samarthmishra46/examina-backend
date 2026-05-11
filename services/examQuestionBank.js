import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function rank(question) {
  if (question.source === 'actual') return 0;
  if (question.source === 'sample') return 1;
  return 2;
}

export function pickExamQuestion({ lecturePlan, topicId, alreadyAskedTexts = [], preferredMarks }) {
  if (!lecturePlan?.examQuestions?.length) return null;

  const asked = new Set(alreadyAskedTexts.map((t) => (t || '').trim().toLowerCase()));
  const candidates = lecturePlan.examQuestions
    .filter((q) => q.topicId === topicId)
    .filter((q) => !asked.has((q.text || '').trim().toLowerCase()));
  if (candidates.length === 0) return null;

  candidates.sort((a, b) => {
    const r = rank(a) - rank(b);
    if (r !== 0) return r;
    if (preferredMarks && a.marks && b.marks) {
      return Math.abs(a.marks - preferredMarks) - Math.abs(b.marks - preferredMarks);
    }
    return 0;
  });
  return candidates[0];
}

export function noticeForMissingPYQs(lecturePlan) {
  if (lecturePlan?.hasActualPYQs) return null;
  return "I don't have actual PYQs for this topic yet. Upload previous year questions or sample papers so I can test you with real exam questions. For now, I'll create exam-style practice questions based on the pattern.";
}

const DIAGNOSE_SYSTEM = `You are EXAMINA's Diagnostic Agent. Given a student's answer to an exam question, classify it as one of:
- "correct" (full marks-worthy, hits all keywords)
- "partially_correct" (right idea, missing keywords or structure)
- "wrong" (incorrect concept)
- "vague" (true but too thin)
- "confused" (mixes concepts)
- "blank" (no real attempt)

Return ONLY valid JSON: {"diagnosis":"...","missingKeywords":["..."],"strengths":["..."],"shortFeedback":"one sentence"}`;

export async function diagnoseAnswer({ question, modelAnswer, keywords, studentAnswer }) {
  const messages = [
    {
      role: 'user',
      content: `QUESTION (${question.marks ?? '?'} marks, ${question.type ?? 'unknown'}):\n${question.text}\n\nMODEL ANSWER:\n${modelAnswer || '(none provided)'}\n\nKEY KEYWORDS the examiner expects: ${(keywords || []).join(', ') || '(none specified)'}\n\nSTUDENT ANSWER:\n${studentAnswer}\n\nClassify and respond with the JSON only.`
    },
    { role: 'assistant', content: '{' }
  ];

  try {
    const resp = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 400,
      system: DIAGNOSE_SYSTEM,
      messages
    });
    const raw = '{' + (resp.content[0]?.text || '');
    return JSON.parse(raw);
  } catch (err) {
    return { diagnosis: 'partially_correct', missingKeywords: [], strengths: [], shortFeedback: 'Diagnostic unavailable.' };
  }
}
