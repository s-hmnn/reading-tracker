module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const { bookData, generateKeywords, generateConcepts, existingSummary, existingKeywords, existingConcepts } = req.body || {};
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
    if (generateKeywords) {
      const alreadyHave = (existingKeywords || []).join(', ') || '(keine)';
      const summaryContext = existingSummary
        ? `\nVorhandene KI-Analyse des Buches:\n${existingSummary}`
        : '';
      const notesContext = notes ? `\nNotizen: ${notes}` : '';
      const quotesContext = quotesText ? `\nZitate:\n${quotesText}` : '';

      const raw = await callAnthropic('claude-haiku-4-5-20251001', 500,
        `Schlage 5–8 prägnante deutschsprachige Keywords für das Buch "${title}" von ${author || 'unbekannt'} vor.${summaryContext}${notesContext}${quotesContext}

Bereits vorhandene Keywords (diese NICHT vorschlagen): ${alreadyHave}

Keywords sollen kurze, präzise Begriffe sein: Themen, Epoche, Stil, Herkunft, Genre, Stimmung.
Antworte NUR mit diesem JSON (kein Markdown): {"keywords":["Begriff1","Begriff2"]}`
      );

      const cleaned = extractJSON(raw);
      const parsed = JSON.parse(cleaned);
      const suggested = (parsed.keywords || []).filter(k => !(existingKeywords || []).includes(k));
      return res.json({ suggestedKeywords: suggested });
    }

    if (generateConcepts) {
      const conceptList = (existingConcepts || [])
        .map(c => `- ID ${c.id}: "${c.name}"${c.definition ? ` (${c.definition.slice(0, 80)})` : ''}`)
        .join('\n') || '(keine)';
      const notesContext = notes ? `\nNotizen: ${notes}` : '';
      const quotesContext = quotesText ? `\nZitate:\n${quotesText}` : '';

      const raw = await callAnthropic('claude-haiku-4-5-20251001', 800,
        `Du analysierst Notizen und Zitate eines Buchs. Buch: "${title}" von ${author || 'unbekannt'}.${notesContext}${quotesContext}

Bestehende Konzepte des Nutzers:
${conceptList}

Identifiziere:
1. Welche bestehenden Konzepte tatsächlich in diesem Buch behandelt werden (gib die ID-Liste zurück, max. 5)
2. Welche neuen Konzepte vorgeschlagen werden sollten, die noch nicht existieren (max. 3)

Sei zurückhaltend mit neuen Vorschlägen. Nur prägnante, eigenständige Begriffe – keine Allgemeinplätze.
Antworte NUR mit diesem JSON (kein Markdown): {"matchedConcepts":[1,2],"suggestedNewConcepts":[{"name":"Begriff","reason":"Kurze Begründung"}]}`
      );

      const cleaned = extractJSON(raw);
      const parsed = JSON.parse(cleaned);
      return res.json({
        matchedConcepts: parsed.matchedConcepts || [],
        suggestedNewConcepts: parsed.suggestedNewConcepts || []
      });
    }

    const raw = await callAnthropic('claude-haiku-4-5-20251001', 2500,
      `Analysiere "${title}" von ${author || 'unbekannt'} nach Adlers Lese-Methode.

Zitate:
${quotesText || '(keine)'}
Notizen: ${notes || '(keine)'}
Keywords: ${(keywords || []).join(', ') || '(keine)'}

Antworte NUR mit diesem JSON (kein Markdown):
{"kernthese":"1-2 Sätze","zentraleFrage":"1 Satz","tonalitaet":"2-3 Wörter","themen":[{"name":"Thema","beschreibung":"2-3 Sätze","zitat":"Zitattext (S. X)"}]}
3 Themen wenn wenige Zitate vorhanden, bis zu 5 Themen wenn viele Zitate vorhanden. Pro Thema 1 passendes Zitat aus dem Material.`
    );

    const cleanedSummary = extractJSON(raw);
    JSON.parse(cleanedSummary); // Validierung
    res.json({ aiMeta: {}, aiSummaryRaw: cleanedSummary });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
