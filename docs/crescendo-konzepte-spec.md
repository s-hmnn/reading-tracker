# Crescendo – Spec: Konzepte & verwandte Inhalte

**Ziel:** Ausbau der Wissensmanagement-Funktion in `index.html`. Konzepte werden zu vollwertigen Wissens-Entitäten. KI schlägt Konzepte vor, der User bestätigt. Bücher und Konzepte zeigen automatisch verwandte Inhalte.

**Scope:** Frontend-Änderungen in `index.html` + ein zusätzlicher Aufruf in der bestehenden Vercel-Funktion (`/api/generate-summary`).

**Nicht enthalten:** Force-Graph-Visualisierung, Q&A über die Bibliothek, Embeddings.

---

## Bestehende Patterns, an die sich die Implementierung halten muss

- **Single-File-Architektur:** Alles in `index.html`. Keine separaten JS/CSS-Dateien.
- **Firebase Realtime DB:** Speicherung über `window._state` + `saveToFirebase()`. Niemals direkt schreiben, immer über `save()`.
- **`sanitizeState()`:** Wird beim Laden aufgerufen und stellt Defaults sicher. Neue Felder MÜSSEN dort initialisiert werden.
- **CSS-Variablen:** Theme-Tokens (`--sky-500`, `--text-primary`, etc.) verwenden. Keine Hex-Codes.
- **KI-Aufrufe:** Gehen über `https://reading-tracker-puce.vercel.app/api/generate-summary`. Nicht direkt an Anthropic API.
- **UI-Pattern für Vorschläge:** Orientiert sich an den existierenden Keyword-Vorschlägen (`suggestKeywordsWithAI`, `_bmSuggestedKws`, `bm-kw-suggestions`).
- **Toast-Feedback:** `toast(msg, 'success'|'error'|'info')` für User-Feedback nutzen.

---

## 1. Datenschema-Erweiterungen

### 1.1 `state.concepts[i]` – erweitertes Konzept-Objekt

```js
{
  id: 42,                        // bestehend (number)
  name: "Resonanz",              // bestehend (string)
  definition: "...",             // bestehend (string)
  notes: "...",                  // bestehend (string)
  linkedBooks: [3, 7, 12],       // bestehend (number[])
  relatedConcepts: [],           // bestehend (number[]) — bleibt für manuelle Verknüpfungen
  createdAt: 1735000000000,      // bestehend (number, ms timestamp)
  source: "manual" | "ai_suggested"  // NEU – Herkunftsinfo
}
```

**Migration:** In `sanitizeState()` für jedes vorhandene Konzept ohne `source`-Feld defaulten auf `"manual"`.

### 1.2 `state.books[i]` – neues Feld `pendingConcepts`

```js
{
  // ... alle bestehenden Felder ...
  linkedConcepts: [42, 17],      // bestehend (number[])
  pendingConcepts: [             // NEU – KI-Vorschläge, noch nicht bestätigt
    {
      name: "Anerkennung",
      matchedConceptId: 17,      // null wenn neu, sonst ID eines existierenden Konzepts
      reason: "Erscheint in 4 Zitaten"  // optional, kann leer sein
    },
    {
      name: "Beschleunigung",
      matchedConceptId: null,
      reason: ""
    }
  ]
}
```

**Migration:** In `sanitizeState()` fehlende `pendingConcepts` als leeres Array defaulten.

---

## 2. KI-Aufruf erweitern – Konzept-Vorschläge

### 2.1 Backend-Anpassung (Vercel-Funktion)

Die bestehende Funktion `/api/generate-summary` wird um einen optionalen Modus ergänzt: `generateConcepts: true`.

**Request-Payload (NEU):**
```json
{
  "generateConcepts": true,
  "bookData": {
    "title": "...",
    "author": "...",
    "notes": "...",
    "quotes": [...]
  },
  "existingConcepts": [
    { "id": 1, "name": "Resonanz", "definition": "..." },
    { "id": 2, "name": "Anerkennung", "definition": "..." }
  ]
}
```

**Erwartete Response:**
```json
{
  "matchedConcepts": [1],
  "suggestedNewConcepts": [
    { "name": "Beschleunigung", "reason": "Zentrales Thema im Buch" },
    { "name": "Entfremdung", "reason": "" }
  ]
}
```

