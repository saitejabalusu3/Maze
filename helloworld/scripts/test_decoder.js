#!/usr/bin/env node
const fs = require('node:fs/promises');
const path = require('node:path');
const pako = require('pako');
const zlib = require('node:zlib');

// Simple base64 decoder (from decode_kkk.js)
// Copy the base64 decode implementation from decoder.ts
const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const BASE64_LOOKUP = (() => {
  const table = new Uint8Array(256);
  table.fill(255);
  for (let i = 0; i < BASE64_ALPHABET.length; i += 1) {
    table[BASE64_ALPHABET.charCodeAt(i)] = i;
  }
  table['='.charCodeAt(0)] = 0;
  return table;
})();

function decodeBase64ToUint8Array(s) {
  // Remove whitespace
  s = s.replace(/\s/g, '');
  
  // Add padding if needed
  const pad = s.length % 4;
  if (pad) s += '='.repeat(4 - pad);
  
  // Decode to bytes
  const bytes = new Uint8Array((s.length * 3) >> 2);
  let pos = 0;
  
  for (let i = 0; i < s.length; i += 4) {
    const c0 = BASE64_LOOKUP[s.charCodeAt(i)];
    const c1 = BASE64_LOOKUP[s.charCodeAt(i + 1)];
    const c2 = BASE64_LOOKUP[s.charCodeAt(i + 2)];
    const c3 = BASE64_LOOKUP[s.charCodeAt(i + 3)];
    
    bytes[pos++] = (c0 << 2) | (c1 >> 4);
    if (c2 < 64) bytes[pos++] = (c1 << 4) | (c2 >> 2);
    if (c3 < 64) bytes[pos++] = (c2 << 6) | c3;
  }
  
  return bytes;
}

function tryParseBase64ZlibJson(str) {
  console.log('Decoding base64:', str);
  const bytes = decodeBase64ToUint8Array(str);
  console.log('Decoded bytes:', bytes.length, 'first 4:', [...bytes.slice(0, 4)]);
  
  // Try options for deflate/raw modes
  const inflateOptions = [
    { raw: true },
    { raw: false },
    { windowBits: -15 },
    { windowBits: 15 },
    { windowBits: 0 },
  ];

  for (const opts of inflateOptions) {
    try {
      console.log('\nTrying pako with options:', opts);
      const inflated = pako.inflate(bytes, opts);
      console.log('Inflated bytes:', inflated.length);
      const text = Buffer.from(inflated).toString();
      console.log('Text:', text.slice(0, 100));
      try {
        return JSON.parse(text);
      } catch (e) {
        console.log('JSON parse failed:', e.message);
      }
    } catch (e) {
      console.log('Inflation failed:', e.message);
    }
  }

  // Try raw base64 decode as last resort
  try {
    const text = Buffer.from(bytes).toString();
    return JSON.parse(text);
  } catch (e) {
    console.error('Raw parse failed:', e);
    throw e;
  }
}

// ASCII grid preview
function printGrid(grid) {
  if (!Array.isArray(grid) || !grid.length || !Array.isArray(grid[0])) {
    console.log('Not a 2D grid');
    return;
  }
  const preview = grid.map(row => row.map(cell => cell ? '.' : '#').join('')).join('\n');
  console.log(preview);
}

// Test each puzzle in the file
async function run() {
  const puzzlesPath = path.join(__dirname, '..', 'assets', 'puzzles.jsonl');
  console.log('Reading puzzles from', puzzlesPath);

  const puzzles = (await fs.readFile(puzzlesPath, 'utf8'))
    .trim()
    .split('\n')
    .map(line => JSON.parse(line))
    .filter(Boolean);

  console.log(`Found ${puzzles.length} puzzles`);
  
  // Test specific puzzle
  const index = 0; // Change this to test different puzzles
  const puzzle = puzzles[index];
  
  console.log(`\nTesting puzzle #${index}:`);
  console.log('Grid:', puzzle.g);
  
  const data = tryParseBase64ZlibJson(puzzle.g);
  console.log('Decoded:', JSON.stringify(data, null, 2));

  // Preview grid
  console.log('\nParsed grid (ASCII view):');

  // Preview grid as ASCII
  if (Array.isArray(data)) {
    for (const row of data) {
      console.log(row.map(cell => cell ? '.' : '#').join(''));
    }
  }
}

run().catch(console.error);