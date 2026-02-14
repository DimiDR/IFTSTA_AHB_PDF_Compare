import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { parsePDF } from './parser.mjs';
import {
  initDatabase,
  createDatabase,
  insertDocument,
  getDocument as getDoc,
  getDocumentStats,
} from './database.mjs';
import { compareDocuments } from './comparator.mjs';
import { buildHTML } from './reporter.mjs';

const app = express();
const PORT = process.env.PORT || 3000;

// Temp directory for uploads and URL downloads
const tmpDir = path.join(os.tmpdir(), 'pdfcompare');
fs.mkdirSync(tmpDir, { recursive: true });

const upload = multer({ dest: tmpDir });

// Initialize sql.js once at startup
let dbReady = false;
initDatabase().then(() => { dbReady = true; });

// Serve the upload page
app.get('/', (_req, res) => {
  res.type('html').send(PAGE_HTML);
});

// Compare endpoint
app.post(
  '/api/compare',
  upload.fields([{ name: 'file1', maxCount: 1 }, { name: 'file2', maxCount: 1 }]),
  async (req, res) => {
    const tempFiles = [];
    try {
      if (!dbReady) {
        return res.status(503).json({ error: 'Database engine still initializing, please retry.' });
      }

      // Resolve PDF paths: uploaded file or URL download
      const pdf1Path = await resolvePDF(req, 'file1', 'url1', tempFiles);
      const pdf2Path = await resolvePDF(req, 'file2', 'url2', tempFiles);

      if (!pdf1Path || !pdf2Path) {
        return res.status(400).json({ error: 'Please provide two PDFs (via file upload or URL).' });
      }

      // Run the comparison pipeline
      const db = createDatabase();

      const parsed1 = await parsePDF(pdf1Path);
      const parsed2 = await parsePDF(pdf2Path);

      const name1 = req.files?.file1?.[0]?.originalname || filenameFromUrl(req.body.url1) || 'old.pdf';
      const name2 = req.files?.file2?.[0]?.originalname || filenameFromUrl(req.body.url2) || 'new.pdf';

      const docId1 = insertDocument(db, name1, parsed1);
      const docId2 = insertDocument(db, name2, parsed2);

      const comparison = compareDocuments(db, docId1, docId2);

      const doc1Meta = getDoc(db, docId1);
      const doc2Meta = getDoc(db, docId2);
      const stats1 = getDocumentStats(db, docId1);
      const stats2 = getDocumentStats(db, docId2);

      const html = buildHTML(comparison, doc1Meta, doc2Meta, stats1, stats2);

      res.type('html').send(html);
    } catch (err) {
      console.error('Comparison error:', err);
      res.status(500).json({ error: err.message || 'Comparison failed.' });
    } finally {
      // Clean up temp files
      for (const f of tempFiles) {
        try { fs.unlinkSync(f); } catch { /* ignore */ }
      }
      // Clean up multer uploads
      for (const key of ['file1', 'file2']) {
        const file = req.files?.[key]?.[0];
        if (file) {
          try { fs.unlinkSync(file.path); } catch { /* ignore */ }
        }
      }
    }
  }
);

async function resolvePDF(req, fileField, urlField, tempFiles) {
  // Prefer uploaded file
  const uploaded = req.files?.[fileField]?.[0];
  if (uploaded) return uploaded.path;

  // Fall back to URL
  const url = req.body?.[urlField];
  if (url) return await downloadPDF(url, tempFiles);

  return null;
}

async function downloadPDF(url, tempFiles) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download ${url}: ${response.status} ${response.statusText}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  const tmpFile = path.join(tmpDir, `dl_${Date.now()}_${Math.random().toString(36).slice(2)}.pdf`);
  fs.writeFileSync(tmpFile, buffer);
  tempFiles.push(tmpFile);
  return tmpFile;
}

function filenameFromUrl(url) {
  if (!url) return null;
  try {
    const pathname = new URL(url).pathname;
    return path.basename(pathname) || null;
  } catch {
    return null;
  }
}

app.listen(PORT, () => {
  console.log(`[PDFCompare] Web UI running at http://localhost:${PORT}`);
});

// ─── Embedded Upload Page ────────────────────────────────────────────────────

