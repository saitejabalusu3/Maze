class MazeCell {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.walls = { N: true, E: true, S: true, W: true };
    this.generated = false;
    this.solveVisited = false;
    this.inOpenSet = false;
    this.inPath = false;
    this.order = -1;
    this.distance = Infinity;
    this.prev = null;
  }

  resetSolve() {
    this.solveVisited = false;
    this.inOpenSet = false;
    this.inPath = false;
    this.distance = Infinity;
    this.prev = null;
  }
}

const ALGORITHM_LABELS = {
  recursiveBacktracker: 'Recursive Backtracker',
  growingTreeRightWall: 'Growing Tree (Right Wall)',
  huntAndKill: 'Hunt and Kill',
  sidewinderBidirectional: 'Sidewinder (Bidirectional)',
  wilsons: "Wilson's Algorithm",
};

const ALGORITHM_CODES = {
  recursiveBacktracker: 'rb',
  growingTreeRightWall: 'gtR',
  huntAndKill: 'hk',
  sidewinderBidirectional: 'swB',
  wilsons: 'wil',
};

class MazeVisualizer {
  constructor(canvas, statusCallback) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.statusCallback = statusCallback;

    this.gridWidth = 25;
    this.gridHeight = 25;
    this.grid = [];
    this.cellSize = 1;

    this.directions = [
      { key: 'N', dx: 0, dy: -1, opposite: 'S' },
      { key: 'E', dx: 1, dy: 0, opposite: 'W' },
      { key: 'S', dx: 0, dy: 1, opposite: 'N' },
      { key: 'W', dx: -1, dy: 0, opposite: 'E' },
    ];

    this.activeCell = null;
    this.frontierCells = [];
    this.queueCells = [];
    this.pathCells = [];
    this.pathIndexMap = new Map();
    this.hints = null;
    this.drawMode = 'walls';

    this.delay = 60;
    this.isAnimating = false;

    this.start = { x: 0, y: 0 };
    this.goal = { x: this.gridWidth - 1, y: this.gridHeight - 1 };

    this.maxOrder = 1;
    this.maxDistance = 1;

    this.algorithmKey = 'recursiveBacktracker';

