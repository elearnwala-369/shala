/**
 * lib/sms.js — pluggable OTP delivery.
 *
 * By default this just logs the OTP to the server console, so you can test
 * the whole login flow before you have an SMS gateway account. When you're
 * ready to send real SMS in India, the two easiest options are MSG91 and
 * Fast2SMS (both have simple REST APIs and support DLT-registered OTP
 * templates, which is a legal requirement in India for transactional SMS).
 *
 * To go live: sign up, get an API key + registered OTP template, then
 * replace the body of sendOTP() below with the real API call (examples
 * commented below). Nothing else in the app needs to change.
 */

async function sendOTP(phone, otp) {
  // ---- DEV MODE (default): just log it ----
  console.log(`[OTP] ${phone} -> ${otp}  (SMS gateway not configured — see lib/sms.js)`);

  // ---- MSG91 example (uncomment + fill in once you have an account) ----
  // const res = await fetch('https://control.msg91.com/api/v5/otp', {
  //   method: 'POST',
  //   headers: { 'Content-Type': 'application/json', 'authkey': process.env.MSG91_AUTH_KEY },
  //   body: JSON.stringify({
  //     mobile: '91' + phone,
  //     template_id: process.env.MSG91_TEMPLATE_ID,
  //     otp
  //   })
  // });
  // if (!res.ok) throw new Error('MSG91 send failed: ' + (await res.text()));

  // ---- Fast2SMS example ----
  // const res = await fetch('https://www.fast2sms.com/dev/bulkV2', {
  //   method: 'POST',
  //   headers: { authorization: process.env.FAST2SMS_API_KEY, 'Content-Type': 'application/json' },
  //   body: JSON.stringify({ route: 'otp', variables_values: otp, numbers: phone })
  // });
  // if (!res.ok) throw new Error('Fast2SMS send failed: ' + (await res.text()));

  return true;
}

module.exports = { sendOTP };