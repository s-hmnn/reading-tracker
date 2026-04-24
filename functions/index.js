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
    const { text, subject, category } = request.data;
    if (!text?.trim()) throw new HttpsError("invalid-argument", "Empty feedback");

    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user: GMAIL_USER.value(), pass: GMAIL_PASS.value() },
    });
    const emailSubject = subject
      ? `Crescendo Feedback [${category || "Sonstiges"}]: ${subject}`
      : `Crescendo Feedback [${category || "Sonstiges"}]`;
    await transporter.sendMail({
      from: GMAIL_USER.value(),
      to: "stefan.a.hartmann@gmail.com",
      subject: emailSubject,
      text: `Von: ${request.auth.token.email}\nKategorie: ${category || "Sonstiges"}\n\n${text}`,
    });

    const db = getDatabase();
    await db.ref(`feedback/${Date.now()}`).set({
      text,
      subject: subject || "",
      category: category || "Sonstiges",
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

    const { bookData } = request.data;
    if (!bookData) throw new HttpsError("invalid-argument", "bookData required");

    const { title, author, quotes, notes, keywords, allTitles } = bookData;
    const quotesText = (quotes || []).map(q => `- "${q.text}" (S. ${q.page || '?'})`).join("\n");

    const anthropic = new Anthropic({ apiKey: ANTHROPIC_KEY.value() });

    // Step 1: Haiku → metadata
    const metaMsg = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 500,
      messages: [{
        role: "user",
        content: `Du analysierst das Buch "${title}" von ${author || "unbekannt"}.

Zitate:
${quotesText || "(keine)"}
Notizen: ${notes || "(keine)"}
Keywords: ${(keywords || []).join(", ") || "(keine)"}
Andere Bücher in der Bibliothek: ${allTitles || "(keine)"}

Antworte NUR mit einem JSON-Objekt ohne Markdown-Fences:
{"thesis":"Kernthese 1-2 Sätze","themes":["Thema1","Thema2"],"tone":"Tonalität","centralQuestion":"Zentrale Frage","relatedBooks":["Buchtitel aus Bibliothek die passen"]}`
      }]
    });

    let aiMeta = {};
    try { aiMeta = JSON.parse(metaMsg.content[0].text); } catch { aiMeta = {}; }

    // Step 2: Sonnet → structured analysis (Adler method)
    const summaryMsg = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1200,
      messages: [{
        role: "user",
        content: `Du analysierst "${title}" von ${author || "unbekannt"} nach Adlers analytischer Lese-Methode.

Voranalyse:
- Kernthese: ${aiMeta.thesis || "(unbekannt)"}
- Zentrale Frage: ${aiMeta.centralQuestion || "(unbekannt)"}
- Tonalität: ${aiMeta.tone || "(unbekannt)"}
- Themen laut Voranalyse: ${(aiMeta.themes || []).join(", ") || "(keine)"}

Vollständiges Material:
${quotesText || "(keine Zitate)"}
Notizen: ${notes || "(keine)"}

Antworte NUR mit diesem JSON (kein Markdown, keine Einleitung):
{"kernthese":"1-2 Sätze","zentraleFrage":"...","tonalitaet":"...","themen":[{"name":"Thema","beschreibung":"1 Erläuterungssatz","zitate":["Zitattext (S. X)"]}]}
Weise treffende Zitate den Themen zu. Identifiziere 4-6 Themen. Pro Thema 1-2 Zitate.`
      }]
    });

    const aiSummaryRaw = summaryMsg.content[0].text;
    JSON.parse(aiSummaryRaw); // validate JSON

    return { aiMeta, aiSummaryRaw };
  }
);
