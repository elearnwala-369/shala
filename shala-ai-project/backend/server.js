/**
 * Shala AI Backend — E Learn Solutions
 * -------------------------------------
 * Handles:
 *  - PDF upload + text extraction + chunking (server-side, so it works from
 *    ANY browser/device, unlike client-side pdf.js which can be blocked in
 *    sandboxed webviews)
 *  - Keyword-based retrieval over stored chunks (swap for real vector search
 *    later if you move to Pinecone/ChromaDB — see NOTES.md)
 *  - Calls the Anthropic API using a server-side API key (never exposed to
 *    the browser) to generate grounded, Marathi-first answers
 *
 * Run locally:
 *    cp .env.example .env      # then add your real ANTHROPIC_API_KEY
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
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const store = require('./lib/store');
const { requireAuth, requireAdmin } = require('./lib/auth');

const app = express();
const PORT = process.env.PORT || 3000;

// ---- Config ----
const DATA_DIR = path.join(__dirname, 'data');
const CHUNKS_DIR = path.join(DATA_DIR, 'chunks');
const INDEX_FILE = path.join(DATA_DIR, 'doc-index.json');
if (!fs.existsSync(CHUNKS_DIR)) fs.mkdirSync(CHUNKS_DIR, { recursive: true });
if (!fs.existsSync(INDEX_FILE)) fs.writeFileSync(INDEX_FILE, '[]');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

app.use(cors()); // tighten this to your app's domain once deployed — see DEPLOY.md
app.use(express.json({ limit: '2mb' }));
app.use('/admin', express.static(path.join(__dirname, 'public'))); // admin.html lives here

app.use('/api/auth', require('./routes/auth'));
app.use('/api/admin', require('./routes/admin'));

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 30 * 1024 * 1024 } }); // 30MB cap

// ---- Helpers ----
function readIndex() {
  function readIndex() {
  try {
    const raw = fs.readFileSync(INDEX_FILE, 'utf-8').trim();
    if (!raw) throw new Error('empty');
    return JSON.parse(raw);
  } catch (e) {
    fs.writeFileSync(INDEX_FILE, '[]');
    return [];
  }
}
function writeIndex(idx) {
  fs.writeFileSync(INDEX_FILE, JSON.stringify(idx, null, 2));
}

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

function retrieveChunks({ classNum, subject, medium, query, k = 5 }) {
  const idx = readIndex();
  const candidates = idx.filter(d =>
    String(d.classNum) === String(classNum) &&
    d.subject === subject &&
    (!medium || d.medium === medium)
  );
  const qTokens = tokenize(query);
  let scored = [];
  for (const d of candidates) {
    const chunkFile = path.join(CHUNKS_DIR, `${d.id}.json`);
    if (!fs.existsSync(chunkFile)) continue;
    const chunks = JSON.parse(fs.readFileSync(chunkFile, 'utf-8'));
    chunks.forEach((text, i) => {
      const s = scoreChunk(qTokens, text);
      if (s > 0) scored.push({ score: s, text, docName: d.name, chunkIndex: i });
    });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k);
}

// ---- Routes ----

app.get('/api/health', (req, res) => res.json({ ok: true }));

// List uploaded documents
app.get('/api/documents', (req, res) => {
  res.json(readIndex());
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

    fs.writeFileSync(path.join(CHUNKS_DIR, `${id}.json`), JSON.stringify(chunks));

    const idx = readIndex();
    idx.push({
      id,
      name: req.file.originalname,
      classNum,
      medium: medium || 'Marathi',
      subject,
      pages: parsed.numpages,
      chunkCount: chunks.length,
      uploadedAt: new Date().toISOString()
    });
    writeIndex(idx);

    res.json({ ok: true, id, pages: parsed.numpages, chunkCount: chunks.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'PDF प्रक्रिया करताना चूक झाली: ' + err.message });
  }
});

// Delete a document — admin only
app.delete('/api/documents/:id', requireAdmin, (req, res) => {
  const { id } = req.params;
  let idx = readIndex();
  idx = idx.filter(d => d.id !== id);
  writeIndex(idx);
  const f = path.join(CHUNKS_DIR, `${id}.json`);
  if (fs.existsSync(f)) fs.unlinkSync(f);
  res.json({ ok: true });
});

// Ask a question — retrieves context server-side, calls Claude, returns answer + sources
app.post('/api/ask', requireAuth, async (req, res) => {
  try {
    const user = store.findUserById(req.userId);
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

    const top = retrieveChunks({ classNum, subject, medium, query: question, k: 5 });

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

app.listen(PORT, () => {
  console.log(`Shala AI backend running on port ${PORT}`);
});
