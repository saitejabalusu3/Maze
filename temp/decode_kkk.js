#!/usr/bin/env node
const fs = require('fs');
const pathModule = require('path');
const zlib = require('zlib');

function decodeBase64Deflate(s) {
  const buf = Buffer.from(s, 'base64');
  const out = zlib.inflateSync(buf);
  return JSON.parse(out.toString());
}

function asciiPreview(grid, mazePath, maxRows = 41, maxCols = 81) {
  const rows = grid.length;
  const cols = grid[0].length;
  const pr = Math.min(rows, maxRows);
  const pc = Math.min(cols, maxCols);
  const set = new Set((mazePath || []).map(([r, c]) => `${r},${c}`));
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

function writeSvg(grid, mazePath, outFile) {
  const rows = grid.length;
  const cols = grid[0].length;
  const scale = Math.max(1, Math.floor(800 / Math.max(cols, rows)));
  const w = cols * scale;
  const h = rows * scale;
  const pathSet = new Set((mazePath || []).map(([r, c]) => `${r},${c}`));
  const parts = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${cols} ${rows}" shape-rendering="crispEdges">`);
  // background
  parts.push(`<rect width="100%" height="100%" fill="black" />`);
  // draw passages
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (grid[r][c] === 1) {
        const fill = pathSet.has(`${r},${c}`) ? '#ffcc00' : '#ffffff';
        parts.push(`<rect x="${c}" y="${r}" width="1" height="1" fill="${fill}" />`);
      }
    }
  }
  parts.push('</svg>');
  fs.writeFileSync(outFile, parts.join('\n'));
}

function usage() {
  console.log('Usage: node scripts/decode_kkk.js [--file PATH] [--line N] [--svg OUTFILE]');
  console.log('Defaults: --file=kkk.jsonl --line=1');
}

function main() {
  const argv = process.argv.slice(2);
  let file = pathModule.resolve(process.cwd(), 'kkk.jsonl');
  let lineNum = 1;
  let svgOut = null;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--file' && argv[i + 1]) { file = pathModule.resolve(process.cwd(), argv[i + 1]); i++; }
    else if (a.startsWith('--file=')) file = pathModule.resolve(process.cwd(), a.split('=')[1]);
    else if (a === '--line' && argv[i + 1]) { lineNum = parseInt(argv[i + 1], 10); i++; }
    else if (a.startsWith('--line=')) lineNum = parseInt(a.split('=')[1], 10);
    else if (a === '--svg' && argv[i + 1]) { svgOut = argv[i + 1]; i++; }
    else if (a.startsWith('--svg=')) svgOut = a.split('=')[1];
    else if (a === '--help' || a === '-h') { usage(); return; }
  }

  if (!fs.existsSync(file)) { console.error('File not found:', file); process.exit(2); }
  const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
  if (lineNum < 1 || lineNum > lines.length) { console.error('line out of range 1..', lines.length); process.exit(2); }
  const rec = JSON.parse(lines[lineNum - 1]);

  console.log(`Record id=${rec.id || ''} alg=${rec.alg} w=${rec.w} h=${rec.h} L=${rec.L} skillTier=${rec.skillTier} difficulty=${rec.difficulty}`);

  let grid, mazePath;
  try { grid = decodeBase64Deflate(rec.g); } catch (e) { console.error('Failed to decode g:', e.message); process.exit(3); }
  try { mazePath = decodeBase64Deflate(rec.p); } catch (e) { console.error('Failed to decode p:', e.message); mazePath = null; }

  console.log('Decoded grid size:', grid.length, 'x', grid[0].length);
  console.log('Path length:', Array.isArray(mazePath) ? mazePath.length : 'null');
  if (Array.isArray(rec.hints)) console.log('Hints indices:', rec.hints);

  console.log('\nASCII preview (path = . , passage = space, wall = #):\n');
  console.log(asciiPreview(grid, mazePath, 80, 160));

  if (svgOut) {
    const outFile = pathModule.resolve(process.cwd(), svgOut || `decoded_${lineNum}.svg`);
    writeSvg(grid, mazePath, outFile);
    console.log('Wrote SVG to', outFile);
  }
}

if (require.main === module) main();
