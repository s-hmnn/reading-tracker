# CLAUDE.md — reading-tracker (Crescendo)

## Architektur

**Single-Page Application** — die gesamte App läuft in einer einzigen Datei: `index.html` (256 KB, ~4220 Zeilen). Kein Frontend-Framework, kein Build-Schritt. Vanilla JavaScript mit imperativem DOM-Rendering via Template Literals.

**Datenpersistenz**
- Firebase Realtime Database (europe-west1) als primärer Speicher mit Realtime-Sync
- localStorage-Fallback bei Offline (`reading_tracker_v3_{uid}`)
- Globales State-Objekt: `window._state` (read/write via Object.defineProperty-Getter `window.state`)
- Jede Änderung → `save()` → `window.saveToFirebase()`

**Backend**
- Firebase Cloud Functions (`/functions/index.js`): `sendFeedback`, `generateBookSummary`
- Vercel API Routes (`/api/`): `generate-summary.js`, `send-feedback.js` (weniger aktiv)
- Anthropic Claude API für AI-Buchzusammenfassungen (Haiku für Metadaten, Sonnet für Analyse)

**Auth**
- Google OAuth via Firebase
- Nutzer-Whitelist hardcoded in `index.html`: `stefan.a.hartmann@gmail.com`, `cap.matilde@gmail.com`

**Deployment**: Vercel (`vercel.json`). PWA-fähig via `sw.js` + `manifest.json`.

**Externe Libraries** (alle via CDN in `index.html`):
- Chart.js 4.4.1 — Statistik-Charts
- XLSX 0.18.5 — Excel-Export
- Firebase SDK v10.12.0 (auth, database, functions)
- Flag Icons CSS 7.2.3
- Google Fonts: Lora, Inter, DM Mono

---

## Tab-Struktur

Tab-Wechsel via `switchTab(tab, btn)` oder `switchTabExtra(tab)`. Aktiver Tab erhält `.active`-Klasse.

| Tab-ID | Label | Zweck |
|---|---|---|
| `tab-today` | Heute | Dashboard: Tagesquote, Quick-Log, Streak, Tages-/Wochen-/Monatsstatistik, gestern-Banner |
| `tab-goal` | Ziel | Jahres-Leseziel mit Pacing-Prognose |
| `tab-books` | Bücher | Bibliothek mit Status-Filtern, erweiterter Suche, Grid/Listen-Toggle |
| `tab-stats` | Statistiken | Jahresvergleich-Charts, Heatmaps (5-Wochen-Monatsraster), Lesegeschwindigkeit |
| `tab-kb` | Wissen | Knowledge Base: Konzepte ↔ Bücher verknüpfen, AI-Zusammenfassungen |
| `tab-friends` | Freunde | Fremdansicht anderer Nutzer-Bibliotheken und Leseaktivität |

**Weitere UI-Schichten** (keine Tabs):
- `#login-screen` — Google OAuth Einstieg
- `#loading-screen` — initiale Ladeanzeige
- `#book-modal` — Buch hinzufügen/bearbeiten (mit Unter-Tabs: Details / Zitate / Analyse / Cover)
- `#delete-book-modal` — Lösch-Bestätigungsdialog
- `#kindle-modal` — Kindle-Highlight-Import
- `#feedback-modal` — Feedback-Formular

---

## Datenmodell

```javascript
window._state = {
  books: [{
    id, title, author, pages, year,
    status,           // 'want_to_read' | 'reading' | 'done' | 'abandoned'
    type,             // 'Roman', 'Sachbuch', ...
    format,           // 'Buch', 'E-Book', 'Hörbuch'
    language,         // 'Deutsch', 'Englisch', ...
    rating,           // float 1–5 oder null
    keywords,         // string[]
    quotes: [{ text, page }],
    notes, cover_url, isbn, createdAt, linkedConcepts  // number[]
  }],
  logs: [{
    id, date,          // 'YYYY-MM-DD'
    bookId, bookTitle, pages,
    currentPosition, positionType  // 'page' | 'percent'
  }],
  goals: { [year]: number },   // Jahres-Seitenziel
  concepts: [{
    id, name, definition, notes,
    linkedBooks, relatedConcepts  // number[]
  }],
  nextId: number               // Auto-Inkrement für neue IDs
}
```

**Status-Workflow**: `want_to_read → reading → done` (oder `abandoned`)  
Via `toggleBookDone(id)` — zyklisch.

**Wichtige globale Variablen**:
- `window._friends` — Array anderer Nutzerprofile
- `window._friendState` — aktuell angezeigter Freund
- `window._anthropicKey` — Claude API Key (gecacht)
- `window._gridView` — Grid/Listen-Toggle Boolean
- `booksYF`, `booksStatusF`, `booksFormatFS`, `booksTypeFS`, `booksLangFS` — aktive Filter
- `selSY` — ausgewählte Jahre für Statistik

---

