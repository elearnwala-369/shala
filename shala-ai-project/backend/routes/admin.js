const express = require('express');
const router = express.Router();
const store = require('../lib/store');
const { requireAdmin } = require('../lib/auth');
const { getDB } = require('../lib/db');

router.use(requireAdmin);

// ---- Dashboard stats ----
router.get('/stats', async (req, res) => {
  try {
    const users = await store.getUsers();
    const totalDocuments = await getDB().collection('documents').countDocuments();
    res.json({
      totalUsers: users.length,
      active: users.filter(u => u.status === 'active').length,
      demo: users.filter(u => u.status === 'demo').length,
      inactive: users.filter(u => u.status === 'inactive').length,
      totalDocuments
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---- Users ----
router.get('/users', async (req, res) => {
  try {
    const { q, status } = req.query;
    let users = await store.getUsers();
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
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/users/:id/activate', async (req, res) => {
  try {
    const { subscriptionDays } = req.body; // optional — omit for unlimited
    const patch = { status: 'active' };
    if (subscriptionDays) {
      const d = new Date();
      d.setDate(d.getDate() + Number(subscriptionDays));
      patch.subscriptionExpiresAt = d.toISOString();
    } else {
      patch.subscriptionExpiresAt = null;
    }
    const user = await store.updateUser(req.params.id, patch);
    if (!user) return res.status(404).json({ error: 'वापरकर्ता सापडला नाही.' });
    res.json({ ok: true, user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/users/:id/deactivate', async (req, res) => {
  try {
    const user = await store.updateUser(req.params.id, { status: 'inactive' });
    if (!user) return res.status(404).json({ error: 'वापरकर्ता सापडला नाही.' });
    res.json({ ok: true, user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/users/:id/extend-demo', async (req, res) => {
  try {
    const { days = 7 } = req.body;
    const d = new Date();
    d.setDate(d.getDate() + Number(days));
    const user = await store.updateUser(req.params.id, { status: 'demo', demoExpiresAt: d.toISOString() });
    if (!user) return res.status(404).json({ error: 'वापरकर्ता सापडला नाही.' });
    res.json({ ok: true, user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/users/:id', async (req, res) => {
  try {
    const { name, school } = req.body;
    const patch = {};
    if (name !== undefined) patch.name = name;
    if (school !== undefined) patch.school = school;
    const user = await store.updateUser(req.params.id, patch);
    if (!user) return res.status(404).json({ error: 'वापरकर्ता सापडला नाही.' });
    res.json({ ok: true, user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---- Offers ----
router.get('/offers', async (req, res) => {
  try {
    res.json(await store.getOffers());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
router.post('/offers', async (req, res) => {
  try {
    const { code, description, discountPercent, expiresAt } = req.body;
    if (!code) return res.status(400).json({ error: 'code आवश्यक आहे.' });
    const offer = await store.createOffer({ code, description, discountPercent, expiresAt });
    res.json({ ok: true, offer });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
router.post('/offers/:id/toggle', async (req, res) => {
  try {
    const { active } = req.body;
    const offer = await store.setOfferActive(req.params.id, !!active);
    if (!offer) return res.status(404).json({ error: 'ऑफर सापडली नाही.' });
    res.json({ ok: true, offer });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
router.delete('/offers/:id', async (req, res) => {
  try {
    await store.deleteOffer(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
