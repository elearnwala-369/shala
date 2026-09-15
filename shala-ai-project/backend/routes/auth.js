const express = require('express');
const router = express.Router();
const store = require('../lib/store');
const otp = require('../lib/otp');
const sms = require('../lib/sms');
const { signUserToken, signAdminToken, requireAuth } = require('../lib/auth');

const PHONE_RE = /^[6-9]\d{9}$/; // Indian 10-digit mobile numbers

// ---- User OTP login ----
router.post('/send-otp', async (req, res) => {
  const { phone } = req.body;
  if (!phone || !PHONE_RE.test(phone)) {
    return res.status(400).json({ error: 'वैध १०-अंकी मोबाईल नंबर टाका.' });
  }
  const code = otp.generateOTP(phone);
  try {
    await sms.sendOTP(phone, code);
  } catch (e) {
    return res.status(500).json({ error: 'OTP पाठवता आले नाही: ' + e.message });
  }
  const devMode = process.env.NODE_ENV !== 'production' || process.env.DEV_OTP_VISIBLE === 'true';
  res.json({ ok: true, ...(devMode ? { devOtp: code } : {}) });
});

router.post('/verify-otp', async (req, res) => {
  console.log('[verify-otp] request received:', JSON.stringify(req.body));
  try {
    const { phone, otp: submitted, name, school } = req.body;
    if (!phone || !submitted) {
      console.log('[verify-otp] missing phone or otp');
      return res.status(400).json({ error: 'phone आणि otp आवश्यक आहेत.' });
    }

    const result = otp.verifyOTP(phone, submitted);
    console.log('[verify-otp] otp.verifyOTP result:', JSON.stringify(result));
    if (!result.ok) return res.status(400).json({ error: result.error });

    let user = await store.findUserByPhone(phone);
    console.log('[verify-otp] existing user found?', !!user);
    if (!user) {
      user = await store.createUser({ phone, name: name || '', school: school || '' });
      console.log('[verify-otp] created new user:', JSON.stringify(user));
    } else {
      user = await store.touchLogin(user.id);
      console.log('[verify-otp] touched login for existing user:', JSON.stringify(user));
    }

    const access = store.userHasAccess(user);
    console.log('[verify-otp] hasAccess:', access, 'user.status:', user && user.status, 'demoExpiresAt:', user && user.demoExpiresAt);

    const token = signUserToken(user);
    res.json({ ok: true, token, user, hasAccess: access });
  } catch (err) {
    console.error('[verify-otp] ERROR:', err);
    res.status(500).json({ error: 'लॉगिन करताना चूक झाली: ' + err.message });
  }
});

router.get('/me', requireAuth, async (req, res) => {
  try {
    const user = await store.findUserById(req.userId);
    if (!user) return res.status(404).json({ error: 'वापरकर्ता सापडला नाही.' });
    res.json({ user, hasAccess: store.userHasAccess(user) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---- Admin login ----
router.post('/admin-login', (req, res) => {
  const { username, password } = req.body;
  const okUser = username === process.env.ADMIN_USERNAME;
  const okPass = password === process.env.ADMIN_PASSWORD;
  if (!okUser || !okPass) {
    return res.status(401).json({ error: 'चुकीचा username किंवा password.' });
  }
  res.json({ ok: true, token: signAdminToken() });
});

module.exports = router;
