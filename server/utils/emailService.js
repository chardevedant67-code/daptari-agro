const { Resend } = require('resend');

// Lazily constructed so a missing RESEND_API_KEY only fails the specific
// request that actually needs to send an email, not server startup.
let client = null;
function getClient() {
  if (!client) {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      throw new Error('RESEND_API_KEY is not configured');
    }
    client = new Resend(apiKey);
  }
  return client;
}

// Sends the Admin password-reset email. Callers must never log `resetUrl`
// (it carries the raw one-time token) — only this function ever sees it.
async function sendPasswordResetEmail({ to, resetUrl }) {
  const from = process.env.EMAIL_FROM;
  if (!from) {
    throw new Error('EMAIL_FROM is not configured');
  }

  await getClient().emails.send({
    from,
    to,
    subject: 'Reset your INDUSCORE admin password',
    html: `
      <p>We received a request to reset your INDUSCORE admin password.</p>
      <p><a href="${resetUrl}">Reset your password</a></p>
      <p>This link expires in 60 minutes. If you did not request this, you can safely ignore this email.</p>
    `,
  });
}

module.exports = { sendPasswordResetEmail };
