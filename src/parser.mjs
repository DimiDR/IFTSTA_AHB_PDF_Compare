import fs from 'fs';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

// --- Column x-coordinate boundaries (derived from PDF analysis) ---
const COL = {
  EDIFACT_MAX: 170,
  BESCHREIBUNG_MAX: 305,
  STATUS1_MAX: 370,
  STATUS2_MAX: 435,
};

const EDIFACT_SUB = {
  SEG_GROUP_MAX: 88,
  SEG_CODE_MAX: 118,
};

const ROW_Y_THRESHOLD = 5;
const HEADER_Y_MIN = 775;
const FOOTER_Y_MAX = 30;

const SEGMENT_GROUP_RE = /^SG\d+$/;
const KNOWN_SEGMENTS = new Set([
  'UNH', 'BGM', 'DTM', 'NAD', 'CTA', 'COM', 'CNI', 'LOC',
  'STS', 'RFF', 'FTX', 'EQD', 'GID', 'UNT', 'DOC', 'MEA',
  'QTY', 'TDT', 'SEQ', 'PCI', 'GIN', 'IDE', 'DGS',
]);

/**
 * Parse a PDF file and extract structured section/row data.
 * @param {string} filePath - Path to the PDF file
 * @returns {Promise<{version: string, sections: Section[]}>}
 */
export async function parsePDF(filePath) {
  const fileData = new Uint8Array(fs.readFileSync(filePath));
  const doc = await getDocument({ data: fileData }).promise;

  const allPages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    allPages.push({
      pageNum: i,
      items: content.items
        .filter(item => item.str.trim())
        .map(item => ({
          text: normalizeWhitespace(item.str),
          x: round1(item.transform[4]),
          y: round1(item.transform[5]),
          width: item.width,
          fontSize: round1(item.transform[0]),
        })),
    });
  }

  const version = detectVersion(allPages);
  const sections = buildSections(allPages);

  return { version, sections, pageCount: doc.numPages };
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

function normalizeWhitespace(text) {
  return text.replace(/\s+/g, ' ').trim();
}

function detectVersion(allPages) {
  // Look at page 1 for version info
  // Join all text from page 1 items, then collapse spaces for version matching
  const page1Items = allPages[0]?.items || [];
  const allText = page1Items.map(i => i.text).join(' ');

  // First try exact match
  const versionMatch = allText.match(/Version:\s*([\d.]+\w*)/i);
  if (versionMatch) {
    const ver = versionMatch[1];
    // Check if version looks incomplete (e.g., "2." due to V2.1 spacing)
    // Look ahead in text for the continuation
    const afterVersion = allText.slice(allText.indexOf(ver) + ver.length);
    const cont = afterVersion.match(/^\s*(\d+\w*)/);
    if (ver.endsWith('.') && cont) {
      return ver + cont[1];
    }
    return ver;
  }

  // Fallback: collapse all whitespace and try again
  const collapsed = allText.replace(/\s+/g, '');
  const altMatch = collapsed.match(/Version:(\d+\.\d+\w*)/i);
  return altMatch ? altMatch[1] : 'unknown';
}

// --- Row grouping and column classification ---

function groupIntoRows(items) {
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);

  const rows = [];
  let currentRow = [];
  let currentY = null;

  for (const item of sorted) {
    if (currentY === null || Math.abs(item.y - currentY) > ROW_Y_THRESHOLD) {
      if (currentRow.length > 0) rows.push(currentRow);
      currentRow = [item];
      currentY = item.y;
    } else {
      currentRow.push(item);
    }
  }
  if (currentRow.length > 0) rows.push(currentRow);

  return rows;
}

function classifyColumn(x) {
  if (x < COL.EDIFACT_MAX) return 'edifact';
  if (x < COL.BESCHREIBUNG_MAX) return 'beschreibung';
  if (x < COL.STATUS1_MAX) return 'status1';
  if (x < COL.STATUS2_MAX) return 'status2';
  return 'bedingung';
}

