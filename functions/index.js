const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const { getDatabase } = require("firebase-admin/database");
const { initializeApp } = require("firebase-admin/app");
const Anthropic = require("@anthropic-ai/sdk");

initializeApp();

const ANTHROPIC_KEY = defineSecret("ANTHROPIC_API_KEY");

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
