export const DIRECTION_MASK = {
  N: 1,
  E: 2,
  S: 4,
  W: 8,
} as const;

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

/**
 * Browser-safe Base64 → Uint8Array decoder. Handles padding without using Node Buffer.
 */
// Use require to avoid TypeScript resolution issues if types aren't installed.
// We'll treat pako as any at runtime.
const pako: any = (() => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('pako');
  } catch (e) {
    return null;
  }
})();

// Try to parse a base64-encoded, zlib-deflated JSON payload (author-style).
// Returns the parsed JSON value or null on failure.
function tryParseBase64ZlibJson(s: string): any | null {
  try {
    const bytes = decodeBase64ToUint8Array(s);
    if (!pako) {
      console.warn('pako not available for zlib inflate');
      return null;
    }

    // Attempt to inflate the base64-decoded bytes as zlib data
    try {
      const inflated = pako.inflate(bytes);
      if (inflated && inflated.length) {
        const text = typeof TextDecoder !== 'undefined'
          ? new TextDecoder().decode(inflated)
          : String.fromCharCode.apply(null, Array.from(inflated));
        const result = JSON.parse(text);
        // console.info('Inflated JSON:', JSON.stringify(result).slice(0, 100));
        return result;
      }
    } catch (e) {
      // Not zlib data or invalid JSON, try parsing raw bytes
      try {
        const text = typeof TextDecoder !== 'undefined'
          ? new TextDecoder().decode(bytes)
          : String.fromCharCode.apply(null, Array.from(bytes));
        return JSON.parse(text);
      } catch (e2) {
        // Neither worked - return null to trigger fallback
        return null;
      }
    }
  } catch (e) {
    return null;
  }
  return null;
}

export function decodeBase64ToUint8Array(input: string): Uint8Array {
  const sanitized = input.replace(/\s/g, '');
  if (sanitized.length % 4 !== 0) {
    throw new Error('Invalid base64 input length.');
  }
  // decode base64 -> raw bytes
  const padding = sanitized.endsWith('==') ? 2 : sanitized.endsWith('=') ? 1 : 0;
  const byteLength = (sanitized.length / 4) * 3 - padding;
  const output = new Uint8Array(byteLength);

  let outIndex = 0;
  for (let i = 0; i < sanitized.length; i += 4) {
    const a = BASE64_LOOKUP[sanitized.charCodeAt(i)];
    const b = BASE64_LOOKUP[sanitized.charCodeAt(i + 1)];
    const c = BASE64_LOOKUP[sanitized.charCodeAt(i + 2)];
    const d = BASE64_LOOKUP[sanitized.charCodeAt(i + 3)];
    const chunk = (a << 18) | (b << 12) | (c << 6) | d;
    output[outIndex++] = (chunk >> 16) & 0xff;
    if (outIndex < byteLength) output[outIndex++] = (chunk >> 8) & 0xff;
    if (outIndex < byteLength) output[outIndex++] = chunk & 0xff;
  }

  // Many maze datasets store compressed blobs (zlib) which when base64-encoded
  // start with 'eJ'. Try to detect and inflate; if inflation fails, return raw.
  try {
    // Peek first two bytes for 0x78 0x9c ('x\x9c') sequence which commonly appears
    // after base64 -> bytes when data is zlib-deflated (may vary). Also many
    // serialized strings start with ASCII 'eJ' when base64-encoding compressed zlib
    // data; check input prefix as a heuristic.
    const prefix = sanitized.slice(0, 2);
    if (prefix === 'eJ') {
      // attempt inflate via pako
      const inflated = pako.inflate(output);
      if (inflated && inflated.length) {
        return new Uint8Array(inflated);
      }
    }
  } catch (err) {
    // fall through to return raw bytes
  }

  return output;
}

