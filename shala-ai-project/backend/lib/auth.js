/**
 * lib/auth.js — JWT session tokens for two audiences: regular users
 * (phone/OTP login) and the admin panel (username/password login).
 */
const jwt = require('jsonwebtoken');

const SECRET = process.env.JWT_SECRET || 'dev-secret-CHANGE-THIS-in-production';
const USER_TOKEN_TTL = '30d';
const ADMIN_TOKEN_TTL = '12h';

function signUserToken(user) {
  return jwt.sign({ type: 'user', id: user.id, phone: user.phone }, SECRET, { expiresIn: USER_TOKEN_TTL });
}
function signAdminToken() {
  return jwt.sign({ type: 'admin' }, SECRET, { expiresIn: ADMIN_TOKEN_TTL });
}

function getBearerToken(req) {
  const h = req.headers.authorization || '';
  return h.startsWith('Bearer ') ? h.slice(7) : null;
}

function requireAuth(req, res, next) {
  const token = getBearerToken(req);
  if (!token) return res.status(401).json({ error: 'लॉगिन आवश्यक आहे.' });
  try {
    const payload = jwt.verify(token, SECRET);
    if (payload.type !== 'user') throw new Error('wrong token type');
    req.userId = payload.id;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'सत्र कालबाह्य झाले आहे, पुन्हा लॉगिन करा.' });
  }
}

function requireAdmin(req, res, next) {
  const token = getBearerToken(req);
  if (!token) return res.status(401).json({ error: 'Admin login आवश्यक आहे.' });
  try {
    const payload = jwt.verify(token, SECRET);
    if (payload.type !== 'admin') throw new Error('wrong token type');
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Admin सत्र कालबाह्य झाले आहे.' });
  }
}

module.exports = { signUserToken, signAdminToken, requireAuth, requireAdmin };