import { getSections, getRows } from './database.mjs';

/**
 * Compare two documents stored in the database.
 * @param {object} db - sql.js Database
 * @param {number} docId1 - "old" document ID
 * @param {number} docId2 - "new" document ID
 * @returns {ComparisonResult}
 */
export function compareDocuments(db, docId1, docId2) {
  const sections1 = getSections(db, docId1);
  const sections2 = getSections(db, docId2);

  // Build maps by Prüfidentifikator for matching
  const map1 = buildPruefMap(sections1);
  const map2 = buildPruefMap(sections2);

  const allKeys = new Set([...map1.keys(), ...map2.keys()]);

  const sectionDiffs = [];
  const summary = { added: 0, removed: 0, modified: 0, unchanged: 0 };

  for (const key of allKeys) {
    const s1 = map1.get(key);
    const s2 = map2.get(key);

    if (!s1) {
      // Section added in new version
      summary.added++;
      sectionDiffs.push({
        type: 'added',
        pruefidentifikator: key,
        section: s2,
        rows: getRows(db, s2.id).map(r => ({ type: 'added', row: r })),
      });
    } else if (!s2) {
      // Section removed in new version
      summary.removed++;
      sectionDiffs.push({
        type: 'removed',
        pruefidentifikator: key,
        section: s1,
        rows: getRows(db, s1.id).map(r => ({ type: 'removed', row: r })),
      });
    } else {
      // Section exists in both — compare rows
      const rows1 = getRows(db, s1.id);
      const rows2 = getRows(db, s2.id);
      const rowDiffs = compareRows(rows1, rows2);

      const hasChanges = rowDiffs.some(d => d.type !== 'unchanged');
      const metaChanged = checkMetaChanges(s1, s2);

      if (hasChanges || metaChanged) {
        summary.modified++;
      } else {
        summary.unchanged++;
      }

      sectionDiffs.push({
        type: hasChanges || metaChanged ? 'modified' : 'unchanged',
        pruefidentifikator: key,
        sectionOld: s1,
        sectionNew: s2,
        metaChanges: metaChanged ? getMetaChanges(s1, s2) : [],
        rows: rowDiffs,
      });
    }
  }

  // Sort: modified first, then added, then removed, then unchanged
  const order = { modified: 0, added: 1, removed: 2, unchanged: 3 };
  sectionDiffs.sort((a, b) => (order[a.type] ?? 9) - (order[b.type] ?? 9));

  return { summary, sectionDiffs };
}

/**
 * Normalize text for comparison: strip invisible characters, normalize
 * whitespace variants and dashes so only human-visible differences remain.
 */
function normalizeForComparison(text) {
  if (!text) return '';
  let s = text;
  // Strip zero-width characters and soft hyphens
  s = s.replace(/[\u200B\u200C\u200D\uFEFF\u2060\u200E\u200F\u00AD]/g, '');
  // Strip C0/C1 control characters except \n \r \t
  s = s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, '');
  // Normalize Unicode whitespace variants to regular space
  s = s.replace(/[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g, ' ');
  // Normalize dash/hyphen variants to standard hyphen
  s = s.replace(/[\u2010-\u2015\u2212\uFE58\uFE63\uFF0D]/g, '-');
  // Normalize spaces around hyphens between word characters (PDF extraction artifact)
  // e.g. "EBD - Cluster" → "EBD-Cluster"
  s = s.replace(/(\w)\s*-\s*(\w)/g, '$1-$2');
  // Normalize spacing around hyphen-slash compounds (PDF extraction artifact)
  s = s.replace(/\s*-\s*\/\s*/g, '-/');
  s = s.replace(/\s*\/\s*-\s*/g, '/-');
  s = s.replace(/\s*\/\s*/g, '/');
  // Collapse multiple spaces and trim
  s = s.replace(/ {2,}/g, ' ').trim();
  return s;
}

function buildPruefMap(sections) {
  const map = new Map();
  for (const section of sections) {
    // A section may have multiple Prüfidentifikatoren (comma-separated)
    // Use the full string as key, but also try individual values
    const key = section.pruefidentifikator;
    if (!map.has(key)) {
      map.set(key, section);
    }
  }
  return map;
}

function checkMetaChanges(s1, s2) {
  return normalizeForComparison(s1.title) !== normalizeForComparison(s2.title) ||
    normalizeForComparison(s1.kommunikationVon) !== normalizeForComparison(s2.kommunikationVon) ||
    normalizeForComparison(s1.statusCol1Header) !== normalizeForComparison(s2.statusCol1Header) ||
    normalizeForComparison(s1.statusCol2Header) !== normalizeForComparison(s2.statusCol2Header);
}