// Helper to ensure symmetry of openings and minimal playability guarantees
function normalizeOpenings(openings: Uint8Array, w: number, h: number) {
  const N = DIRECTION_MASK.N;
  const E = DIRECTION_MASK.E;
  const S = DIRECTION_MASK.S;
  const W = DIRECTION_MASK.W;
  // enforce symmetry between adjacent cells
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const idx = y * w + x;
      // Strip any directional bits that point outside the grid bounds.
      let mask = openings[idx] ?? 0;
      if (x === 0) mask &= ~W; // can't have West on left-most column
      if (x === w - 1) mask &= ~E; // can't have East on right-most column
      if (y === 0) mask &= ~N; // can't have North on top row
      if (y === h - 1) mask &= ~S; // can't have South on bottom row
      openings[idx] = mask;
      // east-west
      if (x < w - 1) {
        const rightIdx = idx + 1;
        const rightMask = openings[rightIdx] ?? 0;
        if ((mask & E) && !(rightMask & W)) openings[rightIdx] = rightMask | W;
        if ((rightMask & W) && !(mask & E)) openings[idx] = mask | E;
      }
      // north-south
      if (y < h - 1) {
        const downIdx = idx + w;
        const downMask = openings[downIdx] ?? 0;
        if ((mask & S) && !(downMask & N)) openings[downIdx] = downMask | N;
        if ((downMask & N) && !(mask & S)) openings[idx] = mask | S;
      }
    }
  }

  // Ensure start cell has at least one opening
  const startIdx = 0;
  if ((openings[startIdx] ?? 0) === 0) {
    if (w > 1) {
      openings[startIdx] |= E;
      openings[startIdx + 1] |= W;
    } else if (h > 1) {
      openings[startIdx] |= S;
      openings[w] |= N;
    }
  }

  // Ensure goal cell has at least one opening
  const goalIdx = (h - 1) * w + (w - 1);
  if ((openings[goalIdx] ?? 0) === 0) {
    if (w > 1) {
      openings[goalIdx] |= W;
      openings[goalIdx - 1] |= E;
    } else if (h > 1) {
      openings[goalIdx] |= N;
      openings[goalIdx - w] |= S;
    }
  }

  return openings;
}

// Author format uses expanded grid with double-width passages + walls.
// Expand the input size to accommodate walls and normalize back to per-cell.
// Convert an expanded (2w+1 × 2h+1) grid of 0/1 into per-cell opening masks.
// Each cell in the expanded grid represents either a wall (0) or passage (1).
// We look at odd-indexed positions for cell centers and check their adjacent
// passages to determine openings.
function convertExpandedToRegular(expandedGrid: number[][], w: number, h: number): Uint8Array {
  const openings = new Uint8Array(w * h);
  
  // For each regular cell, look at its expanded position and check openings
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // Map to expanded grid coordinates (cell centers at odd indices)
      const r = 2 * y + 1;
      const c = 2 * x + 1;
      
      // Only process if this is a valid cell (has a center)
      if (r < expandedGrid.length && c < expandedGrid[0].length && expandedGrid[r][c]) {
        let mask = 0;
        
        // Check each direction by looking at the passage and next cell
        // North: we need (r-1) passage and (r-2) cell
        if (r >= 2 && expandedGrid[r-1][c] && expandedGrid[r-2][c]) {
          mask |= DIRECTION_MASK.N;
        }
        // East: we need (c+1) passage and (c+2) cell
        if (c <= expandedGrid[0].length - 3 && expandedGrid[r][c+1] && expandedGrid[r][c+2]) {
          mask |= DIRECTION_MASK.E;
        }
        // South: we need (r+1) passage and (r+2) cell
        if (r <= expandedGrid.length - 3 && expandedGrid[r+1][c] && expandedGrid[r+2][c]) {
          mask |= DIRECTION_MASK.S;
        }
        // West: we need (c-1) passage and (c-2) cell
        if (c >= 2 && expandedGrid[r][c-1] && expandedGrid[r][c-2]) {
          mask |= DIRECTION_MASK.W;
        }
        
        openings[y * w + x] = mask;
      }
    }
  }
  
  return openings;
}

/**
 * Decodes nibble-packed cell openings into per-cell masks.
 * MazeMin packs nibbles little-endian inside each byte (low then high).
 */