## CSS-Konventionen

**Theme-System**: `data-theme`-Attribut auf `<html>`. Dark ist Default (`:root`), Light via `[data-theme="light"]` Override. Toggle: `window.toggleTheme()` + localStorage.

**CSS-Variablen** (28 total, Auswahl):
```css
--bg, --surface, --card, --cream          /* Hintergründe */
--border, --border-hover                  /* Rahmen */
--sky-50/100/200/400/500/600/700          /* Blau-Skala (interaktiv) */
--text-primary, --text-secondary, --text-muted, --ink, --muted
--success (#4ade80), --warning (#fbbf24), --danger (#f87171)
--gold (#fbbf24), --accent (#f87171)
```

**Fonts**: Lora = Überschriften, Inter = UI, DM Mono = Zahlen/Code

**Naming** (BEM-inspiriert, nicht strikt):
```
.book-item              → Container
.book-item.done         → Status-Modifier
.book-item-row          → Child-Element
.book-title, .book-meta → Semantische Children
```

**Button-Varianten**: `.btn`, `.btn-primary`, `.btn-sky`, `.btn-outline`, `.btn-danger`, `.btn-ghost`, `.btn-sm`

**Responsive Breakpoints**:
- `@media(min-width:480px)` — 4-Spalten Stats-Grid
- `@media(min-width:560px)` — 2-Spalten Goal-/Two-Col-Grid

**Animationen**: `@keyframes spin`, `logoPulse`, `logoZoomIn`, `screenFadeOut`, `bmFade`. Transitionen 120–500ms ease-out.

**Heatmap-Intensitäten**: `.hm-cell.l1` bis `.hm-cell.l4`

---

## Wichtige Funktionen

### State & Persistence
| Funktion | Zweck |
|---|---|
| `save()` | Persistiert `window._state` → Firebase |
| `sanitizeState(s)` | Validiert & migriert eingehende Daten (stellt books[], logs[], goals{}, concepts[] sicher) |
| `loadFromFirebase()` | Initialer Datenladevorgang, Fallback zu localStorage |
| `startRealtimeSync()` | Firebase `onValue()` Listener für Remote-Änderungen |
| `window._defaultData()` | Leeren State erstellen |

### Navigation
| Funktion | Zweck |
|---|---|
| `switchTab(tab, btn)` | Aktiviert Tab, updated DOM, ruft Render-Funktionen |
| `switchTabExtra(tab)` | Tab-Wechsel aus Non-Button-Kontext (z.B. Logo-Klick) |

### Bücher
| Funktion | Zweck |
|---|---|
| `renderBooks()` | Bibliothek rendern mit aktiven Filtern |
| `openBookModal(id)` | Bearbeiten-Modal öffnen (null = neues Buch) |
| `closeBookModal(event)` | Modal schließen, unsaved-changes prüfen |
| `saveBookDetails()` | Buch-Edits aus Modal persistieren |
| `silentSaveBookDetails()` | Auto-Save ohne UI-Feedback |
| `scheduleAutosave()` | Debounced Auto-Save (2s Delay) |
| `markModalDirty()` | Modal als verändert markieren |
| `toggleBookDone(id)` | Status-Zyklus: want_to_read → reading → done → abandoned |
| `toggleEditBook(id, e)` | Inline-Edit-Modus an/aus |
| `saveBookEdit(id)` | Inline-Edits speichern |
| `deleteBook(id, e)` | Lösch-Bestätigungsdialog öffnen |
| `getBookProgress(book)` | `{current, total}` gelesene Seiten |
| `switchBookModalTab(tab, btn)` | Modal-Unter-Tabs wechseln |

### Logs (Leseeinträge)
| Funktion | Zweck |
|---|---|
| `addEntry()` | Leseeinheit loggen (Seiten/Position), aktualisiert Buch-Status |
| `addMiniLogEntry()` | Quick-Log via FAB |
| `deleteEntry(id)` | Logeintrag löschen |
| `getLastPosition(bookId)` | Aktuelle Leseposition aus Logs |
| `recalcPagesAfter(bookId, fromDate)` | Kumulative Seiten neu berechnen |

### Statistik & Streaks
| Funktion | Zweck |
|---|---|
| `calcStreak()` | Aufeinanderfolgende Lesetage berechnen |
| `renderTodayStats()` | Heute/Woche/Monat/Durchschnitt + Streak rendern |
| `renderStats()` | Vollständige Statistik-Tab rendern |
| `renderYearCharts()` | Chart.js-Instanzen für Jahresdaten |
| `renderHeatmap(year)` | Heatmap für 12 Monate rendern |
| `pagesThisYear(yr)` | Seiten im Kalenderjahr summieren |
| `pagesInRange(a, b)` | Seiten in Datumsbereich |

### Ziel (Goal-Tab)
| Funktion | Zweck |
|---|---|
| `renderGoal()` | Jahresziel, Fortschrittsbalken, Pacing-Prognose |
| `saveGoal()` | Jahres-Seitenziel speichern |

