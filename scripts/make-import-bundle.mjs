#!/usr/bin/env node
// Packs a folder of articles (and their images) into one import bundle file
// that can be uploaded on Admin → Import articles.
//
//   node scripts/make-import-bundle.mjs <folder> [out.json]
//
// Use it when someone sends you a pile of old posts: put them in a folder
// (Word, Markdown, HTML, CSV, a Blogger backup, plus images), run this, and
// hand the owner the single .json file. The app parses everything in the
// browser with the same rules as a normal upload, so nothing is lost.

import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, extname, basename } from 'node:path';

const [, , folder, out = 'import-bundle.json'] = process.argv;
if (!folder) {
  console.error('Usage: node scripts/make-import-bundle.mjs <folder> [out.json]');
  process.exit(1);
}

const TEXT = new Set(['.md', '.markdown', '.txt', '.html', '.htm', '.csv', '.xml', '.json']);
const BINARY = new Set(['.docx', '.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif']);
const TYPES = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif', '.avif': 'image/avif',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

const files = [];
const skipped = [];
function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (name.startsWith('.')) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) { walk(path); continue; }
    const ext = extname(name).toLowerCase();
    const rel = relative(folder, path);
    if (TEXT.has(ext)) files.push({ name: rel, text: readFileSync(path, 'utf8') });
    else if (BINARY.has(ext)) files.push({ name: rel, type: TYPES[ext], base64: readFileSync(path).toString('base64') });
    else skipped.push(rel);
  }
}
walk(folder);

const bundle = { format: 'endowed-import', version: 1, createdAt: new Date().toISOString(), files };
writeFileSync(out, JSON.stringify(bundle));
const mb = (Buffer.byteLength(JSON.stringify(bundle)) / 1024 / 1024).toFixed(1);
console.log(`Wrote ${out}: ${files.length} files, ${mb} MB.`);
if (skipped.length) console.log(`Skipped (unsupported): ${skipped.map((s) => basename(s)).join(', ')}`);