**Prompt für Claude (sinngemäß, in Vercel-Funktion zu hinterlegen):**

> Du analysierst Notizen und Zitate eines Buchs. Du bekommst eine Liste bestehender Konzepte des Nutzers. Identifiziere:
> 1. Welche bestehenden Konzepte tatsächlich in diesem Buch behandelt werden (gib `id`-Liste zurück, max. 5)
> 2. Welche neuen Konzepte vorgeschlagen werden sollten, die noch nicht existieren (max. 3)
>
> Sei zurückhaltend mit neuen Vorschlägen. Nur prägnante, eigenständige Begriffe – keine Allgemeinplätze. Antwort als JSON: `{ "matchedConcepts": [...], "suggestedNewConcepts": [...] }`.

### 2.2 Frontend-Aufruf

**Auslöser:** Wird automatisch *nach* erfolgreichem `generateBookSummary()` aufgerufen. Nicht als separater Button – der User soll nicht zwei Klicks machen.

**Implementierung:** Erweitere `generateBookSummary()` in `index.html`:

```js
async function generateBookSummary(bookId) {
  // ... bestehender Code für aiMeta + aiSummary ...

  // NEU: Konzept-Vorschläge holen
  try {
    const conceptRes = await fetch('https://reading-tracker-puce.vercel.app/api/generate-summary', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        generateConcepts: true,
        bookData: { title: b.title, author: b.author, notes: b.notes, quotes: b.quotes || [] },
        existingConcepts: state.concepts.map(c => ({ id: c.id, name: c.name, definition: c.definition || '' }))
      })
    });
    if (conceptRes.ok) {
      const { matchedConcepts, suggestedNewConcepts } = await conceptRes.json();
      const pending = [];
      // Bestehende Matches als pending eintragen, sofern nicht schon verknüpft
      (matchedConcepts || []).forEach(cid => {
        if (!b.linkedConcepts?.includes(cid)) {
          const c = state.concepts.find(x => x.id === cid);
          if (c) pending.push({ name: c.name, matchedConceptId: cid, reason: '' });
        }
      });
      // Neue Vorschläge als pending eintragen
      (suggestedNewConcepts || []).forEach(s => {
        pending.push({ name: s.name, matchedConceptId: null, reason: s.reason || '' });
      });
      b.pendingConcepts = pending;
      save();
    }
  } catch (e) {
    console.warn('Konzept-Vorschläge fehlgeschlagen:', e.message);
    // Soft-Fail: aiSummary ist bereits gespeichert, Konzepte sind Bonus
  }

  // ... bestehender Code für UI-Refresh ...
}
```

---

## 3. UI – Konzept-Vorschläge im Buch-Modal

### 3.1 Anzeige im KI-Tab

Im `bmt-ki`-Bereich, **unter** der `bm-ai-summary`, einen neuen Abschnitt einfügen:

```html
<div class="bm-field" id="bm-concepts-section" style="margin-top:1rem;border-top:1px solid var(--border);padding-top:0.8rem">
  <label class="bm-label">Konzept-Vorschläge</label>
  <div id="bm-pending-concepts"></div>
</div>
```

### 3.2 Render-Logik

Neue Funktion `renderPendingConcepts()`:

- Wird in `openBookModal()` aufgerufen
- Liest `b.pendingConcepts`
- Rendert jeden Vorschlag als Chip – Stil analog zu `_bmSuggestedKws` (siehe `renderSuggestedKeywords()`)
- Klick auf Chip → `acceptConcept(index)` (siehe unten)
- Bei leerer Liste: Bereich ausblenden (`display:none`)

```js
function renderPendingConcepts() {
  const wrap = document.getElementById('bm-pending-concepts');
  const section = document.getElementById('bm-concepts-section');
  const b = state.books.find(x => x.id === _bmBookId);
  if (!b || !b.pendingConcepts?.length) {
    if (section) section.style.display = 'none';
    return;
  }
  if (section) section.style.display = 'block';
  wrap.innerHTML = b.pendingConcepts.map((p, i) => {
    const isExisting = p.matchedConceptId !== null;
    const label = isExisting ? `${p.name} (verknüpfen)` : `+ ${p.name} (neu)`;
    const title = p.reason || (isExisting ? 'Bestehendes Konzept' : 'Neues Konzept anlegen');
    return `<span class="keyword-tag" style="cursor:pointer;margin:0.1rem"
              onclick="acceptConcept(${i})" title="${title}">${label}</span>`;
  }).join('') + `
    <div style="margin-top:0.5rem;display:flex;gap:0.4rem">
      <button class="btn btn-outline btn-sm" style="font-size:0.7rem" onclick="acceptAllConcepts()">Alle übernehmen</button>
      <button class="btn btn-outline btn-sm" style="font-size:0.7rem" onclick="dismissAllConcepts()">Alle verwerfen</button>
    </div>`;
}
```