### Knowledge Base
| Funktion | Zweck |
|---|---|
| `renderKB()` | KB-Tab rendern |
| `kbGenerateSummary(bookId)` | Claude API für AI-Buchzusammenfassung aufrufen |
| `renderAiSummaryHTML(aiSummary)` | Claude-JSON zu HTML rendern |
| `linkConceptToBook(bookId)` | Konzept ↔ Buch verknüpfen |
| `createNewConcept()` | Neues Konzept anlegen |
| `deleteConcept(id)` | Konzept und Verknüpfungen löschen |

### Zitate
| Funktion | Zweck |
|---|---|
| `addQuote()` | Zitat zu Buch hinzufügen |
| `deleteQuote(idx)` / `deleteAllQuotes()` | Zitat(e) löschen |
| `getDailyQuotes()` | Alle Zitate für tägliche Anzeige sammeln |
| `renderDailyQuotes()` | Tägliches Zitat-Karussell initialisieren |

### Kindle-Import
| Funktion | Zweck |
|---|---|
| `analyzeKindleInput()` | Hochgeladene Datei parsen und Preview zeigen |
| `parseKindleHighlights(raw)` | Format auto-erkennen (HTML/Text) |
| `importKindleHighlights()` | Neues Buch aus Highlights erstellen |

### Auth & Friends
| Funktion | Zweck |
|---|---|
| `window.signInWithGoogle()` | OAuth-Popup via Firebase |
| `window.signOutUser()` | Ausloggen, State leeren |
| `registerUserProfile()` | Nutzerinfo in Firebase schreiben |
| `renderFriendTab()` | Freunde-Tab rendern |

### UI-Hilfsfunktionen
| Funktion | Zweck |
|---|---|
| `toast(msg, type)` | Temporäre Benachrichtigung (t-success / t-error) |
| `window.toggleTheme()` | Dark/Light + Chart.js-Farben updaten + localStorage |
| `exportToExcel()` | XLSX-Datei der Bibliothek erstellen |
| `todayStr()` / `yesterdayStr()` | `'YYYY-MM-DD'` für heute/gestern |
| `pagesFromLogs(dateStr)` | Seiten für ein Datum |
| `coverColor(title)` | Deterministischer Buchcover-Farbhash |
| `langFlag(lang)` | Sprache → Flag-Icons CSS-Klasse |
| `starsDisplayHtml(rating)` | Stern-Anzeige HTML rendern |

---

## Bekannte Blocker & Quirks

**z-index auf Mobile (kritisch)**  
Book-Modal hat `z-index: 200`, Bottom-Nav `z-index: 110`. Neue Overlays müssen >= 200 sein. Wenn ein neues Element unter der Navigation verschwindet: z-index prüfen.

**iOS Safari Footer-Layout**  
Kein `margin-right: auto` in Flex-Containern für Button-Ausrichtung — führt zu inkonsistentem Rendering auf iOS Safari. Stattdessen: `justify-content: space-between` mit explizitem Wrapper-`<div>` für Button-Gruppen.

**Safe-Area-Inset (Notch-Geräte)**  
`padding-bottom: max(1rem, env(safe-area-inset-bottom))` verwenden, nicht nur `padding-bottom: 1rem`.

**Streak-Element muss statisch sein**  
Das Streak-Anzeige-Element (`#streak-display`) muss als statisches HTML in `tab-today` existieren. Wenn es dynamisch beim Render-Aufruf erzeugt wird, fehlt es nach Tab-Wechseln, da `renderTodayStats()` auf das DOM-Element angewiesen ist.

**Feedback-Formular**  
Nutzt clientseitiges `mailto:` statt Backend-API — weniger zuverlässig. Firebase Function `sendFeedback` existiert als Alternative, wird aber nicht aktiv genutzt.

**Nutzer-Whitelist**  
Hardcoded in `index.html`. Neue Nutzer: Whitelist-Array im Code suchen und anpassen.

**Firebase API Keys**  
Hardcoded in `index.html` (öffentlich sichtbar) — das ist by-design bei Firebase. Sicherheit läuft über Firebase Security Rules in `database.rules.json`.

---

## Dateistruktur

```
reading-tracker/
├── index.html              HAUPT-APP (alles inline: CSS, JS, HTML)
├── sw.js                   Service Worker (minimal)
├── manifest.json           PWA-Manifest
├── database.rules.json     Firebase Security Rules
├── firebase.json           Firebase Emulator Config
├── vercel.json             Vercel Deployment Config
├── package.json            Node.js (nodemailer)
├── api/
│   ├── generate-summary.js Anthropic API Handler (Vercel)
│   └── send-feedback.js    E-Mail Handler (Vercel)
├── functions/
│   └── index.js            Firebase Cloud Functions
└── _old/                   Archivierte Vorgängerversionen
```
