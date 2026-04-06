const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const { getDatabase } = require("firebase-admin/database");
const { initializeApp } = require("firebase-admin/app");
const Anthropic = require("@anthropic-ai/sdk");
const nodemailer = require("nodemailer");

initializeApp();

const ANTHROPIC_KEY = defineSecret("ANTHROPIC_API_KEY");
const GMAIL_USER = defineSecret("GMAIL_USER");
const GMAIL_PASS = defineSecret("GMAIL_APP_PASSWORD");

exports.sendFeedback = onCall(
  { secrets: [GMAIL_USER, GMAIL_PASS], region: "europe-west1" },
  async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Login required");
    const { text } = request.data;
    if (!text?.trim()) throw new HttpsError("invalid-argument", "Empty feedback");

    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user: GMAIL_USER.value(), pass: GMAIL_PASS.value() },
    });
    await transporter.sendMail({
      from: GMAIL_USER.value(),
      to: "stefan.a.hartmann@gmail.com",
      subject: "Crescendo Feedback",
      text: `Von: ${request.auth.token.email}\n\n${text}`,
    });

    const db = getDatabase();
    await db.ref(`feedback/${Date.now()}`).set({
      text,
      user: request.auth.token.email,
      ts: new Date().toISOString(),
    });
    return { ok: true };
  }
);

exports.generateBookSummary = onCall(
  { secrets: [ANTHROPIC_KEY], region: "europe-west1" },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Login required");
    }

    const { bookId } = request.data;
    const uid = request.auth.uid;

    const db = getDatabase();
    const snap = await db.ref(`users/${uid}/tracker`).get();
    if (!snap.exists()) throw new HttpsError("not-found", "No tracker data");

    const state = snap.val();
    const book = (state.books || []).find(b => b.id === bookId);
    if (!book) throw new HttpsError("not-found", "Book not found");

    const quotesText = (book.quotes || [])
      .map(q => `- "${q.text}" (S. ${q.page})`)
      .join("\n");

    const prompt = `Du analysierst Lesenotizen für das Buch "${book.title}" von ${book.author}.

Notizen: ${book.notes || "(keine)"}

Markierte Zitate:
${quotesText || "(keine)"}

Keywords: ${(book.keywords || []).join(", ") || "(keine)"}

Erstelle eine strukturierte Zusammenfassung (max. 200 Wörter) der wichtigsten Gedanken und Erkenntnisse aus diesen Notizen.`;

    const anthropic = new Anthropic({ apiKey: ANTHROPIC_KEY.value() });
    const message = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 400,
      messages: [{ role: "user", content: prompt }],
    });

    const summary = message.content[0].text;

    const updatedBooks = (state.books || []).map(b =>
      b.id === bookId
        ? { ...b, aiSummary: summary, aiSummaryDate: Date.now() }
        : b
    );
    await db.ref(`users/${uid}/tracker/books`).set(updatedBooks);

    return { summary };
  }
);
