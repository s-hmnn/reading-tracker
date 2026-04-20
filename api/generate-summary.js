module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const { bookData } = req.body || {};
  if (!bookData) return res.status(400).json({ error: 'bookData required' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'API key not configured' });

  const { title, author, quotes, notes, keywords, allTitles } = bookData;
  const quotesText = (quotes || []).map(q => `- "${q.text}" (S. ${q.page || '?'})`).join('\n');

  const stripFences = t => t.replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,'').trim();

  const callAnthropic = async (model, max_tokens, content) => {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify({ model, max_tokens, messages: [{ role: 'user', content }] })
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error?.message || r.status);
    return data.content[0].text;
  };

  try {
    const metaRaw = await callAnthropic('claude-haiku-4-5-20251001', 500,
      `Du analysierst das Buch "${title}" von ${author || 'unbekannt'}.

Zitate:
${quotesText || '(keine)'}
Notizen: ${notes || '(keine)'}
Keywords: ${(keywords || []).join(', ') || '(keine)'}
Andere Bücher in der Bibliothek: ${allTitles || '(keine)'}

Antworte NUR mit einem JSON-Objekt ohne Markdown-Fences:
{"thesis":"Kernthese 1-2 Sätze","themes":["Thema1","Thema2"],"tone":"Tonalität","centralQuestion":"Zentrale Frage","relatedBooks":["Buchtitel aus Bibliothek die passen"]}`
    );

    let aiMeta = {};
    try { aiMeta = JSON.parse(stripFences(metaRaw)); } catch { aiMeta = {}; }

    const aiSummaryRaw = await callAnthropic('claude-sonnet-4-6', 1200,
      `Du analysierst "${title}" von ${author || 'unbekannt'} nach Adlers analytischer Lese-Methode.

Voranalyse:
- Kernthese: ${aiMeta.thesis || '(unbekannt)'}
- Zentrale Frage: ${aiMeta.centralQuestion || '(unbekannt)'}
- Tonalität: ${aiMeta.tone || '(unbekannt)'}
- Themen laut Voranalyse: ${(aiMeta.themes || []).join(', ') || '(keine)'}

Vollständiges Material:
${quotesText || '(keine Zitate)'}
Notizen: ${notes || '(keine)'}

Antworte NUR mit diesem JSON (kein Markdown, keine Einleitung):
{"kernthese":"1-2 Sätze","zentraleFrage":"...","tonalitaet":"...","themen":[{"name":"Thema","beschreibung":"1 Erläuterungssatz","zitate":["Zitattext (S. X)"]}]}
Weise treffende Zitate den Themen zu. Identifiziere 4-6 Themen. Pro Thema 1-2 Zitate.`
    );

    const cleanedSummary = stripFences(aiSummaryRaw);
    JSON.parse(cleanedSummary); // Validierung
    res.json({ aiMeta, aiSummaryRaw: cleanedSummary });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