    this.resetGrid(this.gridWidth, this.gridHeight);
  }

  computeCellSize() {
    const maxWidth = this.canvas.width / this.gridWidth;
    const maxHeight = this.canvas.height / this.gridHeight;
    const size = Math.floor(Math.min(maxWidth, maxHeight));
    return Math.max(1, size);
  }

  setStatus(message) {
    if (typeof this.statusCallback === 'function') {
      this.statusCallback(message);
    }
  }

  setDrawMode(mode) {
    this.drawMode = mode;
    this.draw();
  }

  setSpeed(level) {
    const mapping = {
      1: 140,
      2: 90,
      3: 55,
      4: 30,
      5: 10,
    };
    this.delay = mapping[level] ?? 55;
  }

  setAlgorithm(key) {
    this.algorithmKey = key;
  }

  resetGrid(width = this.gridWidth, height = this.gridHeight) {
    this.gridWidth = width;
    this.gridHeight = height;
    this.cellSize = this.computeCellSize();

    this.grid = [];
    for (let y = 0; y < this.gridHeight; y += 1) {
      const row = [];
      for (let x = 0; x < this.gridWidth; x += 1) {
        row.push(new MazeCell(x, y));
      }
      this.grid.push(row);
    }

    this.start = { x: 0, y: 0 };
    this.goal = { x: this.gridWidth - 1, y: this.gridHeight - 1 };
    this.activeCell = null;
    this.frontierCells = [];
    this.queueCells = [];
    this.pathCells = [];
    this.pathIndexMap = new Map();
    this.hints = null;
    this.maxOrder = 1;
    this.maxDistance = 1;

    this.draw();
  }

  getDrawGeometry() {
    const size = this.cellSize;
    const gridPixelWidth = this.gridWidth * size;
    const gridPixelHeight = this.gridHeight * size;
    const offsetX = Math.max(0, Math.floor((this.canvas.width - gridPixelWidth) / 2));
    const offsetY = Math.max(0, Math.floor((this.canvas.height - gridPixelHeight) / 2));
    return { size, offsetX, offsetY, gridPixelWidth, gridPixelHeight };
  }

  cellFromCanvasPoint(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      return null;
    }
    const scaleX = this.canvas.width / rect.width;
    const scaleY = this.canvas.height / rect.height;
    const canvasX = (clientX - rect.left) * scaleX;
    const canvasY = (clientY - rect.top) * scaleY;
    const { size, offsetX, offsetY } = this.getDrawGeometry();
    const gridX = Math.floor((canvasX - offsetX) / size);
    const gridY = Math.floor((canvasY - offsetY) / size);
    if (gridX < 0 || gridY < 0 || gridX >= this.gridWidth || gridY >= this.gridHeight) {
      return null;
    }
    return this.getCell(gridX, gridY);
  }

  getPathStepForCell(cell) {
    if (!cell) {
      return -1;
    }
    return this.pathIndexMap.get(cellKey(cell)) ?? -1;
  }

  randomCell() {
    const x = Math.floor(Math.random() * this.gridWidth);
    const y = Math.floor(Math.random() * this.gridHeight);
    return this.getCell(x, y);
  }

  getCell(x, y) {
    if (x < 0 || y < 0 || x >= this.gridWidth || y >= this.gridHeight) {
      return null;
    }
    return this.grid[y][x];
  }

  neighbors(cell) {
    const result = [];
    this.directions.forEach((dir) => {
      const neighbor = this.getCell(cell.x + dir.dx, cell.y + dir.dy);
      if (neighbor) {
        result.push({ cell: neighbor, dir });
      }
    });
    return result;
  }

  accessibleNeighbors(cell) {
    const result = [];
    this.directions.forEach((dir) => {
      if (!cell.walls[dir.key]) {
        const neighbor = this.getCell(cell.x + dir.dx, cell.y + dir.dy);
        if (neighbor) {
          result.push(neighbor);
        }
      }
    });
    return result;
  }

  markGenerated(cell) {
    if (!cell.generated) {
      cell.generated = true;
      cell.order = this.maxOrder;
      this.maxOrder += 1;
    }
  }

  carvePassage(cell, neighbor) {
    const dx = neighbor.x - cell.x;
    const dy = neighbor.y - cell.y;
    if (dx === 1 && dy === 0) {
      cell.walls.E = false;
      neighbor.walls.W = false;
    } else if (dx === -1 && dy === 0) {
      cell.walls.W = false;
      neighbor.walls.E = false;
    } else if (dy === 1 && dx === 0) {
      cell.walls.S = false;
      neighbor.walls.N = false;
    } else if (dy === -1 && dx === 0) {
      cell.walls.N = false;
      neighbor.walls.S = false;
    }
  }

  openEntrances() {
    const startCell = this.getCell(this.start.x, this.start.y);
    const goalCell = this.getCell(this.goal.x, this.goal.y);
    if (startCell) {
      startCell.walls.N = false;
      this.markGenerated(startCell);
    }
    if (goalCell) {
      goalCell.walls.S = false;
      this.markGenerated(goalCell);
    }
  }

  async generateMaze() {
    if (this.isAnimating) {
      return;
    }

    const generator = GenerationAlgorithms[this.algorithmKey];
    if (!generator) {
      this.setStatus('Unknown generation algorithm.');
      return;
    }

    this.isAnimating = true;
    this.resetGrid(this.gridWidth, this.gridHeight);
    this.setStatus(`Generating maze with ${ALGORITHM_LABELS[this.algorithmKey]}…`);

    try {
      await generator(this);
      this.openEntrances();
      this.frontierCells = [];
      this.activeCell = null;
      this.setStatus('Maze ready. Click Solve Maze to find a path.');
    } catch (error) {
      console.error(error);
      this.setStatus(`Error during generation: ${error.message}`);
    } finally {
      this.isAnimating = false;
      this.draw();
    }
  }

  async solveMaze() {
    if (this.isAnimating) {
      return;
    }
    const startCell = this.getCell(this.start.x, this.start.y);
    if (!startCell.generated) {
      this.setStatus('Generate a maze before solving.');
      return;
    }

    this.isAnimating = true;
    this.setStatus('Running A* search for the shortest path…');

    this.grid.forEach((row) => row.forEach((cell) => cell.resetSolve()));
    this.queueCells = [];
    this.pathCells = [];
    this.maxDistance = 1;

    const openSet = [];
    const addToOpenSet = (cell) => {
      if (!cell.inOpenSet && !cell.solveVisited) {
        cell.inOpenSet = true;
        openSet.push(cell);
      }
    };

    const popBest = () => {
      let bestIndex = 0;
      let bestScore = openSet[0].distance + this.heuristic(openSet[0]);
      for (let i = 1; i < openSet.length; i += 1) {
        const score = openSet[i].distance + this.heuristic(openSet[i]);
        if (score < bestScore) {
          bestScore = score;
          bestIndex = i;
        }
      }
      const [best] = openSet.splice(bestIndex, 1);
      best.inOpenSet = false;
      return best;
    };

    startCell.distance = 0;
    startCell.prev = null;
    addToOpenSet(startCell);
    this.queueCells = openSet.slice(0, 20);

    let foundGoal = false;

    while (openSet.length > 0) {
      const current = popBest();
      current.solveVisited = true;
      this.activeCell = current;
      this.queueCells = openSet.slice(0, 20);
      await this.renderStep();

      if (current.x === this.goal.x && current.y === this.goal.y) {
        foundGoal = true;
        break;
      }

      const neighbors = this.accessibleNeighbors(current);
      for (const neighbor of neighbors) {
        const tentativeDistance = current.distance + 1;
        if (tentativeDistance < neighbor.distance) {
          neighbor.distance = tentativeDistance;
          neighbor.prev = current;
          this.maxDistance = Math.max(this.maxDistance, neighbor.distance);
          addToOpenSet(neighbor);
        }
      }
    }

    const goalCell = this.getCell(this.goal.x, this.goal.y);
    if (foundGoal && goalCell) {
      this.setStatus('Shortest path found! Highlighting route…');
      const path = [];
      let current = goalCell;
      while (current) {
        path.push(current);
        current = current.prev;
      }
      path.reverse();
      this.pathCells = path;
      this.pathIndexMap = new Map();
      path.forEach((cell, index) => {
        this.pathIndexMap.set(cellKey(cell), index);
      });
      const solutionLength = Math.max(0, path.length - 1);
      this.hints = normalizeHintSteps(createDefaultHints(solutionLength), solutionLength);
      for (const cell of path) {
        cell.inPath = true;
        this.activeCell = cell;
        await this.renderStep();
      }
      this.setStatus(`Solved! Path length: ${path.length} steps.`);
    } else {
      this.setStatus('No path found. Try regenerating the maze.');
    }

    this.activeCell = null;
    this.queueCells = [];
    this.isAnimating = false;
  }

  heuristic(cell) {
    return Math.abs(cell.x - this.goal.x) + Math.abs(cell.y - this.goal.y);
  }

  draw() {
    const ctx = this.ctx;
    const { size, offsetX, offsetY, gridPixelWidth, gridPixelHeight } = this.getDrawGeometry();

    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.fillStyle = '#05080f';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    ctx.fillStyle = '#0c1324';
    ctx.fillRect(offsetX, offsetY, gridPixelWidth, gridPixelHeight);

    for (let y = 0; y < this.gridHeight; y += 1) {
      for (let x = 0; x < this.gridWidth; x += 1) {
        const cell = this.grid[y][x];
        const px = offsetX + x * size;
        const py = offsetY + y * size;

        ctx.fillStyle = this.cellFill(cell);
        ctx.fillRect(px, py, size, size);

        ctx.strokeStyle = '#0f1524';
        ctx.lineWidth = 1;
        ctx.strokeRect(px, py, size, size);

        ctx.strokeStyle = '#e7ecff';
        ctx.lineWidth = Math.max(1, Math.floor(size * 0.15));
        if (cell.walls.N) {
          ctx.beginPath();
          ctx.moveTo(px, py);
          ctx.lineTo(px + size, py);
          ctx.stroke();
        }
        if (cell.walls.E) {
          ctx.beginPath();
          ctx.moveTo(px + size, py);
          ctx.lineTo(px + size, py + size);
          ctx.stroke();
        }
        if (cell.walls.S) {
          ctx.beginPath();
          ctx.moveTo(px, py + size);
          ctx.lineTo(px + size, py + size);
          ctx.stroke();
        }
        if (cell.walls.W) {
          ctx.beginPath();
          ctx.moveTo(px, py);
          ctx.lineTo(px, py + size);
          ctx.stroke();
        }
      }
    }

    if (this.pathCells.length > 1) {
      ctx.save();
      ctx.strokeStyle = '#ff4d4d';
      ctx.lineWidth = Math.max(2, size * 0.35);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      const startCell = this.pathCells[0];
      ctx.moveTo(offsetX + startCell.x * size + size / 2, offsetY + startCell.y * size + size / 2);
      for (let i = 1; i < this.pathCells.length; i += 1) {
        const cell = this.pathCells[i];
        ctx.lineTo(offsetX + cell.x * size + size / 2, offsetY + cell.y * size + size / 2);
      }
      ctx.stroke();
      ctx.restore();

    }
  }

  cellFill(cell) {
    const startKey = this.start.x === cell.x && this.start.y === cell.y;
    const goalKey = this.goal.x === cell.x && this.goal.y === cell.y;
    if (startKey) {
      return '#4ad395';
    }
    if (goalKey) {
      return '#ff784a';
    }
    if (cell === this.activeCell) {
      return '#7a5bff';
    }
    if (this.frontierCells.includes(cell)) {
      return '#58a6ff88';
    }
    if (this.queueCells.includes(cell)) {
      return '#1f7aec55';
    }
    if (this.drawMode === 'visited') {
      if (cell.solveVisited) {
        return '#1f7aec33';
      }
      if (cell.generated) {
        return '#58a6ff22';
      }
      return '#05080f';
    }
    if (this.drawMode === 'heat') {
      if (cell.order >= 0 && this.maxOrder > 1) {
        const ratio = cell.order / (this.maxOrder - 1);
        return heatColor(ratio);
      }
      if (Number.isFinite(cell.distance) && cell.solveVisited && this.maxDistance > 1) {
        const ratio = cell.distance / (this.maxDistance - 1);
        return solveHeatColor(ratio);
      }
    }
    if (cell.inPath) {
      const stepIndex = this.getPathStepForCell(cell);
      if (Array.isArray(this.hints) && this.hints.includes(stepIndex) && stepIndex > 0) {
        return 'rgba(66, 255, 116, 0.6)';
      }
      return 'rgba(255, 77, 77, 0.25)';
    }
    return '#0c1324';
  }

  async renderStep() {
    this.draw();
    if (this.delay <= 0) {
      return;
    }
    await wait(this.delay);
  }
}

