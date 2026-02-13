# Usage Guide

## Prerequisites

- **Node.js** v18 or later (ESM support required)
- No other dependencies needed — no Python, no C++ build tools, no OCR software

## Installation

```bash
cd PDFCompare
npm install
```

This installs:
- `pdfjs-dist` — PDF text extraction
- `sql.js` — SQLite via WebAssembly

## Running a Comparison

### Basic Usage

```bash
node src/index.mjs <old.pdf> <new.pdf>
```

This will:
1. Parse both PDFs
2. Store data in `compare.sqlite`
3. Compare the two versions
4. Generate `report.html`

### With Options

```bash
node src/index.mjs <old.pdf> <new.pdf> --output my-report.html --db my-data.sqlite --verbose
```

| Option | Default | Description |
|--------|---------|-------------|
| `--output <file>` | `report.html` | Path for the HTML report |
| `--db <file>` | `compare.sqlite` | Path for the SQLite database |
| `--verbose` | off | Show per-section parsing details |
| `--help` / `-h` | — | Show help text |

### Using npm Scripts

```bash
# Compare the test PDFs
npm run compare:test

# Custom comparison
npm run compare -- path/to/old.pdf path/to/new.pdf --output result.html
```

## Example

```bash
node src/index.mjs Test/IFTSTA_AHB_2_0h_20250401.pdf Test/IFTSTA_AHB_2_1_Konsultationsfassung_20260202.pdf --verbose
```

Output:
```
[PDFCompare] Initializing database...
[PDFCompare] Parsing old PDF: Test/IFTSTA_AHB_2_0h_20250401.pdf
[PDFCompare]   Version: 2.0h, Pages: 111, Sections: 21
[PDFCompare] Parsing new PDF: Test/IFTSTA_AHB_2_1_Konsultationsfassung_20260202.pdf
[PDFCompare]   Version: 2.1, Pages: 75, Sections: 20
[PDFCompare] Storing in database...
[PDFCompare] Database saved: compare.sqlite
[PDFCompare] Comparing documents...
[PDFCompare]   Sections: 19 modified, 1 added, 2 removed, 0 unchanged
[PDFCompare]   Rows: 352 modified, 283 added, 503 removed, 798 unchanged
[PDFCompare] Generating report: report.html
[PDFCompare] Done in 1.9s. Open report.html in a browser to view the report.
```

## Output Files

### HTML Report (`report.html`)

A self-contained HTML file (no external dependencies) with:

- **Summary cards**: Version info, page counts, section/row counts for both versions
- **Change statistics**: Color-coded badges showing modified/added/removed/unchanged counts
- **Section details**: Expandable panels for each section (Prüfidentifikator), sorted by relevance
  - Modified sections shown first (yellow border)
  - Added sections (green border)
  - Removed sections (red border)
  - Unchanged sections collapsed by default (gray border)
- **Row diff tables**: Per-section tables showing every row with:
  - `+` green rows = added in new version
  - `-` red rows = removed from old version
  - `~` yellow rows = modified (changed fields show old → new values)
  - Gray rows = unchanged

Open the file in any browser. Click section headers to expand/collapse.

### SQLite Database (`compare.sqlite`)

Contains all parsed data in a queryable format. Open with:
- [DB Browser for SQLite](https://sqlitebrowser.org/)
- DBeaver, DataGrip, or any SQLite client
- `sqlite3` CLI

See [database.md](database.md) for schema details and example queries.

## Troubleshooting

### "Warning: TT: undefined function: 21"

This is a harmless pdfjs-dist warning about TrueType font instructions in the PDF. It does not affect text extraction.

### Version shows as "unknown"

The parser looks for "Version: X.Y" on page 1. If the PDF has a different format, the version may not be detected. The comparison still works — version is only used for display.

### Empty sections

Some sections may have 0 rows if the table structure doesn't match the expected column layout. This can happen for non-standard table formats within the AHB.
