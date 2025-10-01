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
    try { return JSON.parse(buf.toString()); } catch (e2) { throw e; }
  }
}

function computeMasksFromGrid(grid, w, h) {
  const DIRECTION_MASK = { N:1, E:2, S:4, W:8 };
  const total = w*h;
  const out = new Uint8Array(total);
  const rows = grid.length;
  const cols = grid[0].length;
  if (rows === 2*h+1 && cols === 2*w+1) {
    for (let r=0;r<h;r++){
      for (let c=0;c<w;c++){
        const idx = r*w+c;
        const centerR = 2*r+1; const centerC = 2*c+1;
        const centerPassable = grid[centerR] && grid[centerR][centerC] ? 1:0;
        let mask=0;
        if (centerPassable) {
          if (grid[centerR-1] && grid[centerR-1][centerC]) mask |= DIRECTION_MASK.N;
          if (grid[centerR][centerC+1]) mask |= DIRECTION_MASK.E;
          if (grid[centerR+1] && grid[centerR+1][centerC]) mask |= DIRECTION_MASK.S;
          if (grid[centerR][centerC-1]) mask |= DIRECTION_MASK.W;
        }
        out[idx]=mask;
      }
    }
  } else {
    for (let r=0;r<Math.min(rows,h);r++){
      for (let c=0;c<Math.min(grid[r].length,w);c++){
        const idx = r*w+c;
        const cellPassable = grid[r][c] ? 1:0;
        let mask=0;
        if (cellPassable){
          if (r>0 && grid[r-1] && grid[r-1][c]) mask |= DIRECTION_MASK.N;
          if (c<w-1 && grid[r][c+1]) mask |= DIRECTION_MASK.E;
          if (r<h-1 && grid[r+1] && grid[r+1][c]) mask |= DIRECTION_MASK.S;
          if (c>0 && grid[r][c-1]) mask |= DIRECTION_MASK.W;
        }
        out[idx]=mask;
      }
    }
  }
  return out;
}

function printMaskMatrix(masks, w, h){
  for(let r=0;r<h;r++){
    let line='';
    for(let c=0;c<w;c++){
      const v = masks[r*w+c];
      line += v.toString(16).padStart(1,'0') + ' ';
    }
    console.log(line);
  }
}

function main(){
  const argv = process.argv.slice(2);
  let line = 1; if (argv[0]) line = Number(argv[0]);
  const file = path.resolve(process.cwd(),'assets/kkk.jsonl');
  const lines = fs.readFileSync(file,'utf8').trim().split('\n');
  const rec = JSON.parse(lines[line-1]);
  console.log('Record', rec.id, 'w',rec.w,'h',rec.h,'L',rec.L);
  const grid = decodeBase64Deflate(rec.g);
  console.log('Decoded grid size', grid.length, 'x', grid[0].length);
  const masks = computeMasksFromGrid(grid, rec.w, rec.h);
  console.log('Start cell mask (index 0):', masks[0]);
  console.log('Start cell mask bits N E S W ->', !!(masks[0]&1), !!(masks[0]&2), !!(masks[0]&4), !!(masks[0]&8));
  console.log('\nMask matrix:');
  printMaskMatrix(masks, rec.w, rec.h);
  console.log('\nExpanded grid around start (3x3 block):');
  const ex = grid;
  for(let r=0;r<3;r++){
    let lineS='';
    for(let c=0;c<3;c++){
      lineS += (ex[r][c] ? '1':'0') + ' ';
    }
    console.log(lineS);
  }
}

if(require.main===module)main();