function randomItem(items) {
  return items[Math.floor(Math.random() * items.length)];
}

function cellKey(cell) {
  return `${cell.x},${cell.y}`;
}

const GenerationAlgorithms = {
  async recursiveBacktracker(visualizer) {
    const startCell = visualizer.getCell(visualizer.start.x, visualizer.start.y);
    startCell.generated = true;
    startCell.order = 0;
    visualizer.maxOrder = 1;
    const stack = [startCell];
    visualizer.activeCell = startCell;
    visualizer.frontierCells = [startCell];
    await visualizer.renderStep();

    while (stack.length > 0) {
      const current = stack[stack.length - 1];
      visualizer.activeCell = current;
      const neighbors = visualizer.neighbors(current).filter(({ cell }) => !cell.generated);
      if (neighbors.length > 0) {
        const { cell: nextCell } = randomItem(neighbors);
        visualizer.carvePassage(current, nextCell);
        visualizer.markGenerated(nextCell);
        stack.push(nextCell);
        visualizer.frontierCells = [current, nextCell];
      } else {
        stack.pop();
        visualizer.frontierCells = stack.length ? [stack[stack.length - 1]] : [];
      }
      await visualizer.renderStep();
    }

    visualizer.frontierCells = [];
  },

  async growingTreeRightWall(visualizer) {
    const startCell = visualizer.randomCell();
    startCell.generated = true;
    startCell.order = 0;
    visualizer.maxOrder = 1;
    const cellList = [startCell];
    visualizer.activeCell = startCell;
    visualizer.frontierCells = [startCell];
    await visualizer.renderStep();

    const newestBias = 0.75;

    while (cellList.length > 0) {
      const index = Math.random() < newestBias ? cellList.length - 1 : Math.floor(Math.random() * cellList.length);
      const current = cellList[index];
      visualizer.activeCell = current;
      let neighbors = visualizer.neighbors(current).filter(({ cell }) => !cell.generated);
      if (neighbors.length > 0) {
        const eastPreferred = neighbors.filter(({ dir }) => dir.key === 'E');
        if (eastPreferred.length > 0) {
          neighbors = eastPreferred;
        }
        const { cell: nextCell } = randomItem(neighbors);
        visualizer.carvePassage(current, nextCell);
        visualizer.markGenerated(nextCell);
        cellList.push(nextCell);
        visualizer.frontierCells = [current, nextCell];
      } else {
        cellList.splice(index, 1);
        visualizer.frontierCells = cellList.length ? [cellList[cellList.length - 1]] : [];
      }
      await visualizer.renderStep();
    }

    visualizer.frontierCells = [];
  },

  async huntAndKill(visualizer) {
    let current = visualizer.randomCell();
    current.generated = true;
    current.order = 0;
    visualizer.maxOrder = 1;
    visualizer.activeCell = current;
    visualizer.frontierCells = [current];
    await visualizer.renderStep();

    while (true) {
      const neighbors = visualizer.neighbors(current).filter(({ cell }) => !cell.generated);
      if (neighbors.length > 0) {
        const { cell: nextCell } = randomItem(neighbors);
        visualizer.carvePassage(current, nextCell);
        visualizer.markGenerated(nextCell);
        visualizer.frontierCells = [current, nextCell];
        current = nextCell;
      } else {
        let found = null;
        for (let y = 0; y < visualizer.gridHeight && !found; y += 1) {
          for (let x = 0; x < visualizer.gridWidth && !found; x += 1) {
            const cell = visualizer.getCell(x, y);
            if (!cell.generated) {
              const visitedNeighbors = visualizer.neighbors(cell).filter(({ cell: neighbor }) => neighbor.generated);
              if (visitedNeighbors.length > 0) {
                const { cell: visitedNeighbor } = randomItem(visitedNeighbors);
                visualizer.carvePassage(cell, visitedNeighbor);
                visualizer.markGenerated(cell);
                current = cell;
                found = true;
                visualizer.frontierCells = [cell, visitedNeighbor];
              }
            }
          }
        }
        if (!found) {
          break;
        }
      }
      visualizer.activeCell = current;
      await visualizer.renderStep();
    }

    visualizer.frontierCells = [];
  },

  async sidewinderBidirectional(visualizer) {
    const first = visualizer.getCell(0, 0);
    if (!first) {
      return;
    }
    visualizer.markGenerated(first);
    visualizer.activeCell = first;
    visualizer.frontierCells = [first];
    await visualizer.renderStep();

    for (let x = 1; x < visualizer.gridWidth; x += 1) {
      const cell = visualizer.getCell(x, 0);
      const west = visualizer.getCell(x - 1, 0);
      if (cell && west) {
        visualizer.markGenerated(cell);
        visualizer.carvePassage(west, cell);
        visualizer.activeCell = cell;
        visualizer.frontierCells = [west, cell];
        await visualizer.renderStep();
      }
    }

    for (let y = 1; y < visualizer.gridHeight; y += 1) {
      let run = [];
      const eastward = y % 2 === 0;
      const startX = eastward ? 0 : visualizer.gridWidth - 1;
      const endX = eastward ? visualizer.gridWidth : -1;
      const step = eastward ? 1 : -1;

      for (let x = startX; x !== endX; x += step) {
        const cell = visualizer.getCell(x, y);
        if (!cell) {
          continue;
        }
        visualizer.markGenerated(cell);
        run.push(cell);
        visualizer.activeCell = cell;
        visualizer.frontierCells = run.slice();

        const atBoundary = (eastward && x === visualizer.gridWidth - 1) || (!eastward && x === 0);
        const shouldCloseOut = atBoundary || Math.random() < 0.33;

        if (!shouldCloseOut) {
          const neighbor = visualizer.getCell(x + step, y);
          if (neighbor) {
            visualizer.carvePassage(cell, neighbor);
          }
        } else {
          const runCell = randomItem(run);
          const northNeighbor = visualizer.getCell(runCell.x, y - 1);
          if (northNeighbor) {
            visualizer.carvePassage(runCell, northNeighbor);
          }
          run = [];
        }

        await visualizer.renderStep();
      }
    }

    visualizer.frontierCells = [];
  },

  async wilsons(visualizer) {
    const allUnvisited = new Set();
    for (let y = 0; y < visualizer.gridHeight; y += 1) {
      for (let x = 0; x < visualizer.gridWidth; x += 1) {
        allUnvisited.add(`${x},${y}`);
      }
    }

    const root = visualizer.randomCell();
    if (!root) {
      return;
    }
    visualizer.markGenerated(root);
    allUnvisited.delete(cellKey(root));
    visualizer.activeCell = root;
    visualizer.frontierCells = [root];
    await visualizer.renderStep();

    while (allUnvisited.size > 0) {
      const startKey = randomItem(Array.from(allUnvisited));
      const [sx, sy] = startKey.split(',').map((value) => Number.parseInt(value, 10));
      let current = visualizer.getCell(sx, sy);
      const path = [current];
      const visitedInWalk = new Map([[cellKey(current), 0]]);

      while (current && !current.generated) {
        const neighborOptions = visualizer.neighbors(current);
        const { cell: nextCell } = randomItem(neighborOptions);
        const key = cellKey(nextCell);
        if (visitedInWalk.has(key)) {
          const idx = visitedInWalk.get(key);
          path.splice(idx + 1);
          for (const [walkKey, walkIndex] of Array.from(visitedInWalk.entries())) {
            if (walkIndex > idx) {
              visitedInWalk.delete(walkKey);
            }
          }
        } else {
          path.push(nextCell);
          visitedInWalk.set(key, path.length - 1);
        }
        current = nextCell;
        visualizer.frontierCells = path.slice();
        visualizer.activeCell = current;
        await visualizer.renderStep();
      }

      visualizer.markGenerated(path[0]);
      allUnvisited.delete(cellKey(path[0]));

      for (let i = 0; i < path.length - 1; i += 1) {
        const cell = path[i];
        const nextCell = path[i + 1];
        visualizer.carvePassage(cell, nextCell);
        visualizer.markGenerated(nextCell);
        allUnvisited.delete(cellKey(nextCell));
        visualizer.frontierCells = [cell, nextCell];
        visualizer.activeCell = nextCell;
        await visualizer.renderStep();
      }
    }

    visualizer.frontierCells = [];
  },
};