function classifyEdifactSub(x) {
  if (x < EDIFACT_SUB.SEG_GROUP_MAX) return 'segmentGroup';
  if (x < EDIFACT_SUB.SEG_CODE_MAX) return 'segmentCode';
  return 'dataElement';
}

function parseRow(items) {
  const row = {
    segmentGroup: '',
    segmentCode: '',
    dataElement: '',
    beschreibung: '',
    statusCol1: '',
    statusCol2: '',
    bedingung: '',
    y: items[0]?.y || 0,
  };

  const parts = {
    beschreibung: [],
    status1: [],
    status2: [],
    bedingung: [],
  };

  for (const item of items) {
    const col = classifyColumn(item.x);

    if (col === 'edifact') {
      const sub = classifyEdifactSub(item.x);
      if (sub === 'segmentGroup') {
        row.segmentGroup = row.segmentGroup
          ? row.segmentGroup + ' ' + item.text
          : item.text;
      } else if (sub === 'segmentCode') {
        row.segmentCode = row.segmentCode
          ? row.segmentCode + ' ' + item.text
          : item.text;
      } else {
        row.dataElement = row.dataElement
          ? row.dataElement + ' ' + item.text
          : item.text;
      }
    } else {
      parts[col === 'status1' ? 'status1' : col === 'status2' ? 'status2' : col].push(item.text);
    }
  }

  row.beschreibung = parts.beschreibung.join(' ');
  row.statusCol1 = parts.status1.join(' ');
  row.statusCol2 = parts.status2.join(' ');
  row.bedingung = parts.bedingung.join(' ');

  return row;
}

// --- Section detection and building ---

function isTableHeader(row) {
  const combined = (row.segmentGroup + ' ' + row.beschreibung).toLowerCase();
  return combined.includes('edifact') && combined.includes('struktur');
}

function isPruefidentifikatorHeader(row) {
  // Section-level Prüfidentifikator headers have 5-digit numeric IDs in the status columns.
  // Data rows may contain "Prüfidentifikator" text but have "X", "Muss", etc. as status values.
  if (!row.beschreibung.toLowerCase().includes('prüfidentifikator')) return false;

  const hasNumericId = /^\d{5}$/.test(row.statusCol1.trim()) ||
    /^\d{5}$/.test(row.statusCol2.trim()) ||
    /^\d{5}\s+\d{5}$/.test(row.statusCol1.trim()) ||
    /^\d{5}\s+\d{5}$/.test(row.statusCol2.trim());

  return hasNumericId;
}

function isKommunikationVon(row) {
  return row.beschreibung.toLowerCase().includes('kommunikation von');
}

function isStatusColumnHeader(row) {
  const s1 = row.statusCol1.toLowerCase();
  const s2 = row.statusCol2.toLowerCase();
  const noEdifact = !row.segmentGroup && !row.segmentCode;
  return noEdifact && (
    s1.includes('meldung') || s1.includes('status') || s1.includes('antwort') ||
    s1.includes('bestellung') || s1.includes('mitteilung') || s1.includes('information') ||
    s1.includes('konfiguration') || s1.includes('meldung') || s1.includes('übermittlung')
  );
}

function hasEdifactContent(row) {
  return SEGMENT_GROUP_RE.test(row.segmentGroup) ||
    KNOWN_SEGMENTS.has(row.segmentCode) ||
    /^\d{4,5}$/.test(row.dataElement.trim());
}

function isDataRow(row) {
  return hasEdifactContent(row) ||
    (row.segmentGroup && row.segmentCode);
}

function isContinuationRow(row) {
  return !row.segmentGroup && !row.segmentCode && !row.dataElement &&
    (row.beschreibung || row.statusCol1 || row.statusCol2 || row.bedingung);
}

function isSectionLabel(row) {
  return !row.segmentGroup && !row.segmentCode && !row.dataElement &&
    row.beschreibung && !row.statusCol1 && !row.statusCol2;
}