function getMetaChanges(s1, s2) {
  const changes = [];
  if (normalizeForComparison(s1.title) !== normalizeForComparison(s2.title)) {
    changes.push({ field: 'title', old: s1.title, new: s2.title });
  }
  if (normalizeForComparison(s1.kommunikationVon) !== normalizeForComparison(s2.kommunikationVon)) {
    changes.push({ field: 'kommunikationVon', old: s1.kommunikationVon, new: s2.kommunikationVon });
  }
  if (normalizeForComparison(s1.statusCol1Header) !== normalizeForComparison(s2.statusCol1Header)) {
    changes.push({ field: 'statusCol1Header', old: s1.statusCol1Header, new: s2.statusCol1Header });
  }
  if (normalizeForComparison(s1.statusCol2Header) !== normalizeForComparison(s2.statusCol2Header)) {
    changes.push({ field: 'statusCol2Header', old: s1.statusCol2Header, new: s2.statusCol2Header });
  }
  return changes;
}

/**
 * Compare rows from two sections.
 * Strategy: match by compound key (segmentGroup + segmentCode + dataElement),
 * then fall back to position-based matching for duplicates.
 */
function compareRows(rows1, rows2) {
  const diffs = [];

  // Build lookup: key → array of rows (handles duplicates)
  const map1 = buildRowMap(rows1);
  const map2 = buildRowMap(rows2);

  const allKeys = new Set([...map1.keys(), ...map2.keys()]);
  const matched2 = new Set();

  for (const key of allKeys) {
    const list1 = map1.get(key) || [];
    const list2 = map2.get(key) || [];

    const maxLen = Math.max(list1.length, list2.length);

    for (let i = 0; i < maxLen; i++) {
      const r1 = list1[i];
      const r2 = list2[i];

      if (r1 && r2) {
        // Both exist — compare fields
        const fieldChanges = diffRowFields(r1, r2);
        if (fieldChanges.length > 0) {
          diffs.push({
            type: 'modified',
            key,
            rowOld: r1,
            rowNew: r2,
            changes: fieldChanges,
          });
        } else {
          diffs.push({ type: 'unchanged', key, row: r1 });
        }
        if (r2) matched2.add(r2.id);
      } else if (r1 && !r2) {
        diffs.push({ type: 'removed', key, row: r1 });
      } else {
        diffs.push({ type: 'added', key, row: r2 });
        matched2.add(r2.id);
      }
    }
  }

  return diffs;
}

function buildRowMap(rows) {
  const map = new Map();
  for (const row of rows) {
    const key = rowKey(row);
    if (!map.has(key)) {
      map.set(key, []);
    }
    map.get(key).push(row);
  }
  return map;
}

function rowKey(row) {
  if (row.isLabel) {
    return `LABEL:${normalizeForComparison(row.beschreibung)}`;
  }
  // Primary key: segmentGroup + segmentCode + dataElement
  // Include beschreibung snippet for disambiguation when data_element is empty
  const sg = normalizeForComparison(row.segmentGroup);
  const sc = normalizeForComparison(row.segmentCode);
  const de = normalizeForComparison(row.dataElement);
  const parts = [sg, sc, de].filter(Boolean);
  if (parts.length === 0) {
    return `POS:${row.rowOrder}`;
  }
  // Add code value from beschreibung (first word if it looks like a code)
  const beschr = normalizeForComparison(row.beschreibung);
  const firstWord = beschr.split(/\s+/)[0] || '';
  if (/^[A-Z0-9_]{1,10}$/.test(firstWord) && de) {
    parts.push(firstWord);
  }
  return parts.join('|');
}

function diffRowFields(r1, r2) {
  const fields = ['beschreibung', 'statusCol1', 'statusCol2', 'bedingung'];
  const changes = [];

  for (const field of fields) {
    const v1 = (r1[field] || '').trim();
    const v2 = (r2[field] || '').trim();
    if (normalizeForComparison(v1) !== normalizeForComparison(v2)) {
      changes.push({ field, old: v1, new: v2 });
    }
  }

  // Also check structural changes
  if (normalizeForComparison(r1.segmentGroup) !== normalizeForComparison(r2.segmentGroup)) {
    changes.push({ field: 'segmentGroup', old: r1.segmentGroup, new: r2.segmentGroup });
  }
  if (normalizeForComparison(r1.segmentCode) !== normalizeForComparison(r2.segmentCode)) {
    changes.push({ field: 'segmentCode', old: r1.segmentCode, new: r2.segmentCode });
  }

  return changes;
}
