# Comparison Algorithm

## Overview

The comparator (`src/comparator.mjs`) takes two documents stored in the database and produces a structured diff describing all changes between versions at both the section and row level.

## Two-Level Matching

### Level 1: Section Matching

Sections are matched by their **Prüfidentifikator** — the comma-separated set of 5-digit codes stored per section (e.g., `"21000,21001"`).

| Scenario | Result |
|----------|--------|
| Prüfidentifikator exists in both versions | **Matched** → compare rows |
| Prüfidentifikator only in old version | **Removed** section |
| Prüfidentifikator only in new version | **Added** section |

Section metadata changes (title, Kommunikation von, column headers) are also detected for matched sections.

### Level 2: Row Matching

Within matched sections, rows are matched by a **compound key**:

```
key = segmentGroup | segmentCode | dataElement [| codeValue]
```

Examples:
- `SG2|CTA|3139|IC` (segment group + code + element + first code value)
- `SG14|CNI|1490`
- `LABEL:Sendungsdaten` (for sub-section labels)

When multiple rows share the same key (duplicates within a section), they are matched positionally (first occurrence with first, second with second, etc.).

## Change Detection

For each matched row pair, the following fields are compared:
- `beschreibung` — description text
- `statusCol1` — first status column value
- `statusCol2` — second status column value
- `bedingung` — condition/rule text
- `segmentGroup` — structural change
- `segmentCode` — structural change

A row is classified as:

| Type | Meaning |
|------|---------|
| `unchanged` | All fields identical |
| `modified` | At least one field differs → field-level changes listed |
| `added` | Row exists only in new version |
| `removed` | Row exists only in old version |

## Output Structure

```javascript
{
  summary: {
    added: 1,      // sections added
    removed: 2,    // sections removed
    modified: 19,  // sections with changes
    unchanged: 0   // identical sections
  },
  sectionDiffs: [
    {
      type: 'modified',
      pruefidentifikator: '21000,21001',
      sectionOld: { /* section from v1 */ },
      sectionNew: { /* section from v2 */ },
      metaChanges: [
        { field: 'title', old: '...', new: '...' }
      ],
      rows: [
        {
          type: 'modified',
          key: 'SG2|CTA|3139|IC',
          rowOld: { /* row from v1 */ },
          rowNew: { /* row from v2 */ },
          changes: [
            { field: 'statusCol1', old: 'Muss', new: 'X' },
            { field: 'bedingung', old: '...', new: '...' }
          ]
        },
        { type: 'added', key: '...', row: { /* new row */ } },
        { type: 'removed', key: '...', row: { /* old row */ } },
        { type: 'unchanged', key: '...', row: { /* row */ } },
      ]
    },
    {
      type: 'added',
      pruefidentifikator: '21025,21027',
      section: { /* new section */ },
      rows: [ /* all rows marked as added */ ]
    },
    // ...
  ]
}
```

## Sorting

Section diffs are sorted by relevance:
1. Modified (most interesting)
2. Added
3. Removed
4. Unchanged

## Edge Cases

- **Sections with overlapping Prüfidentifikatoren**: If V2.0h has `21025,21026 21027` but V2.1 has `21025,21027` (removed 21026), these are treated as different sections (one removed, one added) since the full key differs.
- **Duplicate row keys**: When multiple rows share the same compound key within a section, they are matched by position within the duplicate set.
- **Label rows**: Sub-section labels (like "Sendungsdaten", "Meldepunkt") are matched using a `LABEL:` prefix key.
