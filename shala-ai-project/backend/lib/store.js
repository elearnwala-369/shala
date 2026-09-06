/**
 * lib/store.js — minimal JSON-file persistence for users & offers.
 *
 * This is intentionally simple (no external database) to match the rest of
 * this MVP backend. See NOTES.md — once you have real signups, migrate this
 * to Postgres/SQLite so data survives redeploys on platforms without a
 * persistent disk (e.g. Render free tier).
 */
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const OFFERS_FILE = path.join(DATA_DIR, 'offers.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, '[]');
if (!fs.existsSync(OFFERS_FILE)) fs.writeFileSync(OFFERS_FILE, '[]');

function readJSON(file) {
  return JSON.parse(fs.readFileSync(file, 'utf-8'));
}
function writeJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

// ---- Users ----
function getUsers() {
  return readJSON(USERS_FILE);
}
function saveUsers(users) {
  writeJSON(USERS_FILE, users);
}
function findUserByPhone(phone) {
  return getUsers().find(u => u.phone === phone);
}
function findUserById(id) {
  return getUsers().find(u => u.id === id);
}
function createUser({ phone, name = '', school = '' }) {
  const users = getUsers();
  const now = new Date();
  const demoExpires = new Date(now);
  demoExpires.setDate(demoExpires.getDate() + 7); // 7-day free demo by default

  const user = {
    id: 'user_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
    phone,
    name,
    school,
    status: 'demo', // 'demo' | 'active' | 'inactive'
    demoExpiresAt: demoExpires.toISOString(),
    subscriptionExpiresAt: null,
    offerCode: null,
    createdAt: now.toISOString(),
    lastLoginAt: now.toISOString()
  };
  users.push(user);
  saveUsers(users);
  return user;
}
function updateUser(id, patch) {
  const users = getUsers();
  const idx = users.findIndex(u => u.id === id);
  if (idx === -1) return null;
  users[idx] = { ...users[idx], ...patch };
  saveUsers(users);
  return users[idx];
}
function touchLogin(id) {
  return updateUser(id, { lastLoginAt: new Date().toISOString() });
}

// Effective access check: active subscription, or within demo window
function userHasAccess(user) {
  if (!user) return false;
  if (user.status === 'inactive') return false;
  if (user.status === 'active') {
    if (!user.subscriptionExpiresAt) return true; // active, no expiry set = unlimited
    return new Date(user.subscriptionExpiresAt) > new Date();
  }
  if (user.status === 'demo') {
    return user.demoExpiresAt && new Date(user.demoExpiresAt) > new Date();
  }
  return false;
}

// ---- Offers ----
function getOffers() {
  return readJSON(OFFERS_FILE);
}
function saveOffers(offers) {
  writeJSON(OFFERS_FILE, offers);
}
function createOffer({ code, description, discountPercent, expiresAt }) {
  const offers = getOffers();
  const offer = {
    id: 'offer_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
    code: code.toUpperCase(),
    description: description || '',
    discountPercent: discountPercent || 0,
    expiresAt: expiresAt || null,
    active: true,
    createdAt: new Date().toISOString()
  };
  offers.push(offer);
  saveOffers(offers);
  return offer;
}
function deleteOffer(id) {
  const offers = getOffers().filter(o => o.id !== id);
  saveOffers(offers);
}
function setOfferActive(id, active) {
  const offers = getOffers();
  const idx = offers.findIndex(o => o.id === id);
  if (idx === -1) return null;
  offers[idx].active = active;
  saveOffers(offers);
  return offers[idx];
}

module.exports = {
  getUsers, saveUsers, findUserByPhone, findUserById, createUser, updateUser, touchLogin, userHasAccess,
  getOffers, saveOffers, createOffer, deleteOffer, setOfferActive
};