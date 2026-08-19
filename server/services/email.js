const nodemailer = require('nodemailer');

const hasEmailConfig = process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS;

let transporter;
if (hasEmailConfig) {
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: process.env.SMTP_PORT || 587,
    secure: process.env.SMTP_PORT == 465,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });
}

async function sendVerificationEmail(to, token) {
  const verifyLink = `http://localhost:3000/verify.html?email=${encodeURIComponent(to)}&token=${token}`;
  
  const mailOptions = {
    from: process.env.SMTP_FROM || '"Velora" <noreply@velora.com>',
    to,
    subject: 'Verify your Velora account',
    text: `Welcome to Velora! Please verify your email by clicking this link: ${verifyLink}`,
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: auto;">
        <h2>Welcome to Velora!</h2>
        <p>Please click the button below to verify your email address.</p>
        <a href="${verifyLink}" style="display: inline-block; padding: 12px 24px; background: #2563eb; color: white; text-decoration: none; border-radius: 6px;">Verify Email</a>
        <p style="margin-top: 20px; font-size: 12px; color: #666;">Or copy this link: ${verifyLink}</p>
      </div>
    `
  };

  if (!hasEmailConfig) {
    console.log('----------------------------------------------------');
    console.log('📧 MOCK EMAIL: SMTP config missing');
    console.log(`To: ${to}`);
    console.log(`Subject: ${mailOptions.subject}`);
    console.log(`Link: ${verifyLink}`);
    console.log('----------------------------------------------------');
    return true; // Simulate success
  }

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log('Message sent: %s', info.messageId);
    return true;
  } catch (error) {
    console.error('Error sending email:', error);
    return false;
  }
}

module.exports = {
  sendVerificationEmail
};
