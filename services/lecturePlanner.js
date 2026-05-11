import Anthropic from '@anthropic-ai/sdk';
import { readPageAsBase64 } from './pdfRasterizer.js';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const PLANNER_MODEL = 'claude-sonnet-4-20250514';

const PLANNER_SYSTEM_PROMPT = `You are EXAMINA's Lecture Planner Agent.

You receive the full text of a chapter PDF (and a sample of page images for diagrams/figures). Your job: produce a complete, exam-oriented lecture plan in JSON.

You must:
1. Identify the chapter title, subject, exam (CBSE / ICSE / NCERT / State Board / Cambridge / etc.), syllabus fit.
2. Detect whether the PDF actually contains previous-year questions (PYQs) or sample-paper questions. Look for explicit "CBSE 20XX", "Sample Paper", "Question Bank" labels. If you find them, set hasActualPYQs=true and copy the questions verbatim with source="actual" and the exact year/board if present. Never invent a year/board.
3. Break the chapter into 4-8 ordered teaching topics, each with:
   - id (t1, t2, ...) and a clear title
   - 1-line summary
   - 2-5 subtopics (short bullets)
   - keyDefinitions: term + textbook-style definition + the 2-4 keywords an examiner looks for
   - commonMistake students make
   - thinkingQuestion to ask BEFORE explaining (activates the brain — short, open)
   - exampleAnalogy (1 line, real-world)
   - examAnswerHints: how to write this for 1 mark / 3 marks / 5 marks (short)
   - diagramRefs: pageNum + name + description for any diagrams/figures from the PDF that explain this topic
4. examQuestions: aim for 2-4 questions per topic. Prefer actual PYQs / sample paper questions copied verbatim from the PDF; otherwise mark source="generated" and craft exam-style questions matching the board's pattern. Each question MUST include topicId, marks, type (definition / short-answer / case-based / numerical / application / diagram-based), modelAnswer (concise), keywords.
5. commonConfusions: list 3-6 things students confuse across this chapter.
6. whyItMatters: 2-3 sentences for the class opening — why this chapter exists, what problem it solves, how it links to the rest of the syllabus.
7. expectedWeightage: only include if the PDF or syllabus material explicitly states it. Otherwise null.
8. revisionPlan: 1-paragraph recap blueprint to use at the end of class.

Output ONLY valid JSON matching the schema. No markdown, no preamble.

Schema:
{
  "chapterTitle": "string",
  "subject": "string",
  "exam": "string",
  "chapterContext": "string",
  "syllabusFit": "string",
  "whyItMatters": "string",
  "expectedWeightage": "string | null",
  "highYieldTopics": ["string"],
  "commonExamConcepts": ["string"],
  "commonConfusions": ["string"],
  "topics": [
    {
      "id": "t1",
      "title": "string",
      "order": 1,
      "summary": "string",
      "subtopics": ["string"],
      "keyDefinitions": [{"term":"string","definition":"string","keywords":["string"]}],
      "commonMistake": "string",
      "thinkingQuestion": "string",
      "exampleAnalogy": "string",
      "examAnswerHints": {"oneMark":"string","threeMarks":"string","fiveMarks":"string"},
      "diagramRefs": [{"pageNum":number,"name":"string","description":"string"}]
    }
  ],
  "examQuestions": [
    {
      "text":"string",
      "source":"actual" | "sample" | "generated",
      "year": "string | null",
      "board": "string | null",
      "marks": number,
      "type": "string",
      "modelAnswer":"string",
      "keywords":["string"],
      "topicId":"t1"
    }
  ],
  "hasActualPYQs": boolean,
  "pyqSources": ["string"],
  "revisionPlan": "string"
}`;

function pickRepresentativePages(pageImages, max = 8) {
  if (!pageImages || pageImages.length === 0) return [];
  if (pageImages.length <= max) return pageImages;
  const step = pageImages.length / max;
  const out = [];
  for (let i = 0; i < max; i++) out.push(pageImages[Math.floor(i * step)]);
  return out;
}

function clampText(text, maxChars = 60000) {
  if (!text) return '';
  if (text.length <= maxChars) return text;
  const head = text.slice(0, Math.floor(maxChars * 0.7));
  const tail = text.slice(-Math.floor(maxChars * 0.3));
  return `${head}\n\n[...truncated middle...]\n\n${tail}`;
}

export async function generateLecturePlan({ extractedText, pageImages, originalName }) {
  const samplePages = pickRepresentativePages(pageImages, 8);

  const imageBlocks = samplePages
    .map((img) => {
      const b64 = readPageAsBase64(img.path);
      if (!b64) return null;
      return [
        { type: 'text', text: `--- Page ${img.pageNum} ---` },
        {
          type: 'image',
          source: { type: 'base64', media_type: 'image/png', data: b64 }
        }
      ];
    })
    .filter(Boolean)
    .flat();

  const userContent = [
    { type: 'text', text: `Filename: ${originalName || 'chapter.pdf'}` },
    { type: 'text', text: 'CHAPTER TEXT (full or truncated):' },
    { type: 'text', text: clampText(extractedText) },
    ...(imageBlocks.length ? [{ type: 'text', text: 'SAMPLE PAGE IMAGES (look for diagrams, figures, exam questions):' }, ...imageBlocks] : []),
    { type: 'text', text: 'Now produce the JSON lecture plan exactly per schema. JSON only.' }
  ];

  const response = await anthropic.messages.create({
    model: PLANNER_MODEL,
    max_tokens: 8000,
    system: PLANNER_SYSTEM_PROMPT,
    messages: [
      { role: 'user', content: userContent },
      { role: 'assistant', content: '{' }
    ]
  });

  const raw = '{' + (response.content[0]?.text || '');
  let plan;
  try {
    plan = JSON.parse(raw);
  } catch (err) {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('Planner returned invalid JSON: ' + err.message);
    plan = JSON.parse(match[0]);
  }

  if (!Array.isArray(plan.topics) || plan.topics.length === 0) {
    throw new Error('Planner produced no topics');
  }
  plan.topics.forEach((t, i) => {
    if (!t.id) t.id = `t${i + 1}`;
    if (typeof t.order !== 'number') t.order = i + 1;
  });
  if (!Array.isArray(plan.examQuestions)) plan.examQuestions = [];

  return plan;
}
