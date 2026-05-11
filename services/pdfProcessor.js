import fs from 'fs';
import pdfParse from 'pdf-parse/lib/pdf-parse.js';
import PDF from '../models/PDF.js';
import { generateEmbedding } from './embeddings.js';
import { rasterizePDF } from './pdfRasterizer.js';
import { generateLecturePlan } from './lecturePlanner.js';

function chunkText(text, chunkSize = 500, overlap = 50) {
  const words = text.split(/\s+/).filter(Boolean);
  const chunks = [];
  let i = 0;
  while (i < words.length) {
    const chunk = words.slice(i, i + chunkSize).join(' ');
    chunks.push(chunk);
    i += chunkSize - overlap;
  }
  return chunks;
}

async function buildPlanInBackground(pdfId) {
  try {
    let pdf = await PDF.findById(pdfId);
    if (!pdf) return;

    pdf.planStatus = 'rasterizing';
    await pdf.save();

    const { pageImages, totalPages } = await rasterizePDF(pdf.filePath, pdfId.toString());
    pdf.pageImages = pageImages;
    pdf.pageCount = totalPages;
    pdf.planStatus = 'planning';
    await pdf.save();

    const plan = await generateLecturePlan({
      extractedText: pdf.extractedText,
      pageImages,
      originalName: pdf.originalName
    });

    pdf.lecturePlan = plan;
    pdf.planStatus = 'ready';
    pdf.planError = undefined;
    await pdf.save();
    console.log(`[planner] PDF ${pdfId} plan ready: "${plan.chapterTitle}" with ${plan.topics?.length || 0} topics`);
  } catch (err) {
    console.error(`[planner] PDF ${pdfId} failed:`, err.message);
    try {
      await PDF.findByIdAndUpdate(pdfId, {
        planStatus: 'failed',
        planError: err.message
      });
    } catch {}
  }
}

export async function processPDF(filePath, userId, originalName) {
  const buffer = fs.readFileSync(filePath);
  const data = await pdfParse(buffer);
  const extractedText = data.text;

  const rawChunks = chunkText(extractedText);

  const chunks = await Promise.all(
    rawChunks.map(async (text, idx) => {
      const embedding = await generateEmbedding(text);
      return { text, embedding, chunkIndex: idx };
    })
  );

  const pdf = await PDF.create({
    userId,
    fileName: originalName.replace(/[^a-zA-Z0-9.-]/g, '_'),
    originalName,
    filePath,
    extractedText,
    chunks,
    planStatus: 'pending'
  });

  buildPlanInBackground(pdf._id);

  return pdf;
}

export { buildPlanInBackground };
