const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function decodeBase64ToUint8Array(input) {
  const sanitized = input.replace(/\s/g, '');
  const padding = sanitized.endsWith('==') ? 2 : sanitized.endsWith('=') ? 1 : 0;
  const byteLength = (sanitized.length / 4) * 3 - padding;
  const output = new Uint8Array(byteLength);
  const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const table = new Uint8Array(256);
  table.fill(255);
  for (let i = 0; i < BASE64_ALPHABET.length; i += 1) table[BASE64_ALPHABET.charCodeAt(i)] = i;
  table['='.charCodeAt(0)] = 0;

  let outIndex = 0;
  for (let i = 0; i < sanitized.length; i += 4) {
    const a = table[sanitized.charCodeAt(i)];
    const b = table[sanitized.charCodeAt(i+1)];
    const c = table[sanitized.charCodeAt(i+2)];
    const d = table[sanitized.charCodeAt(i+3)];
    const chunk = (a << 18) | (b << 12) | (c << 6) | d;
    output[outIndex++] = (chunk >> 16) & 0xff;
    if (outIndex < byteLength) output[outIndex++] = (chunk >> 8) & 0xff;
    if (outIndex < byteLength) output[outIndex++] = chunk & 0xff;
  }

  // try inflate if looks like zlib
  try {
    const prefix = sanitized.slice(0,2);
    if (prefix === 'eJ') {
      const inflated = pako.inflate(output);
      if (inflated && inflated.length) return new Uint8Array(inflated);
    }
  } catch (e) {}
  return output;
}

function tryParseBase64ZlibJson(s) {
  try {
    const bytes = decodeBase64ToUint8Array(s);
    try {
      const inflated = zlib.inflateSync(Buffer.from(bytes));
      const text = Buffer.from(inflated).toString('utf8').trim();
      if (text.startsWith('[') || text.startsWith('{')) return JSON.parse(text);
    } catch (e) {
      // ignore
    }
    try {
      const text = Buffer.from(bytes).toString('utf8').trim();
      if (text.startsWith('[') || text.startsWith('{')) return JSON.parse(text);
    } catch (e) {}
  } catch (e) {}
  return null;
}

const assetPath = path.join(__dirname, '..', 'assets', 'kkk.jsonl');
const raw = fs.readFileSync(assetPath, 'utf8');
// extract first JSON object similar to the app (scan braces)
let depth = 0, inString=false, escape=false, start=-1, objects=[];
for (let i=0;i<raw.length;i++){
  const ch = raw[i];
  if (inString) {
    if (escape) { escape=false; } else if (ch === '\\') { escape=true; } else if (ch === '"') { inString=false; }
    continue;
  }
  if (ch === '"') { inString=true; continue; }
  if (ch === '{') { if (depth===0) start=i; depth++; continue; }
  if (ch === '}') { depth--; if (depth===0 && start!==-1){ objects.push(raw.slice(start,i+1)); start=-1;} }
}
console.log('Found', objects.length, 'objects');
const first = JSON.parse(objects[0]);
console.log('sample id', first.id, first.skillTier, first.difficulty);
const g = first.g;
const parsed = tryParseBase64ZlibJson(g);
console.log('parsed type', Array.isArray(parsed)?'array':'other');
if (Array.isArray(parsed)){
  console.log('grid dims', parsed.length, parsed[0].length);
  // assume expanded grid; produce ascii
  const rows = parsed.length, cols = parsed[0].length;
  for (let r=0;r<rows;r++){
    let line='';
    for (let c=0;c<cols;c++){
      line += parsed[r][c] ? ( (r%2===1 && c%2===1) ? 'o' : ((r%2===1 || c%2===1) ? '+' : '#') ) : ' ';
    }
    console.log(line);
  }
}

// also decode moves
const p = first.p;
const movesParsed = tryParseBase64ZlibJson(p);
console.log('movesParsed sample length', Array.isArray(movesParsed)?movesParsed.length:typeof movesParsed);

// compute openings using author-style expanded grid conversion (simple)
if (Array.isArray(parsed)){
  const h = first.h, w = first.w; const total = w*h; const out = new Uint8Array(total);
  const rows = parsed.length, cols = parsed[0].length;
  if (rows === 2*h+1 && cols === 2*w+1) {
    for (let r=0;r<h;r++){
      for (let c=0;c<w;c++){
        const idx = r*w+c; const centerR=2*r+1, centerC=2*c+1; let mask=0;
        const center = parsed[centerR][centerC];
        if (center) {
          if (centerR-2>=0 && parsed[centerR-1][centerC] && parsed[centerR-2][centerC]) mask|=1; // N
          if (centerC+2<cols && parsed[centerR][centerC+1] && parsed[centerR][centerC+2]) mask|=2; // E
          if (centerR+2<rows && parsed[centerR+1][centerC] && parsed[centerR+2][centerC]) mask|=4; // S
          if (centerC-2>=0 && parsed[centerR][centerC-1] && parsed[centerR][centerC-2]) mask|=8; // W
        }
        out[idx]=mask;
      }
    }
    console.log('start mask', out[0]);
    console.log('goal mask', out[w*h-1]);
    // print first row of masks
    let row=''; for (let c=0;c<w;c++) row+=out[c].toString(16); console.log('masks row hex', row);
  }
}
