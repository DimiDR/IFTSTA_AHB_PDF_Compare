# PDFCompare

Compare IFTSTA AHB (Anwendungshandbuch) PDF versions by extracting structured table data into SQLite and generating a visual diff report.

Built for the German energy market's EDIFACT message specifications published by BDEW. Detects added, removed, and modified sections and rows between two AHB versions — down to individual field-level changes.

## Features

- **No OCR needed** — extracts embedded text directly via `pdfjs-dist` with x/y positioning
- **SQLite persistence** — parsed data stored in a queryable `.sqlite` file
- **HTML diff report** — self-contained, color-coded report with collapsible sections
- **Section matching** — matches Anwendungsfaelle across versions by Pruefidentifikator
- **Row-level diffing** — compares individual table rows by compound key (segment group + code + data element)
- **Zero native dependencies** — uses `sql.js` (WASM), no C++ build tools or Python required

## Quick Start

```bash
# Install
npm install

# Run comparison
node src/index.mjs <old.pdf> <new.pdf>

# Example with test files
node src/index.mjs Test/IFTSTA_AHB_2_0h_20250401.pdf \
  Test/IFTSTA_AHB_2_1_Konsultationsfassung_20260202.pdf
```

Open `report.html` in a browser to view the results.

## Prerequisites

- **Node.js** v18+ (ESM support required)
- Nothing else — no Python, no OCR software, no native build tools

## Usage

```bash
node src/index.mjs <old.pdf> <new.pdf> [options]
```

| Option | Default | Description |
|--------|---------|-------------|
| `--output <file>` | `report.html` | HTML report output path |
| `--db <file>` | `compare.sqlite` | SQLite database output path |
| `--verbose` | off | Show per-section parsing details |
| `--help` | — | Show help text |

### npm Scripts

```bash
npm run compare:test          # Compare included test PDFs
npm run compare -- a.pdf b.pdf --output result.html
```

## Example Output

```
[PDFCompare] Parsing old PDF: IFTSTA_AHB_2_0h_20250401.pdf
[PDFCompare]   Version: 2.0h, Pages: 111, Sections: 21
[PDFCompare] Parsing new PDF: IFTSTA_AHB_2_1_Konsultationsfassung_20260202.pdf
[PDFCompare]   Version: 2.1, Pages: 75, Sections: 20
[PDFCompare] Comparing documents...
[PDFCompare]   Sections: 19 modified, 1 added, 2 removed, 0 unchanged
[PDFCompare]   Rows: 352 modified, 283 added, 503 removed, 798 unchanged
[PDFCompare] Done in 1.9s.
```

The HTML report includes:

- **Summary cards** with version info, page/section/row counts
- **Change statistics** as color-coded badges
- **Per-section diffs** in expandable panels (modified first, then added/removed)
- **Row-level diff tables** with field-level old/new value comparison
  - Green (`+`) = added rows
  - Red (`-`) = removed rows
  - Yellow (`~`) = modified rows with inline old/new values
  - Gray = unchanged rows

## Architecture

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│  PDF Parser  │────>│   Database   │────>│  Comparator  │────>│   Reporter   │
│  parser.mjs  │     │ database.mjs │     │comparator.mjs│     │ reporter.mjs │
└──────────────┘     └──────────────┘     └──────────────┘     └──────────────┘
     │                     │                     │                     │
  pdfjs-dist            sql.js              In-memory             HTML output
  (text + xy)          (WASM SQLite)        row diffing           (self-contained)
```

| Module | File | Purpose |
|--------|------|---------|
| Parser | `src/parser.mjs` | Extracts text with positions, groups into table rows, detects sections |
| Database | `src/database.mjs` | SQLite schema and CRUD (documents, sections, rows) |
| Comparator | `src/comparator.mjs` | Matches sections by Pruefidentifikator, diffs rows by compound key |
| Reporter | `src/reporter.mjs` | Generates self-contained HTML with color-coded diffs |
| CLI | `src/index.mjs` | Orchestrates the full pipeline |

### How Parsing Works

1. `pdfjs-dist` extracts every text item with its x/y position on each page
2. Items are grouped into rows by y-coordinate proximity
3. Each item is assigned to a column (EDIFACT Struktur, Beschreibung, Status 1/2, Bedingung) by x-coordinate range
4. Sections are detected by Pruefidentifikator header rows (5-digit numeric codes)
5. Multi-line cells are merged by detecting continuation rows

### How Comparison Works

1. Sections matched across versions by Pruefidentifikator (e.g., `21000,21001`)
2. Within matched sections, rows matched by compound key: `segmentGroup|segmentCode|dataElement`
3. Matched rows compared field-by-field (beschreibung, status columns, bedingung)
4. Unmatched rows reported as added or removed

## SQLite Database

The generated `.sqlite` file can be opened with any SQLite client for custom queries.

```sql
-- List all sections
SELECT pruefidentifikator, title, COUNT(r.id) as rows
FROM sections s
LEFT JOIN rows r ON r.section_id = s.id
WHERE s.document_id = 1
GROUP BY s.id;

-- Find all rows with a specific segment code
SELECT s.pruefidentifikator, r.*
FROM rows r JOIN sections s ON r.section_id = s.id
WHERE r.segment_code = 'STS';
```

See [docs/database.md](docs/database.md) for full schema and more query examples.

## Documentation

| Document | Description |
|----------|-------------|
| [docs/architecture.md](docs/architecture.md) | System design, data flow, key decisions |
| [docs/parser.md](docs/parser.md) | Column detection, section parsing, whitespace handling |
| [docs/database.md](docs/database.md) | Schema, API functions, example SQL queries |
| [docs/comparison.md](docs/comparison.md) | Matching algorithm, change detection, output format |
| [docs/usage.md](docs/usage.md) | Installation, CLI options, troubleshooting |

## Tech Stack

| Component | Library |
|-----------|---------|
| Runtime | Node.js v18+ (ESM) |
| PDF extraction | [pdfjs-dist](https://www.npmjs.com/package/pdfjs-dist) |
| Database | [sql.js](https://www.npmjs.com/package/sql.js) (SQLite via WASM) |
| Report | Self-contained HTML/CSS/JS |

## License

ISC
