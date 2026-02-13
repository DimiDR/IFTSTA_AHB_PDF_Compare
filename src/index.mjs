import path from 'path';
import fs from 'fs';
import { parsePDF } from './parser.mjs';
import {
  initDatabase,
  createDatabase,
  saveDatabase,
  insertDocument,
  getDocument as getDoc,
  getDocumentStats,
} from './database.mjs';
import { compareDocuments } from './comparator.mjs';
import { generateHTMLReport } from './reporter.mjs';

const args = process.argv.slice(2);

if (args.length < 2 || args.includes('--help') || args.includes('-h')) {
  console.log(`
PDFCompare - Compare IFTSTA AHB PDF versions

Usage:
  node src/index.mjs <old.pdf> <new.pdf> [options]

Options:
  --output <file>   HTML report output path (default: report.html)
  --db <file>       SQLite database path (default: compare.sqlite)
  --verbose         Show detailed parsing progress
  --help, -h        Show this help

Example:
  node src/index.mjs Test/IFTSTA_AHB_2_0h_20250401.pdf Test/IFTSTA_AHB_2_1_Konsultationsfassung_20260202.pdf
  `);
  process.exit(0);
}

const pdf1Path = args[0];
const pdf2Path = args[1];
const outputPath = getArg(args, '--output') || 'report.html';
const dbPath = getArg(args, '--db') || 'compare.sqlite';
const verbose = args.includes('--verbose');

function getArg(args, flag) {
  const idx = args.indexOf(flag);
  return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : null;
}

function log(msg) {
  console.log(`[PDFCompare] ${msg}`);
}

function logVerbose(msg) {
  if (verbose) console.log(`  ${msg}`);
}

async function main() {
  // Validate inputs
  if (!fs.existsSync(pdf1Path)) {
    console.error(`Error: File not found: ${pdf1Path}`);
    process.exit(1);
  }
  if (!fs.existsSync(pdf2Path)) {
    console.error(`Error: File not found: ${pdf2Path}`);
    process.exit(1);
  }

  const startTime = Date.now();

  // 1. Initialize SQLite
  log('Initializing database...');
  await initDatabase();
  const db = createDatabase();

  // 2. Parse PDFs
  log(`Parsing old PDF: ${pdf1Path}`);
  const parsed1 = await parsePDF(pdf1Path);
  log(`  Version: ${parsed1.version}, Pages: ${parsed1.pageCount}, Sections: ${parsed1.sections.length}`);
  for (const s of parsed1.sections) {
    logVerbose(`  Section [${s.pruefidentifikator.join(',')}] - ${s.rows.length} rows`);
  }

  log(`Parsing new PDF: ${pdf2Path}`);
  const parsed2 = await parsePDF(pdf2Path);
  log(`  Version: ${parsed2.version}, Pages: ${parsed2.pageCount}, Sections: ${parsed2.sections.length}`);
  for (const s of parsed2.sections) {
    logVerbose(`  Section [${s.pruefidentifikator.join(',')}] - ${s.rows.length} rows`);
  }

  // 3. Store in database
  log('Storing in database...');
  const docId1 = insertDocument(db, path.basename(pdf1Path), parsed1);
  const docId2 = insertDocument(db, path.basename(pdf2Path), parsed2);

  // 4. Save database
  saveDatabase(db, dbPath);
  log(`Database saved: ${dbPath}`);

  // 5. Compare
  log('Comparing documents...');
  const comparison = compareDocuments(db, docId1, docId2);

  const { summary } = comparison;
  log(`  Sections: ${summary.modified} modified, ${summary.added} added, ${summary.removed} removed, ${summary.unchanged} unchanged`);

  // Count row-level changes
  let rowStats = { added: 0, removed: 0, modified: 0, unchanged: 0 };
  for (const sd of comparison.sectionDiffs) {
    for (const rd of sd.rows || []) {
      rowStats[rd.type] = (rowStats[rd.type] || 0) + 1;
    }
  }
  log(`  Rows: ${rowStats.modified} modified, ${rowStats.added} added, ${rowStats.removed} removed, ${rowStats.unchanged} unchanged`);

  // 6. Generate report
  log(`Generating report: ${outputPath}`);
  const doc1Meta = getDoc(db, docId1);
  const doc2Meta = getDoc(db, docId2);
  const stats1 = getDocumentStats(db, docId1);
  const stats2 = getDocumentStats(db, docId2);

  generateHTMLReport(comparison, doc1Meta, doc2Meta, stats1, stats2, outputPath);

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  log(`Done in ${elapsed}s. Open ${outputPath} in a browser to view the report.`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