function heatColor(t) {
  const clamped = Math.max(0, Math.min(1, t));
  const hue = 220 - clamped * 120;
  const saturation = 70 + clamped * 25;
  const lightness = 20 + clamped * 40;
  return hsl(hue, saturation, lightness, 0.8);
}

function solveHeatColor(t) {
  const clamped = Math.max(0, Math.min(1, t));
  const hue = 200 - clamped * 200;
  const saturation = 65;
  const lightness = 25 + clamped * 45;
  return hsl(hue, saturation, lightness, 0.55);
}

function hsl(h, s, l, alpha = 1) {
  return `hsla(${Math.round(h)}, ${Math.round(s)}%, ${Math.round(l)}%, ${alpha})`;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function bytesToBase64(u8) {
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < u8.length; i += chunkSize) {
    const chunk = u8.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function packGridOpeningsToBase64(getCellWalls, w, h) {
  const totalCells = w * h;
  const packed = new Uint8Array(Math.ceil(totalCells / 2));
  for (let index = 0; index < totalCells; index += 1) {
    const x = index % w;
    const y = Math.floor(index / w);
    const walls = getCellWalls(x, y) ?? {};
    const openingsMask = (walls.N === false ? 1 : 0)
      | (walls.E === false ? 2 : 0)
      | (walls.S === false ? 4 : 0)
      | (walls.W === false ? 8 : 0);
    const byteIndex = Math.floor(index / 2);
    if (index % 2 === 0) {
      packed[byteIndex] = openingsMask & 0x0f;
    } else {
      packed[byteIndex] |= (openingsMask & 0x0f) << 4;
    }
  }
  return bytesToBase64(packed);
}

function movesFromPathCoords(coords) {
  const moves = [];
  for (let i = 1; i < coords.length; i += 1) {
    const prev = coords[i - 1];
    const current = coords[i];
    const dx = current.x - prev.x;
    const dy = current.y - prev.y;
    if (dx === 0 && dy === -1) {
      moves.push(0);
    } else if (dx === 1 && dy === 0) {
      moves.push(1);
    } else if (dx === 0 && dy === 1) {
      moves.push(2);
    } else if (dx === -1 && dy === 0) {
      moves.push(3);
    } else {
      throw new Error('Invalid path coordinates: non-adjacent move detected.');
    }
  }
  return moves;
}

function packMovesBase64(moves) {
  if (moves.length === 0) {
    return '';
  }
  const packed = new Uint8Array(Math.ceil(moves.length / 4));
  moves.forEach((move, index) => {
    const clamped = move & 0x03;
    const byteIndex = Math.floor(index / 4);
    const shift = (index % 4) * 2;
    packed[byteIndex] |= clamped << shift;
  });
  return bytesToBase64(packed);
}

function createDefaultHints(L) {
  if (L <= 0) {
    return [];
  }
  const hints = [];
  for (let step = 20; step < L; step += 20) {
    hints.push(step);
  }
  if (!hints.includes(L)) {
    hints.push(L);
  }
  return hints;
}

function normalizeHintSteps(hints, maxStep) {
  if (!Array.isArray(hints) || maxStep <= 0) {
    return [];
  }
  const unique = new Set();
  const cleaned = [];
  for (const value of hints) {
    const step = Number(value);
    if (!Number.isFinite(step)) {
      continue;
    }
    if (step <= 0 || step > maxStep) {
      continue;
    }
    if (unique.has(step)) {
      continue;
    }
    unique.add(step);
    cleaned.push(step);
  }
  cleaned.sort((a, b) => a - b);
  return cleaned;
}

function getSolvedPathCoordinates(visualizer) {
  if (visualizer.pathCells && visualizer.pathCells.length > 1) {
    return visualizer.pathCells.map((cell) => ({ x: cell.x, y: cell.y }));
  }

  const startCell = visualizer.getCell(visualizer.start.x, visualizer.start.y);
  const goalCell = visualizer.getCell(visualizer.goal.x, visualizer.goal.y);
  if (!startCell || !goalCell || !startCell.generated || !goalCell.generated) {
    return null;
  }

  const cameFrom = new Map();
  const queue = [startCell];
  cameFrom.set(cellKey(startCell), null);

  while (queue.length > 0) {
    const current = queue.shift();
    if (current === goalCell) {
      break;
    }

    const neighbors = visualizer.accessibleNeighbors(current);
    for (const neighbor of neighbors) {
      const key = cellKey(neighbor);
      if (cameFrom.has(key)) {
        continue;
      }
      cameFrom.set(key, current);
      queue.push(neighbor);
    }
  }

  if (!cameFrom.has(cellKey(goalCell))) {
    return null;
  }

  const path = [];
  let cursor = goalCell;
  while (cursor) {
    path.push({ x: cursor.x, y: cursor.y });
    cursor = cameFrom.get(cellKey(cursor));
  }
  path.reverse();
  return path;
}

function setup() {
  const canvas = document.getElementById('mazeCanvas');
  const statusEl = document.getElementById('status');
  const algorithmSelect = document.getElementById('algorithm');
  const widthSlider = document.getElementById('width');
  const widthValue = document.getElementById('widthValue');
  const heightSlider = document.getElementById('height');
  const heightValue = document.getElementById('heightValue');
  const speedSlider = document.getElementById('speed');
  const speedValue = document.getElementById('speedValue');
  const drawModeSelect = document.getElementById('drawMode');
  const skillTierSelect = document.getElementById('skillTier');
  const difficultySelect = document.getElementById('difficulty');
  const generateButton = document.getElementById('generateButton');
  const solveButton = document.getElementById('solveButton');
  const resetButton = document.getElementById('resetButton');
  const saveButton = document.getElementById('saveButton');
  const addHintButton = document.getElementById('addHintButton');
  const removeHintButton = document.getElementById('removeHintButton');

  const visualizer = new MazeVisualizer(canvas, (message) => {
    statusEl.textContent = message;
  });

  const speedLabels = {
    1: 'Very Slow',
    2: 'Slow',
    3: 'Medium',
    4: 'Fast',
    5: 'Very Fast',
  };

  let hintEditMode = 'none';

  function setHintMode(mode, options = {}) {
    const { silent = false } = options;
    const previousMode = hintEditMode;
    const nextMode = previousMode === mode ? 'none' : mode;
    hintEditMode = nextMode;
    addHintButton.classList.toggle('active', hintEditMode === 'add');
    removeHintButton.classList.toggle('active', hintEditMode === 'remove');
    if (silent) {
      return;
    }
    if (hintEditMode === 'add') {
      visualizer.setStatus('Add hint mode: click a solution cell to add a hint.');
    } else if (hintEditMode === 'remove') {
      visualizer.setStatus('Remove hint mode: click a hinted cell to clear it.');
    } else if (previousMode !== 'none') {
      visualizer.setStatus('Hint editing disabled.');
    }
  }

  function updateHintButtonsState() {
    const hasPath = visualizer.pathCells && visualizer.pathCells.length > 1;
    const shouldDisable = !hasPath || visualizer.isAnimating;
    addHintButton.disabled = shouldDisable;
    removeHintButton.disabled = shouldDisable;
    if (shouldDisable) {
      setHintMode('none', { silent: true });
    }
  }

  function hasGeneratedMaze() {
    const startCell = visualizer.getCell(visualizer.start.x, visualizer.start.y);
    return Boolean(startCell && startCell.generated);
  }

  function updateSaveButtonState() {
    saveButton.disabled = !hasGeneratedMaze() || visualizer.isAnimating;
  }

  function updateSpeedLabel(value) {
    speedValue.textContent = speedLabels[value] ?? 'Medium';
  }

  function updateDimensionLabels() {
    widthValue.textContent = `${Number.parseInt(widthSlider.value, 10)} cells`;
    heightValue.textContent = `${Number.parseInt(heightSlider.value, 10)} cells`;
  }

  function applyGridChange() {
    const width = Number.parseInt(widthSlider.value, 10);
    const height = Number.parseInt(heightSlider.value, 10);
    visualizer.resetGrid(width, height);
    visualizer.setStatus('Grid reset. Generate a maze to continue.');
    updateSaveButtonState();
    updateHintButtonsState();
    setHintMode('none', { silent: true });
  }

  algorithmSelect.addEventListener('change', () => {
    visualizer.setAlgorithm(algorithmSelect.value);
    visualizer.setStatus(`Ready to generate using ${ALGORITHM_LABELS[algorithmSelect.value]}.`);
  });

  widthSlider.addEventListener('input', updateDimensionLabels);
  heightSlider.addEventListener('input', updateDimensionLabels);

  widthSlider.addEventListener('change', () => {
    if (visualizer.isAnimating) {
      widthSlider.value = String(visualizer.gridWidth);
      updateDimensionLabels();
      return;
    }
    applyGridChange();
  });

  heightSlider.addEventListener('change', () => {
    if (visualizer.isAnimating) {
      heightSlider.value = String(visualizer.gridHeight);
      updateDimensionLabels();
      return;
    }
    applyGridChange();
  });

  speedSlider.addEventListener('input', () => {
    const value = Number.parseInt(speedSlider.value, 10);
    updateSpeedLabel(value);
    visualizer.setSpeed(value);
  });

  drawModeSelect.addEventListener('change', () => {
    visualizer.setDrawMode(drawModeSelect.value);
  });

  skillTierSelect.addEventListener('change', () => {
    const label = skillTierSelect.options[skillTierSelect.selectedIndex]?.textContent ?? 'Beginner';
    visualizer.setStatus(`Skill tier set to ${label}.`);
  });

  difficultySelect.addEventListener('change', () => {
    const label = difficultySelect.options[difficultySelect.selectedIndex]?.textContent ?? 'Easy';
    visualizer.setStatus(`Difficulty set to ${label}.`);
  });

  generateButton.addEventListener('click', async () => {
    if (visualizer.isAnimating) {
      return;
    }
    disableControls(true);
    await visualizer.generateMaze();
    disableControls(false);
    updateSaveButtonState();
    updateHintButtonsState();
    setHintMode('none', { silent: true });
  });

  solveButton.addEventListener('click', async () => {
    if (visualizer.isAnimating) {
      return;
    }
    disableControls(true, { allowGenerate: true });
    await visualizer.solveMaze();
    disableControls(false);
    updateHintButtonsState();
  });

  addHintButton.addEventListener('click', () => {
    if (addHintButton.disabled) {
      return;
    }
    setHintMode('add');
  });

  removeHintButton.addEventListener('click', () => {
    if (removeHintButton.disabled) {
      return;
    }
    setHintMode('remove');
  });

  canvas.addEventListener('click', (event) => {
    if (hintEditMode === 'none') {
      return;
    }
    if (!visualizer.pathCells || visualizer.pathCells.length <= 1) {
      visualizer.setStatus('Solve the maze before editing hints.');
      return;
    }

    const cell = visualizer.cellFromCanvasPoint(event.clientX, event.clientY);
    if (!cell) {
      return;
    }
    const step = visualizer.getPathStepForCell(cell);
    const maxStep = visualizer.pathCells.length - 1;
    if (step <= 0 || step > maxStep) {
      visualizer.setStatus('Select a solution cell (excluding the start).');
      return;
    }

    if (hintEditMode === 'add') {
      const existingHints = visualizer.hints ?? [];
      if (existingHints.includes(step)) {
        visualizer.setStatus('Hint already exists for that step.');
        return;
      }
      visualizer.hints = normalizeHintSteps([...existingHints, step], maxStep);
      visualizer.draw();
      visualizer.setStatus(`Hint added at step ${step}.`);
    } else if (hintEditMode === 'remove') {
      const existingHints = visualizer.hints ?? [];
      if (!existingHints.includes(step)) {
        visualizer.setStatus('No hint set for that cell.');
        return;
      }
      visualizer.hints = normalizeHintSteps(existingHints.filter((value) => value !== step), maxStep);
      visualizer.draw();
      visualizer.setStatus(`Hint removed from step ${step}.`);
    }
  });

  saveButton.addEventListener('click', () => {
    if (visualizer.isAnimating) {
      return;
    }

    if (!hasGeneratedMaze()) {
      visualizer.setStatus('Generate a maze before saving.');
      return;
    }

    const coords = getSolvedPathCoordinates(visualizer);
    if (!coords || coords.length < 2) {
      visualizer.setStatus('Solve the maze before saving.');
      return;
    }

    const w = visualizer.gridWidth;
    const h = visualizer.gridHeight;
    const g = packGridOpeningsToBase64((x, y) => {
      const cell = visualizer.getCell(x, y);
      return cell ? cell.walls : undefined;
    }, w, h);
    const moves = movesFromPathCoords(coords);
    const p = packMovesBase64(moves);
    const L = moves.length;
    const hints = Array.isArray(visualizer.hints)
      ? normalizeHintSteps(visualizer.hints, L)
      : normalizeHintSteps(createDefaultHints(L), L);
    const algCode = ALGORITHM_CODES[visualizer.algorithmKey] ?? 'unknown';
    const skillTier = skillTierSelect.value;
    const difficulty = difficultySelect.value;

    const record = {
      v: 1,
      alg: algCode,
      w,
      h,
      g,
      p,
      L,
      hints,
      skillTier,
      difficulty,
    };

    const filename = `maze_${algCode}_${w}x${h}_L${L}.json`;
    const blob = new Blob([JSON.stringify(record)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);

    visualizer.setStatus(`Maze exported as ${filename}.`);
  });

  resetButton.addEventListener('click', () => {
    if (visualizer.isAnimating) {
      return;
    }
    applyGridChange();
  });

  function disableControls(disabled, options = {}) {
    const { allowGenerate = false } = options;
    algorithmSelect.disabled = disabled;
    widthSlider.disabled = disabled;
    heightSlider.disabled = disabled;
    speedSlider.disabled = disabled;
    drawModeSelect.disabled = disabled;
    skillTierSelect.disabled = disabled;
    difficultySelect.disabled = disabled;
    resetButton.disabled = disabled;
    solveButton.disabled = disabled;
    generateButton.disabled = disabled && !allowGenerate;
    if (disabled) {
      saveButton.disabled = true;
      addHintButton.disabled = true;
      removeHintButton.disabled = true;
      setHintMode('none', { silent: true });
    } else {
      updateSaveButtonState();
      updateHintButtonsState();
    }
  }

  updateDimensionLabels();
  updateSpeedLabel(Number.parseInt(speedSlider.value, 10));
  visualizer.setSpeed(Number.parseInt(speedSlider.value, 10));
  visualizer.setAlgorithm(algorithmSelect.value);
  visualizer.resetGrid(Number.parseInt(widthSlider.value, 10), Number.parseInt(heightSlider.value, 10));
  visualizer.draw();
  updateSaveButtonState();
  updateHintButtonsState();
  setHintMode('none', { silent: true });
}

document.addEventListener('DOMContentLoaded', setup);
