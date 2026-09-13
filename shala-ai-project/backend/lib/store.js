/**
 * lib/store.js — users & offers, backed by MongoDB (see lib/db.js).
 *
 * Every function here is now async (it wasn't before, when it read local
 * JSON files) — callers must await these.
 */
const { getDB } = require('./db');

// ---- Users ----
async function getUsers() {
  return getDB().collection('users').find({}).toArray();
}
async function findUserByPhone(phone) {
  return getDB().collection('users').findOne({ phone });
}
async function findUserById(id) {
  return getDB().collection('users').findOne({ id });
}
async function createUser({ phone, name = '', school = '' }) {
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
  await getDB().collection('users').insertOne(user);
  return user;
}
async function updateUser(id, patch) {
  const result = await getDB().collection('users').findOneAndUpdate(
    { id },
    { $set: patch },
    { returnDocument: 'after' }
  );
  return result && result.value ? result.value : result; // driver-version-safe
}
async function touchLogin(id) {
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
async function getOffers() {
  return getDB().collection('offers').find({}).toArray();
}
async function createOffer({ code, description, discountPercent, expiresAt }) {
  const offer = {
    id: 'offer_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
    code: code.toUpperCase(),
    description: description || '',
    discountPercent: discountPercent || 0,
    expiresAt: expiresAt || null,
    active: true,
    createdAt: new Date().toISOString()
  };
  await getDB().collection('offers').insertOne(offer);
  return offer;
}
async function deleteOffer(id) {
  await getDB().collection('offers').deleteOne({ id });
}
async function setOfferActive(id, active) {
  const result = await getDB().collection('offers').findOneAndUpdate(
    { id },
    { $set: { active } },
    { returnDocument: 'after' }
  );
  return result && result.value ? result.value : result;
}

module.exports = {
  getUsers, findUserByPhone, findUserById, createUser, updateUser, touchLogin, userHasAccess,
  getOffers, createOffer, deleteOffer, setOfferActive
};
