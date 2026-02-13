# Database Schema

## Overview

PDFCompare uses SQLite (via `sql.js` WASM) to persist parsed PDF data. The database file (`compare.sqlite`) stores structured table data from both PDF versions, enabling SQL-based querying and comparison.

## Schema

### documents

Stores metadata for each parsed PDF.

```sql
CREATE TABLE documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  version TEXT NOT NULL,          -- e.g., "2.0h", "2.1"
  filename TEXT NOT NULL,         -- original PDF filename
  page_count INTEGER,             -- total pages in PDF
  parsed_at TEXT NOT NULL          -- ISO timestamp of parsing
);
```

### sections

One row per Anwendungsfall (use case / table section) within a document.

```sql
CREATE TABLE sections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id INTEGER NOT NULL,    -- FK → documents.id
  section_order INTEGER NOT NULL,  -- order within document (0-based)
  title TEXT,                      -- section title (if detected)
  pruefidentifikator TEXT NOT NULL,-- comma-separated, e.g., "21000,21001"
  kommunikation_von TEXT,          -- comma-separated, e.g., "LF an NB / ÜNB,NB an NB"
  status_col1_header TEXT,         -- e.g., "Statusmeldung"
  status_col2_header TEXT,         -- e.g., "Statusmeldung"
  page_start INTEGER               -- first page where section appears
);
```

### rows

Individual table rows within a section.

```sql
CREATE TABLE rows (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  section_id INTEGER NOT NULL,     -- FK → sections.id
  row_order INTEGER NOT NULL,      -- position within section (0-based)
  segment_group TEXT,              -- e.g., "SG2", "SG14"
  segment_code TEXT,               -- e.g., "CTA", "DTM", "NAD"
  data_element TEXT,               -- e.g., "3139", "2005", "00007"
  beschreibung TEXT,               -- description text
  status_col1 TEXT,                -- e.g., "X", "Muss", "X [911]"
  status_col2 TEXT,                -- e.g., "X", "Muss"
  bedingung TEXT,                  -- condition/rule text
  is_label INTEGER DEFAULT 0       -- 1 if this is a sub-section label row
);
```

### Indexes

```sql
CREATE INDEX idx_sections_document ON sections(document_id);
CREATE INDEX idx_sections_pruefid ON sections(pruefidentifikator);
CREATE INDEX idx_rows_section ON rows(section_id);
```

## Entity Relationship

```
documents  1 ──── * sections  1 ──── * rows
```

- One document contains multiple sections (one per Prüfidentifikator)
- One section contains multiple rows (the table data)

## API Functions

| Function | Description |
|----------|-------------|
| `initDatabase()` | Initialize sql.js WASM engine |
| `createDatabase()` | Create new in-memory DB with schema |
| `loadDatabase(path)` | Load existing DB from file |
| `saveDatabase(db, path)` | Write DB to file |
| `insertDocument(db, filename, parsed)` | Insert a full parsed document (sections + rows) |
| `getSections(db, docId)` | Get all sections for a document |
| `getRows(db, sectionId)` | Get all rows for a section |
| `getDocument(db, docId)` | Get document metadata |
| `getDocumentStats(db, docId)` | Get section/row counts |

## Querying the Database Directly

The `.sqlite` file can be opened with any SQLite client (DB Browser for SQLite, DBeaver, `sqlite3` CLI, etc.).

### Useful Queries

List all sections for a document:
```sql
SELECT s.pruefidentifikator, s.title, COUNT(r.id) as row_count
FROM sections s
LEFT JOIN rows r ON r.section_id = s.id
WHERE s.document_id = 1
GROUP BY s.id
ORDER BY s.section_order;
```

Find rows containing a specific code:
```sql
SELECT s.pruefidentifikator, r.*
FROM rows r
JOIN sections s ON r.section_id = s.id
WHERE r.segment_code = 'STS';
```

Compare a specific field across versions:
```sql
SELECT
  r1.segment_group, r1.segment_code, r1.data_element,
  r1.status_col1 as v1_status, r2.status_col1 as v2_status
FROM rows r1
JOIN sections s1 ON r1.section_id = s1.id AND s1.document_id = 1
JOIN sections s2 ON s1.pruefidentifikator = s2.pruefidentifikator AND s2.document_id = 2
JOIN rows r2 ON r2.section_id = s2.id
  AND r2.segment_group = r1.segment_group
  AND r2.segment_code = r1.segment_code
  AND r2.data_element = r1.data_element
WHERE r1.status_col1 != r2.status_col1;
```