export function decodeOpenings(g: string, w: number, h: number): Uint8Array {
  const totalCells = w * h;
  // Try parsing as base64->zlib->JSON (the puzzles.jsonl format). If that
  // yields a JSON structure, convert from expanded grid to per-cell masks.
  // Fall back to the legacy nibble-packed format if needed.
  try {
    const parsed = tryParseBase64ZlibJson(g);
    if (parsed != null) {
      if (Array.isArray(parsed)) {
        // If first element is an array, assume 2D grid of passable (1) / wall (0)
        if (Array.isArray(parsed[0])) {
          const grid = parsed as number[][];
          const rows = grid.length;
          const cols = Array.isArray(grid[0]) ? grid[0].length : 0;
          console.info('Decoded grid:', rows, 'x', cols, 'for', w, 'x', h, 'maze');
          
          // Author format: expanded grid (2*h+1 × 2*w+1) where cells are at
          // odd indices and passages are marked with 1s.
          if (rows === 2 * h + 1 && cols === 2 * w + 1) {
            // Log the first few grid rows so we can verify the expanded format
            console.info('Grid preview (. = passage, # = wall):');
            console.info(grid.slice(0, 5).map(row => row.map(v => v ? '.' : '#').join('')).join('\n'));
            
            // Convert to per-cell openings and log the first few masks
            const converted = convertExpandedToRegular(grid, w, h);
            const firstRow = Array.from(converted.slice(0, w)).map(m => m.toString(16));
            console.info('First row masks:', firstRow.join(' '));
            
            return normalizeOpenings(converted, w, h);
          }
          console.warn('Grid size mismatch:', rows, cols, 'expected', 2*h+1, 2*w+1);
        }
      }
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('Failed to parse grid:', err);
  }

  // Legacy nibble-packed format (little-endian nibbles per byte)
  const bytes = decodeBase64ToUint8Array(g);
  const openings = new Uint8Array(totalCells);
  let cellIndex = 0;
  for (let i = 0; i < bytes.length && cellIndex < totalCells; i += 1) {
    const low = bytes[i] & 0x0f;
    openings[cellIndex++] = low & 0x0f;
    if (cellIndex >= totalCells) {
      break;
    }
    const high = bytes[i] >> 4;
    openings[cellIndex++] = high & 0x0f;
  }
  return openings;

}

/**
 * Decodes packed 2-bit directional moves (0=N,1=E,2=S,3=W) and clips to run length L.
 * Each byte is little-endian, so the lowest bits are read first.
 */
export function decodeMoves(p: string, L: number): number[] {
  // Prefer base64->zlib->JSON-encoded coordinate arrays (author-style).
  try {
    const parsed = tryParseBase64ZlibJson(p);
    if (parsed && Array.isArray(parsed) && parsed.length) {
      const coords: [number, number][] = parsed as [number, number][];
      const maxR = Math.max(...coords.map((c) => c[0]));
      const maxC = Math.max(...coords.map((c) => c[1]));
      let normCoords: [number, number][] = coords;
      if (maxR > L || maxC > L) {
        normCoords = coords
          .map(([r, c]) => {
            if (r % 2 === 1 && c % 2 === 1) {
              return [(r - 1) / 2, (c - 1) / 2];
            }
            return [r, c];
          })
          .filter((v) => v != null) as [number, number][];
      }

      const moves: number[] = [];
      for (let i = 0; i < normCoords.length - 1 && moves.length < L; i += 1) {
        const [r1, c1] = normCoords[i];
        const [r2, c2] = normCoords[i + 1];
        const dr = r2 - r1;
        const dc = c2 - c1;
        if (dr === -1 && dc === 0) moves.push(0);
        else if (dr === 0 && dc === 1) moves.push(1);
        else if (dr === 1 && dc === 0) moves.push(2);
        else if (dr === 0 && dc === -1) moves.push(3);
        else {
          // non-adjacent step — ignore
        }
      }
      return moves;
    }
  } catch (err) {
    // fall back to legacy packed 2-bit moves
  }

  // Legacy packed 2-bit moves per byte (little-endian).
  const bytes = decodeBase64ToUint8Array(p);
  const moves: number[] = [];
  for (let i = 0; i < bytes.length && moves.length < L; i += 1) {
    const byte = bytes[i];
    for (let shift = 0; shift <= 6 && moves.length < L; shift += 2) {
      moves.push((byte >> shift) & 0x03);
    }
  }
  return moves;
}
