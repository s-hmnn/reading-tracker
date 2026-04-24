const nodemailer = require('nodemailer');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const { text, subject, category, userEmail } = req.body || {};
  if (!text?.trim()) return res.status(400).json({ error: 'Empty feedback' });

  const gmailUser = process.env.GMAIL_USER;
  const gmailPass = process.env.GMAIL_APP_PASSWORD;
  if (!gmailUser || !gmailPass) return res.status(500).json({ error: 'Mail not configured' });

  const emailSubject = subject
    ? `Crescendo Feedback [${category || 'Sonstiges'}]: ${subject}`
    : `Crescendo Feedback [${category || 'Sonstiges'}]`;

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: gmailUser, pass: gmailPass },
  });

  await transporter.sendMail({
    from: gmailUser,
    to: 'stefan.a.hartmann@gmail.com',
    subject: emailSubject,
    text: `Von: ${userEmail || 'unbekannt'}\nKategorie: ${category || 'Sonstiges'}\n\n${text}`,
  });

  return res.status(200).json({ ok: true });
};
