const twilio = require('twilio');

function formatPhoneNumber(phone) {
  if (!phone) return phone;
  let clean = phone.toString().replace(/[\s\-\(\)]/g, '');
  if (/^\d{10}$/.test(clean)) {
    clean = '+91' + clean;
  } else if (/^0\d{10}$/.test(clean)) {
    clean = '+91' + clean.slice(1);
  } else if (!clean.startsWith('+') && clean.length > 0) {
    clean = '+' + clean;
  }
  return clean;
}

const hasSmsConfig = !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_PHONE_NUMBER);

let client;
if (hasSmsConfig) {
  try {
    client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  } catch (e) {
    console.error('Twilio initialization error:', e.message);
  }
}

async function sendVerificationSMS(rawTo, otp) {
  const to = formatPhoneNumber(rawTo);
  
  if (!hasSmsConfig || !client) {
    console.log('====================================================');
    console.log('📱 [VELORA OTP DISPATCH]');
    console.log(`📱 Recipient Phone: ${to} (Original: ${rawTo})`);
    console.log(`🔑 6-Digit OTP Code: ${otp}`);
    console.log(`💬 Message: Your Velora verification code is ${otp}. Valid for 15 minutes.`);
    console.log('ℹ️ (To send actual SMS to phones, add TWILIO credentials in .env)');
    console.log('====================================================');
    return { success: true, mock: true, otp };
  }

  try {
    const message = await client.messages.create({
      body: `Your Velora verification code is ${otp}. Valid for 15 minutes.`,
      from: process.env.TWILIO_PHONE_NUMBER,
      to: to
    });
    console.log('✅ Real SMS sent via Twilio! Message SID: %s to %s', message.sid, to);
    return { success: true, sid: message.sid };
  } catch (error) {
    console.error('❌ Twilio SMS delivery failed:', error.message);
    // Print fallback OTP in console so user is never locked out
    console.log(`⚠️ Fallback OTP for ${to}: ${otp}`);
    return { success: false, error: error.message, fallbackOtp: otp };
  }
}

module.exports = {
  sendVerificationSMS,
  formatPhoneNumber,
  hasSmsConfig: () => hasSmsConfig
};
