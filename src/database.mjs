import fs from 'fs';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';

// sql.js needs dynamic import for WASM
let SQL;

export async function initDatabase() {
  const initSqlJs = (await import('sql.js')).default;
  SQL = await initSqlJs();
}

/**
 * Create a new in-memory database with schema.
 */
export function createDatabase() {
  const db = new SQL.Database();
  db.run(SCHEMA);
  return db;
}

/**
 * Load a database from a file.
 */
export function loadDatabase(filePath) {
  const buffer = fs.readFileSync(filePath);
  return new SQL.Database(buffer);
}

/**
 * Save database to a file.
 */
export function saveDatabase(db, filePath) {
  const data = db.export();
  fs.writeFileSync(filePath, Buffer.from(data));
}

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    version TEXT NOT NULL,
    filename TEXT NOT NULL,
    page_count INTEGER,
    parsed_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    document_id INTEGER NOT NULL,
    section_order INTEGER NOT NULL,
    title TEXT,
    pruefidentifikator TEXT NOT NULL,
    kommunikation_von TEXT,
    status_col1_header TEXT,
    status_col2_header TEXT,
    page_start INTEGER,
    FOREIGN KEY (document_id) REFERENCES documents(id)
  );

  CREATE TABLE IF NOT EXISTS rows (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    section_id INTEGER NOT NULL,
    row_order INTEGER NOT NULL,
    segment_group TEXT,
    segment_code TEXT,
    data_element TEXT,
    beschreibung TEXT,
    status_col1 TEXT,
    status_col2 TEXT,
    bedingung TEXT,
    is_label INTEGER DEFAULT 0,
    FOREIGN KEY (section_id) REFERENCES sections(id)
  );

  CREATE INDEX IF NOT EXISTS idx_sections_document ON sections(document_id);
  CREATE INDEX IF NOT EXISTS idx_sections_pruefid ON sections(pruefidentifikator);
  CREATE INDEX IF NOT EXISTS idx_rows_section ON rows(section_id);
`;

/**
 * Insert a parsed document into the database.
 * @param {object} db - sql.js Database instance
 * @param {string} filename - Source PDF filename
 * @param {object} parsed - Output from parsePDF()
 * @returns {number} document ID
 */
export function insertDocument(db, filename, parsed) {
  db.run(
    `INSERT INTO documents (version, filename, page_count) VALUES (?, ?, ?)`,
    [parsed.version, filename, parsed.pageCount]
  );

  const docId = db.exec(`SELECT last_insert_rowid() as id`)[0].values[0][0];

  const sectionStmt = db.prepare(`
    INSERT INTO sections (document_id, section_order, title, pruefidentifikator,
      kommunikation_von, status_col1_header, status_col2_header, page_start)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const rowStmt = db.prepare(`
    INSERT INTO rows (section_id, row_order, segment_group, segment_code,
      data_element, beschreibung, status_col1, status_col2, bedingung, is_label)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (let si = 0; si < parsed.sections.length; si++) {
    const section = parsed.sections[si];

    sectionStmt.run([
      docId,
      si,
      section.title || '',
      section.pruefidentifikator.join(','),
      section.kommunikationVon.join(','),
      section.statusCol1Header || '',
      section.statusCol2Header || '',
      section.pageStart || 0,
    ]);

    const sectionId = db.exec(`SELECT last_insert_rowid() as id`)[0].values[0][0];

    for (let ri = 0; ri < section.rows.length; ri++) {
      const row = section.rows[ri];
      rowStmt.run([
        sectionId,
        ri,
        row.segmentGroup || '',
        row.segmentCode || '',
        row.dataElement || '',
        row.beschreibung || '',
        row.statusCol1 || '',
        row.statusCol2 || '',
        row.bedingung || '',
        row.isLabel ? 1 : 0,
      ]);
    }
  }

  sectionStmt.free();
  rowStmt.free();

  return docId;
}

/**
 * Get all sections for a document.
 */
export function getSections(db, documentId) {
  const result = db.exec(
    `SELECT id, section_order, title, pruefidentifikator, kommunikation_von,
            status_col1_header, status_col2_header, page_start
     FROM sections WHERE document_id = ? ORDER BY section_order`,
    [documentId]
  );

  if (!result.length) return [];

  return result[0].values.map(row => ({
    id: row[0],
    sectionOrder: row[1],
    title: row[2],
    pruefidentifikator: row[3],
    kommunikationVon: row[4],
    statusCol1Header: row[5],
    statusCol2Header: row[6],
    pageStart: row[7],
  }));
}

/**
 * Get all rows for a section.
 */
export function getRows(db, sectionId) {
  const result = db.exec(
    `SELECT id, row_order, segment_group, segment_code, data_element,
            beschreibung, status_col1, status_col2, bedingung, is_label
     FROM rows WHERE section_id = ? ORDER BY row_order`,
    [sectionId]
  );

  if (!result.length) return [];

  return result[0].values.map(row => ({
    id: row[0],
    rowOrder: row[1],
    segmentGroup: row[2],
    segmentCode: row[3],
    dataElement: row[4],
    beschreibung: row[5],
    statusCol1: row[6],
    statusCol2: row[7],
    bedingung: row[8],
    isLabel: row[9] === 1,
  }));
}

/**
 * Get document metadata.
 */
export function getDocument(db, documentId) {
  const result = db.exec(
    `SELECT id, version, filename, page_count, parsed_at
     FROM documents WHERE id = ?`,
    [documentId]
  );

  if (!result.length || !result[0].values.length) return null;

  const row = result[0].values[0];
  return {
    id: row[0],
    version: row[1],
    filename: row[2],
    pageCount: row[3],
    parsedAt: row[4],
  };
}

/**
 * Get summary stats for a document.
 */
export function getDocumentStats(db, documentId) {
  const sectionCount = db.exec(
    `SELECT COUNT(*) FROM sections WHERE document_id = ?`, [documentId]
  )[0].values[0][0];

  const rowCount = db.exec(
    `SELECT COUNT(*) FROM rows r
     JOIN sections s ON r.section_id = s.id
     WHERE s.document_id = ?`, [documentId]
  )[0].values[0][0];

  return { sectionCount, rowCount };
}
