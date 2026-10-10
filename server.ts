import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import multer from 'multer';
import cors from 'cors';
import { SUPPORTED_IMAGE_TYPES, parseTraceOptions, renderPng, traceImage } from './trace-pipeline.js';

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

// Middleware
app.use(cors());
app.use(express.json());

// Set up Multer for handling file uploads in memory
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES },
  fileFilter: (_req, file, cb) => {
    if (!SUPPORTED_IMAGE_TYPES.has(file.mimetype)) {
      cb(new Error('Please upload a PNG, JPG, or WebP image.'));
      return;
    }
    cb(null, true);
  },
});
const uploadImage = upload.single('image');

function formatBytes(bytes: number) {
  return `${Math.round((bytes / 1024 / 1024) * 10) / 10}MB`;
}

// API Routes

// 1. Vectorize Endpoint
app.post('/api/vectorize', (req, res) => {
  uploadImage(req, res, async (uploadError: any) => {
    try {
      if (uploadError) {
        const isFileTooLarge =
          uploadError instanceof multer.MulterError && uploadError.code === 'LIMIT_FILE_SIZE';
        const error = isFileTooLarge
          ? `Image must be smaller than ${formatBytes(MAX_UPLOAD_BYTES)}.`
          : uploadError.message || 'Could not read the uploaded image.';

        return res.status(400).json({ error });
      }

      if (!req.file) {
        return res.status(400).json({ error: 'No image uploaded.' });
      }

      const options = parseTraceOptions(req.body ?? {});
      const { svg, stats } = await traceImage(req.file.buffer, options);
      res.json({ svg, engine: 'vtracer', stats });
    } catch (error: any) {
      console.error('Vectorization error:', error);
      res.status(500).json({
        error: 'Failed to vectorize image.',
        details: error.message,
      });
    }
  });
});

// 2. Large PNG export (see renderPng; mirrored by api/render-png.ts on Vercel)
app.post('/api/render-png', express.json({ limit: '20mb' }), async (req, res) => {
  const { svg, width } = req.body ?? {};
  if (typeof svg !== 'string' || !svg.includes('<svg') || !Number.isInteger(width) || width < 16 || width > 8000) {
    return res.status(400).json({ error: 'Send { svg, width } with a width between 16 and 8000.' });
  }
  try {
    res.type('png').send(await renderPng(svg, width));
  } catch (error: any) {
    console.error('PNG render error:', error);
    res.status(500).json({ error: 'Failed to render PNG.', details: error.message });
  }
});

// 3. Mock Stripe Checkout
app.post('/api/create-checkout-session', async (req, res) => {
  // In a real app, use the stripe SDK
  const { priceId } = req.body;
  console.log(`Mock checkout for price ${priceId}`);
  // We mock a success URL
  res.json({ url: `/dashboard?payment=success&price=${priceId}` });
});

app.post('/api/create-portal-session', async (req, res) => {
  res.json({ url: `/dashboard?portal=success` });
});

async function startServer() {
  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    // Use express version 4 compatible syntax (req, res)
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
