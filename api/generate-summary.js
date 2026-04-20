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

  const extractJSON = t => {
    const start = t.indexOf('{');
    const end = t.lastIndexOf('}');
    return (start !== -1 && end > start) ? t.slice(start, end + 1) : t.trim();
  };

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
    const raw = await callAnthropic('claude-haiku-4-5-20251001', 1000,
      `Analysiere "${title}" von ${author || 'unbekannt'} nach Adlers Lese-Methode.

Zitate:
${quotesText || '(keine)'}
Notizen: ${notes || '(keine)'}
Keywords: ${(keywords || []).join(', ') || '(keine)'}

Antworte NUR mit diesem JSON (kein Markdown):
{"kernthese":"1 Satz","zentraleFrage":"1 Satz","tonalitaet":"2-3 Wörter","themen":[{"name":"Thema","beschreibung":"1 Satz","zitat":"Zitattext (S. X)"}]}
Genau 3 Themen. Pro Thema 1 passendes Zitat aus dem Material.`
    );

    const cleanedSummary = extractJSON(raw);
    JSON.parse(cleanedSummary); // Validierung
    res.json({ aiMeta: {}, aiSummaryRaw: cleanedSummary });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