### 3.3 Akzeptieren / Verwerfen

```js
function acceptConcept(index) {
  const b = state.books.find(x => x.id === _bmBookId);
  if (!b || !b.pendingConcepts?.[index]) return;
  const p = b.pendingConcepts[index];
  let conceptId = p.matchedConceptId;
  if (conceptId === null) {
    // Neues Konzept anlegen
    conceptId = state.nextId++;
    state.concepts.push({
      id: conceptId,
      name: p.name,
      definition: '',
      notes: '',
      linkedBooks: [],
      relatedConcepts: [],
      createdAt: Date.now(),
      source: 'ai_suggested'
    });
  }
  // Verknüpfung herstellen (bidirektional)
  if (!b.linkedConcepts) b.linkedConcepts = [];
  if (!b.linkedConcepts.includes(conceptId)) b.linkedConcepts.push(conceptId);
  const c = state.concepts.find(x => x.id === conceptId);
  if (c && !c.linkedBooks.includes(b.id)) c.linkedBooks.push(b.id);
  // Aus pending entfernen
  b.pendingConcepts.splice(index, 1);
  save();
  renderPendingConcepts();
  toast('Konzept verknüpft ✓', 'success');
}

function acceptAllConcepts() {
  const b = state.books.find(x => x.id === _bmBookId);
  if (!b?.pendingConcepts?.length) return;
  // Rückwärts iterieren, weil splice() Indizes verschiebt
  for (let i = b.pendingConcepts.length - 1; i >= 0; i--) acceptConcept(i);
}

function dismissAllConcepts() {
  const b = state.books.find(x => x.id === _bmBookId);
  if (!b) return;
  b.pendingConcepts = [];
  save();
  renderPendingConcepts();
}
```

### 3.4 Aufruf in `openBookModal()`

In der bestehenden `openBookModal()`-Funktion, am Ende des Stammdaten-Setup-Blocks:

```js
renderPendingConcepts();
```

---

## 4. „Verwandte Bücher" / „Verwandte Konzepte"

### 4.1 Hilfsfunktionen

Direkt nach den bestehenden KB-Funktionen einfügen:

```js
// Konzepte, die mit dem gegebenen Konzept ≥ 2 Bücher gemeinsam haben
function getRelatedConcepts(conceptId, minOverlap = 2, limit = 5) {
  const c = state.concepts.find(x => x.id === conceptId);
  if (!c || !c.linkedBooks?.length) return [];
  const cBooks = new Set(c.linkedBooks);
  const scored = state.concepts
    .filter(x => x.id !== conceptId)
    .map(x => {
      const overlap = (x.linkedBooks || []).filter(b => cBooks.has(b)).length;
      return { concept: x, overlap };
    })
    .filter(s => s.overlap >= minOverlap)
    .sort((a, b) => b.overlap - a.overlap)
    .slice(0, limit);
  return scored;
}

// Bücher, die mit dem gegebenen Buch ≥ 2 Konzepte gemeinsam haben
function getRelatedBooks(bookId, minOverlap = 2, limit = 5) {
  const b = state.books.find(x => x.id === bookId);
  if (!b || !b.linkedConcepts?.length) return [];
  const bConcepts = new Set(b.linkedConcepts);
  const scored = state.books
    .filter(x => x.id !== bookId && x.linkedConcepts?.length)
    .map(x => {
      const overlap = (x.linkedConcepts || []).filter(c => bConcepts.has(c)).length;
      return { book: x, overlap };
    })
    .filter(s => s.overlap >= minOverlap)
    .sort((a, b) => b.overlap - a.overlap)
    .slice(0, limit);
  return scored;
}
```

### 4.2 Anzeige auf Konzept-Detailseite

In `renderKBConceptDetail()`, nach dem bestehenden „Erwähnt in"-Block, einen neuen Abschnitt einfügen:

