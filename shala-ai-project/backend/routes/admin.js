const express = require('express');
const router = express.Router();
const store = require('../lib/store');
const { requireAdmin } = require('../lib/auth');
const fs = require('fs');
const path = require('path');

router.use(requireAdmin);

// ---- Dashboard stats ----
router.get('/stats', (req, res) => {
  const users = store.getUsers();
  const idxFile = path.join(__dirname, '..', 'data', 'doc-index.json');
  const docs = fs.existsSync(idxFile) ? JSON.parse(fs.readFileSync(idxFile, 'utf-8')) : [];
  res.json({
    totalUsers: users.length,
    active: users.filter(u => u.status === 'active').length,
    demo: users.filter(u => u.status === 'demo').length,
    inactive: users.filter(u => u.status === 'inactive').length,
    totalDocuments: docs.length
  });
});

// ---- Users ----
router.get('/users', (req, res) => {
  const { q, status } = req.query;
  let users = store.getUsers();
  if (status) users = users.filter(u => u.status === status);
  if (q) {
    const needle = q.toLowerCase();
    users = users.filter(u =>
      u.phone.includes(needle) ||
      (u.name || '').toLowerCase().includes(needle) ||
      (u.school || '').toLowerCase().includes(needle)
    );
  }
  users.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json(users.map(u => ({ ...u, hasAccess: store.userHasAccess(u) })));
});

router.post('/users/:id/activate', (req, res) => {
  const { subscriptionDays } = req.body; // optional — omit for unlimited
  const patch = { status: 'active' };
  if (subscriptionDays) {
    const d = new Date();
    d.setDate(d.getDate() + Number(subscriptionDays));
    patch.subscriptionExpiresAt = d.toISOString();
  } else {
    patch.subscriptionExpiresAt = null;
  }
  const user = store.updateUser(req.params.id, patch);
  if (!user) return res.status(404).json({ error: 'वापरकर्ता सापडला नाही.' });
  res.json({ ok: true, user });
});

router.post('/users/:id/deactivate', (req, res) => {
  const user = store.updateUser(req.params.id, { status: 'inactive' });
  if (!user) return res.status(404).json({ error: 'वापरकर्ता सापडला नाही.' });
  res.json({ ok: true, user });
});

router.post('/users/:id/extend-demo', (req, res) => {
  const { days = 7 } = req.body;
  const d = new Date();
  d.setDate(d.getDate() + Number(days));
  const user = store.updateUser(req.params.id, { status: 'demo', demoExpiresAt: d.toISOString() });
  if (!user) return res.status(404).json({ error: 'वापरकर्ता सापडला नाही.' });
  res.json({ ok: true, user });
});

router.patch('/users/:id', (req, res) => {
  const { name, school } = req.body;
  const patch = {};
  if (name !== undefined) patch.name = name;
  if (school !== undefined) patch.school = school;
  const user = store.updateUser(req.params.id, patch);
  if (!user) return res.status(404).json({ error: 'वापरकर्ता सापडला नाही.' });
  res.json({ ok: true, user });
});

// ---- Offers ----
router.get('/offers', (req, res) => {
  res.json(store.getOffers());
});
router.post('/offers', (req, res) => {
  const { code, description, discountPercent, expiresAt } = req.body;
  if (!code) return res.status(400).json({ error: 'code आवश्यक आहे.' });
  const offer = store.createOffer({ code, description, discountPercent, expiresAt });
  res.json({ ok: true, offer });
});
router.post('/offers/:id/toggle', (req, res) => {
  const { active } = req.body;
  const offer = store.setOfferActive(req.params.id, !!active);
  if (!offer) return res.status(404).json({ error: 'ऑफर सापडली नाही.' });
  res.json({ ok: true, offer });
});
router.delete('/offers/:id', (req, res) => {
  store.deleteOffer(req.params.id);
  res.json({ ok: true });
});

module.exports = router;