const PAGE_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>PDFCompare</title>
  <style>
    :root {
      --primary: #2563eb;
      --primary-hover: #1d4ed8;
      --green: #22863a;
      --green-bg: #dcffe4;
      --red: #cb2431;
      --red-bg: #ffeef0;
      --gray: #586069;
      --gray-bg: #f6f8fa;
      --border: #d1d5db;
      --border-focus: #2563eb;
      --bg: #f9fafb;
      --card-bg: #ffffff;
      --radius: 12px;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
      line-height: 1.5;
      color: #1f2937;
      background: var(--bg);
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 24px;
    }

    .container {
      width: 100%;
      max-width: 900px;
    }

    header {
      text-align: center;
      margin-bottom: 32px;
    }
    header h1 {
      font-size: 32px;
      font-weight: 700;
      color: #111827;
    }
    header p {
      color: var(--gray);
      font-size: 15px;
      margin-top: 4px;
    }

    .panels {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 20px;
      margin-bottom: 24px;
    }

    .panel {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 20px;
    }
    .panel h2 {
      font-size: 15px;
      font-weight: 600;
      color: var(--gray);
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 12px;
    }

    .drop-zone {
      border: 2px dashed var(--border);
      border-radius: 8px;
      padding: 32px 16px;
      text-align: center;
      cursor: pointer;
      transition: all 0.2s;
      background: var(--bg);
      position: relative;
    }
    .drop-zone:hover, .drop-zone.dragover {
      border-color: var(--primary);
      background: #eff6ff;
    }
    .drop-zone.has-file {
      border-color: var(--green);
      background: var(--green-bg);
      border-style: solid;
    }
    .drop-zone input[type="file"] {
      position: absolute;
      inset: 0;
      opacity: 0;
      cursor: pointer;
    }
    .drop-zone .icon {
      font-size: 36px;
      margin-bottom: 8px;
      display: block;
      color: #9ca3af;
    }
    .drop-zone.has-file .icon {
      color: var(--green);
    }
    .drop-zone .label {
      font-size: 14px;
      color: var(--gray);
    }
    .drop-zone .filename {
      font-size: 14px;
      font-weight: 600;
      color: var(--green);
      word-break: break-all;
    }

    .divider {
      display: flex;
      align-items: center;
      gap: 10px;
      margin: 14px 0;
      color: var(--gray);
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 1px;
    }
    .divider::before, .divider::after {
      content: '';
      flex: 1;
      height: 1px;
      background: var(--border);
    }

    .url-input {
      width: 100%;
      padding: 10px 12px;
      border: 1px solid var(--border);
      border-radius: 8px;
      font-size: 14px;
      font-family: inherit;
      outline: none;
      transition: border-color 0.2s;
    }
    .url-input:focus {
      border-color: var(--border-focus);
      box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.1);
    }
    .url-input.has-url {
      border-color: var(--green);
      background: var(--green-bg);
    }

    .actions {
      text-align: center;
    }

    .btn-compare {
      background: var(--primary);
      color: #fff;
      border: none;
      padding: 14px 48px;
      font-size: 16px;
      font-weight: 600;
      border-radius: 8px;
      cursor: pointer;
      transition: all 0.2s;
      font-family: inherit;
    }
    .btn-compare:hover:not(:disabled) {
      background: var(--primary-hover);
      transform: translateY(-1px);
      box-shadow: 0 4px 12px rgba(37, 99, 235, 0.3);
    }
    .btn-compare:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .status {
      text-align: center;
      margin-top: 16px;
      font-size: 14px;
      min-height: 24px;
    }
    .status.error {
      color: var(--red);
    }
    .status.loading {
      color: var(--primary);
    }

    .spinner {
      display: inline-block;
      width: 18px;
      height: 18px;
      border: 2px solid #e5e7eb;
      border-top-color: var(--primary);
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
      vertical-align: middle;
      margin-right: 8px;
    }
    @keyframes spin { to { transform: rotate(360deg); } }

    .clear-btn {
      position: absolute;
      top: 8px;
      right: 8px;
      background: none;
      border: none;
      font-size: 18px;
      cursor: pointer;
      color: var(--gray);
      z-index: 2;
      padding: 2px 6px;
      border-radius: 4px;
    }
    .clear-btn:hover {
      background: rgba(0,0,0,0.08);
    }

    footer {
      text-align: center;
      margin-top: 32px;
      color: #9ca3af;
      font-size: 13px;
    }

    @media (max-width: 640px) {
      .panels { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>PDFCompare</h1>
      <p>Compare two IFTSTA AHB PDF versions side by side</p>
    </header>

    <form id="compareForm">
      <div class="panels">
        <div class="panel">
          <h2>Old Version</h2>
          <div class="drop-zone" id="dropZone1">
            <input type="file" accept=".pdf" id="fileInput1" name="file1">
            <span class="icon">\u{1F4C4}</span>
            <span class="label">Drag &amp; drop PDF or click to browse</span>
          </div>
          <div class="divider">or paste a URL</div>
          <input type="text" class="url-input" id="urlInput1" name="url1" placeholder="https://example.com/old-version.pdf">
        </div>

        <div class="panel">
          <h2>New Version</h2>
          <div class="drop-zone" id="dropZone2">
            <input type="file" accept=".pdf" id="fileInput2" name="file2">
            <span class="icon">\u{1F4C4}</span>
            <span class="label">Drag &amp; drop PDF or click to browse</span>
          </div>
          <div class="divider">or paste a URL</div>
          <input type="text" class="url-input" id="urlInput2" name="url2" placeholder="https://example.com/new-version.pdf">
        </div>
      </div>

      <div class="actions">
        <button type="submit" class="btn-compare" id="btnCompare">Compare</button>
      </div>
      <div class="status" id="status"></div>
    </form>

    <footer>
      <p>PDFCompare &mdash; Upload files or provide URLs to PDF documents</p>
    </footer>
  </div>

  <script>
    // Drop zone logic
    function setupDropZone(zoneId, fileInputId, urlInputId) {
      const zone = document.getElementById(zoneId);
      const fileInput = document.getElementById(fileInputId);
      const urlInput = document.getElementById(urlInputId);

      zone.addEventListener('dragover', (e) => {
        e.preventDefault();
        zone.classList.add('dragover');
      });

      zone.addEventListener('dragleave', () => {
        zone.classList.remove('dragover');
      });

      zone.addEventListener('drop', (e) => {
        e.preventDefault();
        zone.classList.remove('dragover');
        const files = e.dataTransfer.files;
        if (files.length > 0 && files[0].type === 'application/pdf') {
          fileInput.files = files;
          showFile(zone, files[0].name);
          urlInput.value = '';
          urlInput.classList.remove('has-url');
        }
      });

      fileInput.addEventListener('change', () => {
        if (fileInput.files.length > 0) {
          showFile(zone, fileInput.files[0].name);
          urlInput.value = '';
          urlInput.classList.remove('has-url');
        }
      });

      urlInput.addEventListener('input', () => {
        if (urlInput.value.trim()) {
          urlInput.classList.add('has-url');
          // Clear file selection when URL is typed
          fileInput.value = '';
          zone.classList.remove('has-file');
          zone.querySelector('.icon').textContent = '\\u{1F4C4}';
          zone.querySelector('.label').style.display = '';
          const fn = zone.querySelector('.filename');
          if (fn) fn.remove();
          const cb = zone.querySelector('.clear-btn');
          if (cb) cb.remove();
        } else {
          urlInput.classList.remove('has-url');
        }
      });
    }

    function showFile(zone, name) {
      zone.classList.add('has-file');
      zone.querySelector('.icon').textContent = '\\u2705';
      zone.querySelector('.label').style.display = 'none';

      let fn = zone.querySelector('.filename');
      if (!fn) {
        fn = document.createElement('span');
        fn.className = 'filename';
        zone.appendChild(fn);
      }
      fn.textContent = name;

      // Add clear button
      let cb = zone.querySelector('.clear-btn');
      if (!cb) {
        cb = document.createElement('button');
        cb.type = 'button';
        cb.className = 'clear-btn';
        cb.textContent = '\\u2715';
        cb.addEventListener('click', (e) => {
          e.stopPropagation();
          clearZone(zone);
        });
        zone.appendChild(cb);
      }
    }

    function clearZone(zone) {
      zone.classList.remove('has-file');
      zone.querySelector('.icon').textContent = '\\u{1F4C4}';
      zone.querySelector('.label').style.display = '';
      const fn = zone.querySelector('.filename');
      if (fn) fn.remove();
      const cb = zone.querySelector('.clear-btn');
      if (cb) cb.remove();
      zone.querySelector('input[type="file"]').value = '';
    }

    setupDropZone('dropZone1', 'fileInput1', 'urlInput1');
    setupDropZone('dropZone2', 'fileInput2', 'urlInput2');

    // Form submission
    const form = document.getElementById('compareForm');
    const btn = document.getElementById('btnCompare');
    const status = document.getElementById('status');

    form.addEventListener('submit', async (e) => {
      e.preventDefault();

      const file1 = document.getElementById('fileInput1').files[0];
      const file2 = document.getElementById('fileInput2').files[0];
      const url1 = document.getElementById('urlInput1').value.trim();
      const url2 = document.getElementById('urlInput2').value.trim();

      const has1 = file1 || url1;
      const has2 = file2 || url2;

      if (!has1 || !has2) {
        status.className = 'status error';
        status.textContent = 'Please provide both PDFs (file or URL for each).';
        return;
      }

      btn.disabled = true;
      status.className = 'status loading';
      status.innerHTML = '<span class="spinner"></span> Comparing PDFs... this may take a moment.';

      try {
        const formData = new FormData();
        if (file1) formData.append('file1', file1);
        else formData.append('url1', url1);
        if (file2) formData.append('file2', file2);
        else formData.append('url2', url2);

        const response = await fetch('/api/compare', {
          method: 'POST',
          body: formData,
        });

        if (!response.ok) {
          let msg = 'Comparison failed.';
          try {
            const err = await response.json();
            msg = err.error || msg;
          } catch { /* ignore */ }
          throw new Error(msg);
        }

        const html = await response.text();

        // Open report in new window
        const reportWindow = window.open('', '_blank');
        if (reportWindow) {
          reportWindow.document.open();
          reportWindow.document.write(html);
          reportWindow.document.close();
          status.className = 'status';
          status.textContent = 'Report opened in a new window.';
        } else {
          // Fallback: download as file
          const blob = new Blob([html], { type: 'text/html' });
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = 'report.html';
          a.click();
          URL.revokeObjectURL(a.href);
          status.className = 'status';
          status.textContent = 'Report downloaded (pop-up was blocked).';
        }
      } catch (err) {
        status.className = 'status error';
        status.textContent = err.message;
      } finally {
        btn.disabled = false;
      }
    });
  </script>
</body>
</html>`;