```js
const related = getRelatedConcepts(c.id);
// ... in den HTML-Output einfügen:
${related.length ? `
  <div class="kb-section-title">Verwandte Konzepte</div>
  <div class="kb-concepts-chips">
    ${related.map(({ concept, overlap }) => `
      <span class="kb-concept-chip" onclick="selectKBItem('concept',${concept.id})"
            title="${overlap} gemeinsame Bücher">
        ${concept.name}
        <span style="opacity:0.6;font-size:11px;margin-left:4px">·${overlap}</span>
      </span>`).join('')}
  </div>` : ''}
```

**Wichtig:** Das ersetzt NICHT das bestehende `relatedConcepts`-Feld (manuelle Verknüpfungen). Falls beides existiert, automatische Berechnung verwenden, manuelle ignorieren oder beide kombinieren – Entscheidung: nur automatische Berechnung anzeigen, manuelles Feld bleibt bestehen für mögliche zukünftige Erweiterung.

### 4.3 Anzeige auf Buch-Detailseite (im Wissen-Tab)

In `renderKBBookDetail()`, nach dem bestehenden „Verknüpfte Konzepte"-Block, einen neuen Abschnitt einfügen:

```js
const relatedBooks = getRelatedBooks(b.id);
// ... in den HTML-Output:
${relatedBooks.length ? `
  <div class="kb-section-title">Verwandte Bücher</div>
  <div class="kb-books-scroll">
    ${relatedBooks.map(({ book, overlap }) => `
      <div class="kb-book-ref" onclick="selectKBItem('book',${book.id})"
           title="${overlap} gemeinsame Konzepte">
        <span class="kb-book-ref-title">${cap(book.title)}</span>
        <span class="kb-book-ref-author">${book.author || ''} · ${overlap} gemeinsam</span>
      </div>`).join('')}
  </div>` : ''}
```

---

## 5. Akzeptanzkriterien

Die Implementierung gilt als erfolgreich, wenn:

1. **Datenschema:** Bestehende Daten laden ohne Fehler. `sanitizeState()` setzt Defaults für `source` und `pendingConcepts`.
2. **KI-Vorschläge:** Nach Klick auf „KI-Analyse generieren" werden Konzept-Vorschläge automatisch im KI-Tab als Chips angezeigt.
3. **Akzeptieren:** Klick auf einen Chip erstellt entweder eine Verknüpfung zu einem bestehenden Konzept oder legt ein neues Konzept an. Beidseitige Verknüpfung (`book.linkedConcepts` UND `concept.linkedBooks`).
4. **Persistenz:** Akzeptierte Konzepte überleben einen Page-Reload (Firebase-Sync).
5. **Verwandte:** Auf einer Konzept-Seite mit mindestens einem anderen Konzept, das ≥ 2 Bücher teilt, erscheint der „Verwandte Konzepte"-Block. Analog für Bücher.
6. **Soft-Fail:** Wenn die Konzept-Vorschläge-API fehlschlägt, bleibt die aiSummary trotzdem gespeichert. Kein blockierender Fehler.
7. **Keine Regressionen:** Alle bestehenden Features (Keywords, aiSummary, Statistiken, Friends, etc.) funktionieren unverändert.

---

## 6. Reihenfolge der Implementierung

1. `sanitizeState()` erweitern (Defaults setzen)
2. Vercel-Funktion erweitern (Backend) – **separat deployen**
3. `getRelatedConcepts` / `getRelatedBooks` einbauen
4. Anzeige der verwandten Inhalte in `renderKBConceptDetail` / `renderKBBookDetail` einbauen
5. `pendingConcepts`-UI im Buch-Modal einbauen
6. `generateBookSummary` um Konzept-Aufruf erweitern
7. Manuell mit einem realen Buch testen

---

## 7. Out of Scope (explizit nicht jetzt)

- Force-Graph-Visualisierung
- Q&A über die Bibliothek (RAG)
- Embeddings
- Konzept-Aliase (z.B. „Resonanz" ↔ „resonance")
- Manuelles Anlegen von Verwandtschaft zwischen Konzepten
- Mobile-spezifische Anpassungen für Wissen-Tab
- Migration alter Konzepte mit `source: 'unknown'`-Markierung (alle existierenden gelten als `manual`)
