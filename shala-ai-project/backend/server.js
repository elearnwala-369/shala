/**
 * Shala AI Backend — E Learn Solutions
 * -------------------------------------
 * Handles:
 *  - PDF upload + text extraction + chunking (server-side, so it works from
 *    ANY browser/device, unlike client-side pdf.js which can be blocked in
 *    sandboxed webviews)
 *  - Keyword-based retrieval over stored chunks (swap for real vector search
 *    later if you move to a vector DB — see NOTES.md)
 *  - Calls the Anthropic API using a server-side API key (never exposed to
 *    the browser) to generate grounded, Marathi-first answers
 *
 * Storage: MongoDB (see lib/db.js) — chosen because Render's free tier has
 * no persistent disk, so anything written to the local filesystem is wiped
 * on every redeploy/restart. Documents, users, and offers all live in
 * MongoDB now, not in data/*.json files.
 *
 * Run locally:
 *    cp .env.example .env      # then add your real ANTHROPIC_API_KEY + MONGODB_URI
 *    npm install
 *    npm start
 *
 * Deploy: see DEPLOY.md
 */

const express = require('express');
const cors = require('cors');
const multer = require('multer');
const pdfParse = require('pdf-parse');
const Anthropic = require('@anthropic-ai/sdk');
const path = require('path');
require('dotenv').config();

const { connectDB, getDB } = require('./lib/db');
const store = require('./lib/store');
const { requireAuth, requireAdmin } = require('./lib/auth');

const app = express();
const PORT = process.env.PORT || 3000;

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

app.use(cors()); // tighten this to your app's domain once deployed — see DEPLOY.md
app.use(express.json({ limit: '2mb' }));
app.use('/admin', express.static(path.join(__dirname, 'public'))); // admin.html lives here

app.use('/api/auth', require('./routes/auth'));
app.use('/api/admin', require('./routes/admin'));

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 30 * 1024 * 1024 } }); // 30MB cap

// ---- Helpers ----
function chunkText(fullText, size = 1400, overlap = 150) {
  const chunks = [];
  let buf = '';
  const words = fullText.split(/\s+/);
  for (const w of words) {
    buf += (buf ? ' ' : '') + w;
    if (buf.length >= size) {
      chunks.push(buf);
      buf = buf.slice(-overlap);
    }
  }
  if (buf.trim()) chunks.push(buf);
  return chunks;
}

function tokenize(str) {
  return (str.toLowerCase().match(/[a-z0-9\u0900-\u097F]+/g) || []).filter(t => t.length > 1);
}
function scoreChunk(qTokens, text) {
  const lower = text.toLowerCase();
  let score = 0;
  for (const t of qTokens) {
    const re = new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
    const m = lower.match(re);
    if (m) score += m.length;
  }
  return score;
}

// Documents are stored in MongoDB as { id, name, classNum, medium, subject,
// pages, chunkCount, uploadedAt, chunks: [text, text, ...] }.
async function retrieveChunks({ classNum, subject, medium, query, k = 5 }) {
  const filter = { classNum: String(classNum), subject };
  if (medium) filter.medium = medium;
  const candidates = await getDB().collection('documents').find(filter).toArray();

  const qTokens = tokenize(query);
  let scored = [];
  for (const d of candidates) {
    (d.chunks || []).forEach((text, i) => {
      const s = scoreChunk(qTokens, text);
      if (s > 0) scored.push({ score: s, text, docName: d.name, chunkIndex: i });
    });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k);
}

// ---- Routes ----

app.get('/api/health', (req, res) => res.json({ ok: true }));

// List uploaded documents (metadata only, not the full chunk text — keeps this light)
app.get('/api/documents', async (req, res) => {
  try {
    const docs = await getDB().collection('documents')
      .find({}, { projection: { chunks: 0 } })
      .toArray();
    res.json(docs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Upload a PDF: fields classNum, medium, subject (multipart form) + file — admin only
app.post('/api/documents/upload', requireAdmin, upload.single('file'), async (req, res) => {
  try {
    const { classNum, medium, subject } = req.body;
    if (!classNum || !subject) {
      return res.status(400).json({ error: 'classNum आणि subject आवश्यक आहेत.' });
    }
    if (!req.file) return res.status(400).json({ error: 'PDF फाईल सापडली नाही.' });

    const parsed = await pdfParse(req.file.buffer);
    const chunks = chunkText(parsed.text);
    const id = 'doc_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);

    const doc = {
      id,
      name: req.file.originalname,
      classNum: String(classNum),
      medium: medium || 'Marathi',
      subject,
      pages: parsed.numpages,
      chunkCount: chunks.length,
      uploadedAt: new Date().toISOString(),
      chunks
    };
    await getDB().collection('documents').insertOne(doc);

    res.json({ ok: true, id, pages: parsed.numpages, chunkCount: chunks.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'PDF प्रक्रिया करताना चूक झाली: ' + err.message });
  }
});

// Delete a document — admin only
app.delete('/api/documents/:id', requireAdmin, async (req, res) => {
  try {
    await getDB().collection('documents').deleteOne({ id: req.params.id });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Ask a question — retrieves context server-side, calls Claude, returns answer + sources
app.post('/api/ask', requireAuth, async (req, res) => {
  try {
    const user = await store.findUserById(req.userId);
    if (!user) return res.status(404).json({ error: 'वापरकर्ता सापडला नाही.' });
    if (!store.userHasAccess(user)) {
      return res.status(403).json({
        error: user.status === 'inactive'
          ? 'तुमचं खातं निष्क्रिय केलेलं आहे. कृपया E Learn Solutions शी संपर्क साधा.'
          : 'तुमचा demo कालावधी संपला आहे. सुरू ठेवण्यासाठी subscription घ्या.',
        accessDenied: true
      });
    }

    const { classNum, subject, medium, question, systemHint } = req.body;
    if (!question) return res.status(400).json({ error: 'question आवश्यक आहे.' });

    const top = await retrieveChunks({ classNum, subject, medium, query: question, k: 5 });

    let prompt = question;
    if (top.length) {
      const context = top.map((c, i) => `[संदर्भ ${i + 1} — ${c.docName}]\n${c.text}`).join('\n\n---\n\n');
      prompt = `खालील संदर्भ परिच्छेद अपलोड केलेल्या पाठ्यपुस्तकातून घेतलेले आहेत. शक्य असल्यास उत्तर या संदर्भावर आधारित द्या; संदर्भात माहिती नसल्यास सामान्य ज्ञानाचा वापर करून उत्तर द्या, पण संदर्भाशी विसंगत उत्तर देऊ नका.\n\n${context}\n\n---\n\n${systemHint ? systemHint + '\n\n' : ''}प्रश्न: ${question}`;
    } else if (systemHint) {
      prompt = `${systemHint}\n\nप्रश्न: ${question}`;
    }

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1200,
      messages: [{ role: 'user', content: prompt }]
    });

    const answer = response.content.map(b => b.type === 'text' ? b.text : '').join('\n').trim();

    res.json({
      answer,
      sources: top.map(c => ({ docName: c.docName }))
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'उत्तर तयार करताना चूक झाली: ' + err.message });
  }
});

// Connect to MongoDB first, THEN start listening — so no request can arrive
// before the DB is ready (avoids the "Database not connected yet" error).
connectDB()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Shala AI backend running on port ${PORT}`);
    });
  })
  .catch(err => {
    console.error('Failed to connect to MongoDB — check MONGODB_URI:', err.message);
    process.exit(1);
  });