function buildSections(allPages) {
  const sections = [];
  let current = null;
  let rows = [];
  let lastRow = null;
  let pendingTitle = '';

  function finalizeSection() {
    if (current) {
      current.rows = rows;
      sections.push(current);
      rows = [];
      lastRow = null;
    }
  }

  for (const { pageNum, items } of allPages) {
    const contentItems = items.filter(
      item => item.y < HEADER_Y_MIN && item.y > FOOTER_Y_MAX
    );
    if (contentItems.length === 0) continue;

    const pageRows = groupIntoRows(contentItems);

    for (const rowItems of pageRows) {
      const parsed = parseRow(rowItems);

      // Skip repeated table headers
      if (isTableHeader(parsed)) continue;

      // Detect Prüfidentifikator → new section or repeated page header
      if (isPruefidentifikatorHeader(parsed)) {
        const newPruef = [parsed.statusCol1, parsed.statusCol2].filter(Boolean).map(s => s.trim());
        const newPruefKey = newPruef.join(',');
        const currentPruefKey = current ? current.pruefidentifikator.join(',') : '';

        if (current && newPruefKey === currentPruefKey) {
          // Same Prüfidentifikator as current section → repeated page header, skip
          continue;
        }

        // Genuinely new section
        finalizeSection();
        current = {
          title: pendingTitle.trim(),
          pruefidentifikator: newPruef,
          kommunikationVon: [],
          statusCol1Header: '',
          statusCol2Header: '',
          pageStart: pageNum,
          rows: [],
        };
        pendingTitle = '';
        lastRow = null;
        continue;
      }

      // Kommunikation von row → section metadata (set once, skip repeats)
      if (isKommunikationVon(parsed) && current) {
        if (!current.kommunikationVon.length) {
          current.kommunikationVon = [parsed.statusCol1, parsed.statusCol2].filter(Boolean).map(s => s.trim());
        }
        continue;
      }

      // Status column header row (e.g., "Statusmeldung  Statusmeldung")
      if (isStatusColumnHeader(parsed) && current) {
        if (!current.statusCol1Header) {
          current.statusCol1Header = parsed.statusCol1.trim();
          current.statusCol2Header = parsed.statusCol2.trim();
        }
        continue;
      }

      if (!current) {
        // Before first section — capture text as potential section title
        if (parsed.beschreibung && !parsed.segmentGroup) {
          pendingTitle = parsed.beschreibung;
        }
        continue;
      }

      // Data row with EDIFACT content
      if (isDataRow(parsed)) {
        const dataRow = {
          segmentGroup: parsed.segmentGroup.trim(),
          segmentCode: parsed.segmentCode.trim(),
          dataElement: parsed.dataElement.trim(),
          beschreibung: parsed.beschreibung.trim(),
          statusCol1: parsed.statusCol1.trim(),
          statusCol2: parsed.statusCol2.trim(),
          bedingung: parsed.bedingung.trim(),
        };
        rows.push(dataRow);
        lastRow = dataRow;
        continue;
      }

      // Continuation of previous row (multi-line cell content)
      if (isContinuationRow(parsed) && lastRow) {
        if (parsed.beschreibung) {
          lastRow.beschreibung += ' ' + parsed.beschreibung.trim();
        }
        if (parsed.statusCol1) {
          lastRow.statusCol1 += ' ' + parsed.statusCol1.trim();
        }
        if (parsed.statusCol2) {
          lastRow.statusCol2 += ' ' + parsed.statusCol2.trim();
        }
        if (parsed.bedingung) {
          lastRow.bedingung += ' ' + parsed.bedingung.trim();
        }
        continue;
      }

      // Sub-section label (e.g., "Sendungsdaten", "Meldepunkt")
      if (isSectionLabel(parsed)) {
        const labelRow = {
          segmentGroup: '',
          segmentCode: '',
          dataElement: '',
          beschreibung: parsed.beschreibung.trim(),
          statusCol1: '',
          statusCol2: '',
          bedingung: '',
          isLabel: true,
        };
        rows.push(labelRow);
        lastRow = labelRow;
        // Also capture as potential next-section title
        pendingTitle = parsed.beschreibung;
        continue;
      }
    }
  }

  // Finalize last section
  finalizeSection();

  return sections;
}
