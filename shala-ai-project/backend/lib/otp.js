/**
 * lib/otp.js — short-lived in-memory OTP store.
 * OTPs expire in 5 minutes and allow 5 verify attempts before being invalidated.
 * In-memory is fine here (OTPs are meant to be short-lived) even though it
 * resets on server restart — that's harmless, the user just requests a new one.
 */
const crypto = require('crypto');

const OTP_TTL_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const store = new Map(); // phone -> { otp, expiresAt, attempts }

function generateOTP(phone) {
  const otp = String(crypto.randomInt(100000, 999999));
  store.set(phone, { otp, expiresAt: Date.now() + OTP_TTL_MS, attempts: 0 });
  return otp;
}

function verifyOTP(phone, submitted) {
  const entry = store.get(phone);
  if (!entry) return { ok: false, error: 'OTP मागवलेला नाही किंवा कालबाह्य झाला आहे.' };
  if (Date.now() > entry.expiresAt) {
    store.delete(phone);
    return { ok: false, error: 'OTP कालबाह्य झाला आहे. पुन्हा मागवा.' };
  }
  entry.attempts += 1;
  if (entry.attempts > MAX_ATTEMPTS) {
    store.delete(phone);
    return { ok: false, error: 'खूप चुकीचे प्रयत्न झाले. पुन्हा OTP मागवा.' };
  }
  if (entry.otp !== String(submitted)) {
    return { ok: false, error: 'चुकीचा OTP.' };
  }
  store.delete(phone);
  return { ok: true };
}

module.exports = { generateOTP, verifyOTP };