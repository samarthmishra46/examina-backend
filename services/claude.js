import Anthropic from '@anthropic-ai/sdk';
import { readPageAsBase64 } from './pdfRasterizer.js';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function attachVisionToLastUser(messages, visionImages) {
  if (!visionImages?.length) return messages;
  const out = messages.map((m) => ({ ...m }));
  for (let i = out.length - 1; i >= 0; i--) {
    if (out[i].role === 'user') {
      const blocks = [];
      const original = out[i].content;
      if (typeof original === 'string') blocks.push({ type: 'text', text: original });
      else if (Array.isArray(original)) blocks.push(...original);

      for (const img of visionImages) {
        const b64 = readPageAsBase64(img.path);
        if (!b64) continue;
        blocks.push({ type: 'text', text: `[Page ${img.pageNum}]` });
        blocks.push({
          type: 'image',
          source: { type: 'base64', media_type: 'image/png', data: b64 }
        });
      }
      out[i].content = blocks;
      break;
    }
  }
  return out;
}

export async function streamTutorResponse({ systemPrompt, messages, socket, sessionId, isQuickDoubt, visionImages }) {
  const model = isQuickDoubt ? 'claude-haiku-4-5-20251001' : 'claude-sonnet-4-20250514';

  const withVision = attachVisionToLastUser(messages, visionImages);
  const messagesWithPrefill = [
    ...withVision,
    { role: 'assistant', content: '{' }
  ];

  let fullResponse = '{';

  try {
    const stream = anthropic.messages.stream({
      model,
      max_tokens: 1500,
      system: systemPrompt,
      messages: messagesWithPrefill
    });

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
        const delta = event.delta.text;
        fullResponse += delta;
        socket.emit('token', { delta, sessionId });
      }
    }

    try {
      const parsed = JSON.parse(fullResponse);
      socket.emit('ai_response', { ...parsed, sessionId });
      return parsed;
    } catch (parseErr) {
      console.error('JSON parse failed:', parseErr.message, '\nRaw:', fullResponse.slice(0, 200));
      socket.emit('ai_error', { message: 'Response parsing failed', sessionId });
      return {
        scenes: [{ text: 'Let me rephrase that.', draw: [] }],
        teacherEmotion: 'thinking',
        nextStep: ''
      };
    }
  } catch (err) {
    console.error('Stream error:', err);
    socket.emit('ai_error', { message: 'AI service error: ' + err.message, sessionId });
    return {
      scenes: [{ text: 'I encountered an error. Please try again.', draw: [] }],
      teacherEmotion: 'concerned',
      nextStep: ''
    };
  }
}

export async function generateSessionSummary(messages) {
  try {
    const history = messages
      .slice(-20)
      .map((m) => `${m.role === 'user' ? 'Student' : 'Teacher'}: ${m.content}`)
      .join('\n');

    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      messages: [
        {
          role: 'user',
          content: `Summarize this tutoring session in 2-3 sentences. Focus on what was taught and what the student understood:\n\n${history}`
        }
      ]
    });

    return response.content[0].text;
  } catch (err) {
    console.error('Summary error:', err);
    return 'Session completed.';
  }
}
