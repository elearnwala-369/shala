/**
 * lib/db.js — MongoDB connection.
 *
 * Replaces the earlier JSON-file storage (data/*.json) so uploaded
 * documents, users, and offers survive redeploys — Render's free tier has
 * no persistent disk, so anything written to the local filesystem is wiped
 * every time the service restarts or redeploys.
 *
 * Uses MongoDB Atlas's free tier (M0 cluster) — see DEPLOY.md for setup.
 */
const { MongoClient } = require('mongodb');

let client = null;
let db = null;

async function connectDB() {
  if (db) return db;
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error('MONGODB_URI environment variable is not set — see DEPLOY.md to set up MongoDB Atlas.');
  }
  client = new MongoClient(uri);
  await client.connect();
  // Uses MONGODB_DB_NAME if set, otherwise defaults to "shala-ai".
  // (Most Atlas connection strings don't include a database name in the URI.)
  db = client.db(process.env.MONGODB_DB_NAME || 'shala-ai');
  console.log('Connected to MongoDB');

  // Helpful indexes — safe to run every startup, MongoDB no-ops if they already exist.
  await db.collection('users').createIndex({ phone: 1 }, { unique: true });
  await db.collection('users').createIndex({ id: 1 }, { unique: true });
  await db.collection('documents').createIndex({ id: 1 }, { unique: true });
  await db.collection('documents').createIndex({ classNum: 1, subject: 1, medium: 1 });
  await db.collection('offers').createIndex({ id: 1 }, { unique: true });

  return db;
}

function getDB() {
  if (!db) throw new Error('Database not connected yet — connectDB() must be called and awaited before use.');
  return db;
}

module.exports = { connectDB, getDB };
