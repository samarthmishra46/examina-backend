import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createCanvas } from 'canvas';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PAGES_ROOT = path.join(__dirname, '../uploads/pages');

if (!fs.existsSync(PAGES_ROOT)) fs.mkdirSync(PAGES_ROOT, { recursive: true });

let pdfjs = null;
async function loadPdfjs() {
  if (pdfjs) return pdfjs;
  pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  return pdfjs;
}

class NodeCanvasFactory {
  create(width, height) {
    const canvas = createCanvas(width, height);
    return { canvas, context: canvas.getContext('2d') };
  }
  reset(canvasAndContext, width, height) {
    canvasAndContext.canvas.width = width;
    canvasAndContext.canvas.height = height;
  }
  destroy(canvasAndContext) {
    canvasAndContext.canvas.width = 0;
    canvasAndContext.canvas.height = 0;
    canvasAndContext.canvas = null;
    canvasAndContext.context = null;
  }
}

export async function rasterizePDF(filePath, pdfId, { maxPages = 60, scale = 1.6 } = {}) {
  const lib = await loadPdfjs();
  const data = new Uint8Array(fs.readFileSync(filePath));

  const outDir = path.join(PAGES_ROOT, String(pdfId));
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const loadingTask = lib.getDocument({
    data,
    canvasFactory: new NodeCanvasFactory(),
    disableFontFace: true,
    useSystemFonts: false,
    standardFontDataUrl: undefined,
    isEvalSupported: false
  });

  const doc = await loadingTask.promise;
  const totalPages = doc.numPages;
  const pageCount = Math.min(totalPages, maxPages);

  const pageImages = [];
  for (let pageNum = 1; pageNum <= pageCount; pageNum++) {
    try {
      const page = await doc.getPage(pageNum);
      const viewport = page.getViewport({ scale });
      const canvasFactory = new NodeCanvasFactory();
      const { canvas, context } = canvasFactory.create(viewport.width, viewport.height);

      await page.render({
        canvasContext: context,
        viewport,
        canvasFactory
      }).promise;

      const fileName = `page-${pageNum}.png`;
      const filePathOut = path.join(outDir, fileName);
      const buffer = canvas.toBuffer('image/png');
      fs.writeFileSync(filePathOut, buffer);

      pageImages.push({
        pageNum,
        path: filePathOut,
        url: `/uploads/pages/${pdfId}/${fileName}`,
        width: Math.round(viewport.width),
        height: Math.round(viewport.height)
      });

      page.cleanup();
    } catch (err) {
      console.error(`Failed to rasterize page ${pageNum}:`, err.message);
    }
  }

  await doc.destroy();
  return { pageImages, totalPages };
}

export function readPageAsBase64(pagePath) {
  if (!pagePath || !fs.existsSync(pagePath)) return null;
  return fs.readFileSync(pagePath).toString('base64');
}
