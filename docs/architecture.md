# Architecture Overview

## System Design

PDFCompare is a Node.js application that compares two versions of IFTSTA AHB (Anwendungshandbuch) PDFs by extracting structured table data, storing it in SQLite, and producing a visual diff report.

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│  PDF Parser  │────>│   Database   │────>│  Comparator  │────>│   Reporter   │
│  parser.mjs  │     │ database.mjs │     │comparator.mjs│     │ reporter.mjs │
└──────────────┘     └──────────────┘     └──────────────┘     └──────────────┘
     │                     │                     │                     │
  pdfjs-dist            sql.js              In-memory             HTML output
  (text + xy)          (WASM SQLite)        row diffing           (self-contained)
```

## Modules

| Module | File | Responsibility |
|--------|------|----------------|
| Parser | `src/parser.mjs` | Extracts text with x/y positions from PDFs, groups into rows, detects sections by Prüfidentifikator, handles multi-line cells |
| Database | `src/database.mjs` | SQLite schema (documents → sections → rows), CRUD operations using sql.js (WASM) |
| Comparator | `src/comparator.mjs` | Matches sections by Prüfidentifikator, diffs rows by compound key, normalizes PDF text artifacts (whitespace, dashes, hyphens) |
| Reporter | `src/reporter.mjs` | Generates a self-contained HTML report with color-coded changes, word-level diff highlighting, and collapsible sections |
| CLI | `src/index.mjs` | Orchestrates the pipeline: parse → store → compare → report |

## Key Design Decisions

### No OCR Required

The IFTSTA AHB PDFs contain embedded, machine-readable text. Using `pdfjs-dist` extracts text with precise x/y coordinates directly. OCR (Tesseract etc.) would be slower, less accurate, and add an unnecessary dependency.

### SQLite via WASM (sql.js)

Instead of `better-sqlite3` (which requires native C++ build tools), the app uses `sql.js` — SQLite compiled to WebAssembly. This means:
- Zero native dependencies — works on any OS without Python/C++ build tools
- Single-file database output (`.sqlite`)
- Parsed data is persisted, so re-comparison doesn't require re-parsing

### Position-Based Column Detection

Tables are parsed by mapping text item x-coordinates to known column boundaries:
- `x < 170`: EDIFACT Struktur
- `170–305`: Beschreibung
- `305–370`: Status Column 1
- `370–435`: Status Column 2
- `x > 435`: Bedingung

These boundaries were empirically determined from the PDF layout analysis and are consistent across both document versions.

### Section Matching by Prüfidentifikator

Each Anwendungsfall (use case) in the AHB has unique Prüfidentifikator(en) — 5-digit numeric codes like 21000, 21001. Sections are matched across versions using these codes, making the comparison robust even when page numbers, section ordering, or page counts change.

## Data Flow

1. **Input**: Two PDF files (old version, new version)
2. **Parse**: Extract text items → group by y-coordinate into rows → classify columns by x-coordinate → detect section boundaries
3. **Store**: Insert parsed sections and rows into SQLite
4. **Compare**: Match sections by Prüfidentifikator → match rows by compound key → compute field-level diffs
5. **Report**: Generate self-contained HTML with summary stats, per-section diffs, color coding

## Technology Stack

| Component | Library | Version |
|-----------|---------|---------|
| Runtime | Node.js | v18+ (ESM) |
| PDF extraction | pdfjs-dist | ^5.x |
| Database | sql.js | ^1.x |
| Output | Self-contained HTML | No framework |
