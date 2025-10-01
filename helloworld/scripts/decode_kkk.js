#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function decodeBase64Deflate(s) {
  const buf = Buffer.from(s, 'base64');
  try {
    const out = zlib.inflateSync(buf);
    return JSON.parse(out.toString());
  } catch (e) {
    // try parsing raw utf8
    try {
      return JSON.parse(buf.toString());
    } catch (e2) {
      throw e;
    }
  }
}

function asciiPreview(grid, pathCoords, maxRows = 41, maxCols = 81) {
  const rows = grid.length;
  const cols = grid[0].length;
  const pr = Math.min(rows, maxRows);
  const pc = Math.min(cols, maxCols);
  const set = new Set((pathCoords || []).map(([r,c]) => `${r},${c}`));
  let out = '';
  for (let r = 0; r < pr; r++) {
    for (let c = 0; c < pc; c++) {
      if (set.has(`${r},${c}`)) out += '.'; // path
      else out += grid[r][c] === 1 ? ' ' : '#';
    }
    if (pc < cols) out += '…';
    out += '\n';
  }
  if (pr < rows) out += '…\n';
  return out;
}

function usage() {
  console.log('Usage: node scripts/decode_kkk.js [--file PATH] [--line N]');
  console.log('Defaults: --file=assets/kkk.jsonl --line=1');
}

function main() {
  const argv = process.argv.slice(2);
  let file = path.resolve(process.cwd(), 'assets/kkk.jsonl');
  let lineNum = 1;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--file' && argv[i+1]) { file = path.resolve(process.cwd(), argv[i+1]); i++; }
    else if (a.startsWith('--file=')) file = path.resolve(process.cwd(), a.split('=')[1]);
    else if (a === '--line' && argv[i+1]) { lineNum = parseInt(argv[i+1],10); i++; }
    else if (a.startsWith('--line=')) lineNum = parseInt(a.split('=')[1],10);
    else if (a === '--help' || a === '-h') { usage(); return; }
  }

  if (!fs.existsSync(file)) { console.error('File not found:', file); process.exit(2); }
  const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
  if (lineNum < 1 || lineNum > lines.length) { console.error('line out of range 1..', lines.length); process.exit(2); }
  const rec = JSON.parse(lines[lineNum-1]);
  console.log('Record summary: v=%s alg=%s w=%d h=%d L=%d skillTier=%s difficulty=%s id=%s', rec.v, rec.alg, rec.w, rec.h, rec.L, rec.skillTier, rec.difficulty, rec.id);

  let grid, decodedPath;
  try {
    grid = decodeBase64Deflate(rec.g);
  } catch (e) { console.error('Failed to decode g:', e.message); process.exit(3); }
  try {
    decodedPath = decodeBase64Deflate(rec.p);
  } catch (e) { console.error('Failed to decode p:', e.message); path = null; }

  console.log('Decoded grid type:', Array.isArray(grid) ? (Array.isArray(grid[0]) ? '2D' : 'flat') : typeof grid);
  if (Array.isArray(grid)) console.log('Decoded grid size:', grid.length, 'x', Array.isArray(grid[0]) ? grid[0].length : '(flat)');
  console.log('Path length L (decoded):', Array.isArray(decodedPath) ? decodedPath.length : 'null');
  if (Array.isArray(rec.hints)) console.log('Hints indices:', rec.hints);

  if (Array.isArray(grid) && Array.isArray(grid[0])) {
    console.log('\nASCII preview (path = . , passage = space, wall = #):\n');
    console.log(asciiPreview(grid, decodedPath));
  } else {
    console.log('\nGrid is not 2D array — sample values:', JSON.stringify(grid).slice(0,200));
  }
}

if (require.main === module) main();
