# PDF Parser

## Overview

The parser (`src/parser.mjs`) extracts structured table data from IFTSTA AHB PDFs using `pdfjs-dist`. It converts free-form PDF text into typed section/row objects suitable for database storage and comparison.

## How It Works

### 1. Text Extraction

For each page, `pdfjs-dist` returns an array of text items, each with:
- `str`: the text content
- `transform[4]` (x), `transform[5]` (y): position on page
- `transform[0]`: approximate font size
- `width`: text width

### 2. Filtering

Items are filtered to remove:
- **Page headers** (y > 775): "IFTSTA Anwendungshandbuch" title
- **Page footers** (y < 30): Page number, date, version line

### 3. Row Grouping

Items are sorted by y-coordinate (descending = top-to-bottom) and grouped into rows. Items within 5px y-distance of each other belong to the same row.

### 4. Column Classification

Each item is assigned to a column based on its x-coordinate:

```
x: 0          88    118    170       305      370      435         600
   |──────────|──────|──────|─────────|────────|────────|───────────|
   Segment    Seg    Data   Beschrei- Status   Status   Bedingung
   Group      Code   Element bung     Col 1    Col 2
   └──────── EDIFACT ───────┘
```

| Column | X Range | Content Example |
|--------|---------|-----------------|
| Segment Group | 0–88 | `SG2`, `SG14`, `SG15` |
| Segment Code | 88–118 | `CTA`, `DTM`, `NAD`, `STS` |
| Data Element | 118–170 | `3139`, `2005`, `00007` |
| Beschreibung | 170–305 | `IC Informationskontakt` |
| Status Column 1 | 305–370 | `X`, `Muss`, `Kann`, `X [911]` |
| Status Column 2 | 370–435 | `X`, `Muss`, `X [27]` |
| Bedingung | 435+ | `[911] Format: Mögliche Werte...` |

### 5. Section Detection

Sections are identified by **Prüfidentifikator header rows** — rows where:
1. The Beschreibung column contains "Prüfidentifikator"
2. The status columns contain 5-digit numeric IDs (e.g., `21000`, `21001`)

This distinguishes section headers from data rows that mention "Prüfidentifikator" as a field name (which have `X` or `Muss` in status columns instead).

When a repeated Prüfidentifikator header appears (same IDs as current section), it's recognized as a **page-continuation header** and skipped.

### 6. Row Classification

Each row is classified as one of:

| Type | Criteria | Action |
|------|----------|--------|
| Table Header | Contains "EDIFACT" and "Struktur" | Skipped |
| Prüfidentifikator Header | Beschreibung has "Prüfidentifikator" + numeric status | Creates new section |
| Kommunikation Von | Beschreibung has "Kommunikation von" | Stored as section metadata |
| Status Column Header | Status columns contain descriptive text (Meldung, etc.) | Stored as section metadata |
| Data Row | Has recognized segment group/code/element | Added to current section |
| Continuation Row | No EDIFACT content, but has beschreibung/status/bedingung | Merged with previous row |
| Section Label | Only beschreibung, no status columns | Added as label row |

### 7. Multi-Line Cell Handling

When a table cell spans multiple PDF rows (common for long Bedingung texts), the parser detects this by the absence of EDIFACT content in the row and merges the text into the previous data row's corresponding field.

## Whitespace Normalization

V2.1 PDFs have extra spacing in some text (e.g., `"0 2 .0 2 .202 6"` instead of `"02.02.2026"`). The parser normalizes whitespace in individual text items. The version detection logic also handles split version numbers.

## Output Format

```javascript
{
  version: "2.0h",
  pageCount: 111,
  sections: [
    {
      title: "Übermittlung des Prüfstatus",
      pruefidentifikator: ["21000", "21001"],
      kommunikationVon: ["LF an NB / ÜNB", "NB an NB"],
      statusCol1Header: "Statusmeldung",
      statusCol2Header: "Statusmeldung",
      pageStart: 5,
      rows: [
        {
          segmentGroup: "SG2",
          segmentCode: "CTA",
          dataElement: "3139",
          beschreibung: "IC Informationskontakt",
          statusCol1: "X",
          statusCol2: "X",
          bedingung: "",
          isLabel: false
        },
        // ...
      ]
    },
    // ...
  ]
}
```

## Known Limitations

- Column boundaries are hardcoded based on analysis of IFTSTA AHB PDFs. Other PDF formats would need different boundaries.
- Very complex multi-line cells with mixed column content may occasionally misalign.
- Section titles are captured opportunistically from text preceding the Prüfidentifikator row; they may be incomplete for some sections.
