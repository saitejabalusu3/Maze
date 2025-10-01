import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  LayoutChangeEvent,
  Pressable,
  ActivityIndicator,
  Vibration,
} from 'react-native';
import {
  PanGestureHandler,
  PanGestureHandlerGestureEvent,
  PanGestureHandlerStateChangeEvent,
  State,
} from 'react-native-gesture-handler';
import { Asset } from 'expo-asset';
import * as FileSystem from 'expo-file-system';

import GameCanvas, { CanvasPoint, GridPoint } from '../ui/GameCanvas';
import { DIRECTION_MASK, decodeMoves, decodeOpenings } from '../maze/decoder';
import { firstDivergence, hintSegment } from '../maze/engine';
import { theme } from '../theme';
import { ads } from '../services/ads';
import { useProStatus, buyProUnlock, restorePurchases } from '../services/iap';
import { recordGameResult } from '../services/profile';
import AsyncStorage from '@react-native-async-storage/async-storage';

const DIRECTIONS = [
  { dx: 0, dy: -1, mask: DIRECTION_MASK.N },
  { dx: 1, dy: 0, mask: DIRECTION_MASK.E },
  { dx: 0, dy: 1, mask: DIRECTION_MASK.S },
  { dx: -1, dy: 0, mask: DIRECTION_MASK.W },
] as const;

type DirectionIndex = 0 | 1 | 2 | 3;

type SkillTier = 'beginner' | 'intermediate' | 'expert';
type Difficulty = 'easy' | 'medium' | 'hard';

const skillTiers: SkillTier[] = ['beginner', 'intermediate', 'expert'];
const difficulties: Difficulty[] = ['easy', 'medium', 'hard'];

const BASE_RESOURCE_BUNDLE = 3;
const HINT_FLASH_DURATION = 4000;

export type MazeRecord = {
  v: number;
  alg: string;
  w: number;
  h: number;
  g: string;
  p: string;
  L: number;
  hints: number[];
  skillTier: SkillTier;
  difficulty: Difficulty;
};

type GestureSnapshot = {
  x: number;
  y: number;
  time: number;
};

const toMillis = (elapsedMs: number) => {
  const totalSeconds = Math.floor(elapsedMs / 1000);
  const minutes = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, '0');
  const seconds = (totalSeconds % 60).toString().padStart(2, '0');
  return `${minutes}:${seconds}`;
};

const computeStars = (elapsedMs: number, hintsUsed: number, slicesUsed: number) => {
  let stars = 3;
  if (elapsedMs > 5 * 60 * 1000) {
    stars -= 1;
  }
  if (hintsUsed > 0) {
    stars -= 1;
  }
  if (slicesUsed > 2) {
    stars -= 1;
  }
  return Math.max(1, stars);
};

const readPuzzleAsset = async (): Promise<MazeRecord[]> => {
  // Use the newly added kkk.jsonl asset in assets/ per user request
  let assetModule;
  try {
    assetModule = require('../../assets/kkk.jsonl');
  } catch (e) {
    // fallback to previous name if kkk isn't present
    assetModule = require('../../assets/maze.jsonl');
    console.warn('assets/kkk.jsonl not found, falling back to maze.jsonl');
  }
  const asset = Asset.fromModule(assetModule);
  await asset.downloadAsync();
  const uri = asset.localUri ?? asset.uri;
  const raw = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.UTF8 });
  // The asset may contain pretty-printed JSON objects (multi-line). Split
  // the file by top-level JSON object boundaries by scanning braces while
  // respecting string quoting and escapes.
  const objects: string[] = [];
  let depth = 0;
  let inString = false;
  let escape = false;
  let start = -1;
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];
    if (inString) {
      if (escape) {
        escape = false;
      } else if (ch === '\\') {
        escape = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{') {
      if (depth === 0) {
        start = i;
      }
      depth += 1;
      continue;
    }
    if (ch === '}') {
      depth -= 1;
      if (depth === 0 && start !== -1) {
        objects.push(raw.slice(start, i + 1));
        start = -1;
      }
    }
  }

  const records: MazeRecord[] = [];
  for (let i = 0; i < objects.length; i += 1) {
    const objText = objects[i].trim();
    try {
      const parsed = JSON.parse(objText) as MazeRecord;
      records.push(parsed);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`Failed to parse object ${i + 1} from ${uri}:`, err);
    }
  }

  // Helpful debug info: how many lines vs parsed records, and a sample
  // eslint-disable-next-line no-console
  console.info(`Loaded ${records.length}/${objects.length} puzzles from ${uri}`);
  if (records.length > 0) {
    const sample = records[0];
    // eslint-disable-next-line no-console
    console.info(`Sample puzzle: tier=${sample.skillTier} difficulty=${sample.difficulty} id=${(sample as any).id}`);
  }
  return records;
};

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

type MazeGeometry = {
  cellSize: number;
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
};

const computeGeometry = (
  maze: MazeRecord | null,
  canvasSize: { width: number; height: number }
): MazeGeometry | null => {
  if (!maze || canvasSize.width <= 0 || canvasSize.height <= 0) {
    return null;
  }
  const cellSize = Math.min(canvasSize.width / maze.w, canvasSize.height / maze.h);
  if (!Number.isFinite(cellSize) || cellSize <= 0) {
    return null;
  }
  const width = maze.w * cellSize;
  const height = maze.h * cellSize;
  const offsetX = (canvasSize.width - width) / 2;
  const offsetY = (canvasSize.height - height) / 2;
  return { cellSize, offsetX, offsetY, width, height };
};

const cellCenter = (geometry: MazeGeometry, cell: GridPoint): CanvasPoint => ({
  x: geometry.offsetX + (cell.x + 0.5) * geometry.cellSize,
  y: geometry.offsetY + (cell.y + 0.5) * geometry.cellSize,
});

const orientation = (p: CanvasPoint, q: CanvasPoint, r: CanvasPoint) => {
  const val = (q.y - p.y) * (r.x - q.x) - (q.x - p.x) * (r.y - q.y);
  if (Math.abs(val) < 1e-6) {
    return 0;
  }
  return val > 0 ? 1 : 2;
};

const onSegment = (p: CanvasPoint, q: CanvasPoint, r: CanvasPoint) =>
  q.x <= Math.max(p.x, r.x) + 1e-6 &&
  q.x + 1e-6 >= Math.min(p.x, r.x) &&
  q.y <= Math.max(p.y, r.y) + 1e-6 &&
  q.y + 1e-6 >= Math.min(p.y, r.y);

const segmentsIntersect = (a1: CanvasPoint, a2: CanvasPoint, b1: CanvasPoint, b2: CanvasPoint) => {
  const o1 = orientation(a1, a2, b1);
  const o2 = orientation(a1, a2, b2);
  const o3 = orientation(b1, b2, a1);
  const o4 = orientation(b1, b2, a2);

  if (o1 !== o2 && o3 !== o4) {
    return true;
  }
  if (o1 === 0 && onSegment(a1, b1, a2)) return true;
  if (o2 === 0 && onSegment(a1, b2, a2)) return true;
  if (o3 === 0 && onSegment(b1, a1, b2)) return true;
  if (o4 === 0 && onSegment(b1, a2, b2)) return true;
  return false;
};

const getCellFromPoint = (

  geometry: MazeGeometry | null,
  point: CanvasPoint,
  maze: MazeRecord | null
): GridPoint | null => {
  if (!geometry || !maze) {
    return null;
  }
  const localX = point.x - geometry.offsetX;
  const localY = point.y - geometry.offsetY;
  if (localX < 0 || localY < 0 || localX > geometry.width || localY > geometry.height) {
    return null;
  }
  return {
    x: clamp(Math.floor(localX / geometry.cellSize), 0, maze.w - 1),
    y: clamp(Math.floor(localY / geometry.cellSize), 0, maze.h - 1),
  };
};

const makeSolutionCells = (moves: number[]): GridPoint[] => {
  const cells: GridPoint[] = [{ x: 0, y: 0 }];
  let cursor = { x: 0, y: 0 };
  moves.forEach((move) => {
    const direction = DIRECTIONS[move as DirectionIndex] ?? { dx: 0, dy: 0 };
    cursor = { x: cursor.x + direction.dx, y: cursor.y + direction.dy };
    cells.push(cursor);
  });
  return cells;
};

const useInterval = (enabled: boolean, callback: () => void, intervalMs: number) => {
  useEffect(() => {
    if (!enabled) {
      return undefined;
    }
    const id = setInterval(callback, intervalMs);
    return () => clearInterval(id);
  }, [enabled, callback, intervalMs]);
};

const GameScreen: React.FC = () => {
  const [puzzles, setPuzzles] = useState<MazeRecord[]>([]);
  const [playedSet, setPlayedSet] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [selectedSkill, setSelectedSkill] = useState<SkillTier | null>(null);
  const [selectedDifficulty, setSelectedDifficulty] = useState<Difficulty | null>(null);
  const [currentMaze, setCurrentMaze] = useState<MazeRecord | null>(null);
  const [openings, setOpenings] = useState<Uint8Array>(new Uint8Array());
  const [solutionMoves, setSolutionMoves] = useState<number[]>([]);
  const [playerMoves, setPlayerMoves] = useState<number[]>([]);
  const [playerCells, setPlayerCells] = useState<GridPoint[]>([{ x: 0, y: 0 }]);
  const [divergence, setDivergence] = useState(-1);
  const [progress, setProgress] = useState(0);
  const [hintCells, setHintCells] = useState<GridPoint[]>([]);
  const [availableHints, setAvailableHints] = useState<number>(BASE_RESOURCE_BUNDLE);
  const [availableSlices, setAvailableSlices] = useState<number>(BASE_RESOURCE_BUNDLE);
  const [hintCount, setHintCount] = useState(0);
  const [sliceCount, setSliceCount] = useState(0);
  const [startTimestamp, setStartTimestamp] = useState<number | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [completed, setCompleted] = useState(false);
  const [stars, setStars] = useState(0);
  const [canvasSize, setCanvasSize] = useState({ width: 320, height: 320 });

  const [strokePoints, setStrokePoints] = useState<CanvasPoint[]>([]);
  const [activePointer, setActivePointer] = useState<CanvasPoint | null>(null);
  const [sliceActive, setSliceActive] = useState(false);
  const [sliceHighlight, setSliceHighlight] = useState<GridPoint[] | null>(null);
  const [blockedMarker, setBlockedMarker] = useState<CanvasPoint | null>(null);
  const [debugMask, setDebugMask] = useState(false);

  const [iapProcessing, setIapProcessing] = useState(false);
  const [iapMessage, setIapMessage] = useState<string | null>(null);

  const isPro = useProStatus();

  const playerMovesRef = useRef<number[]>([]);
  const playerCellsRef = useRef<GridPoint[]>([{ x: 0, y: 0 }]);
  const currentMazeRef = useRef<MazeRecord | null>(null);
  const hintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gestureStartRef = useRef<GestureSnapshot | null>(null);
  const lastCellRef = useRef<string | null>(null);
  const sliceStartRef = useRef<CanvasPoint | null>(null);

  const geometry = useMemo(() => computeGeometry(currentMaze, canvasSize), [currentMaze, canvasSize]);

  // keep a ref to currentMaze so callbacks can read latest without being re-created
  useEffect(() => {
    currentMazeRef.current = currentMaze;
  }, [currentMaze]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const items = await readPuzzleAsset();
        if (mounted) {
          setPuzzles(items);
        }
      } catch (error) {
        console.warn('Failed to load puzzles', error);
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    })();

    // load played set
    (async () => {
      try {
        const raw = await AsyncStorage.getItem('@playedMazes');
        if (raw) {
          const arr: string[] = JSON.parse(raw);
          setPlayedSet(new Set(arr));
        }
      } catch (e) {
        console.warn('Failed to load played set', e);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (isPro) {
      setAvailableHints(Number.POSITIVE_INFINITY);
      setAvailableSlices(Number.POSITIVE_INFINITY);
    } else {
      setAvailableHints((value) =>
        value === Number.POSITIVE_INFINITY ? BASE_RESOURCE_BUNDLE : Math.min(value, BASE_RESOURCE_BUNDLE)
      );
      setAvailableSlices((value) =>
        value === Number.POSITIVE_INFINITY ? BASE_RESOURCE_BUNDLE : Math.min(value, BASE_RESOURCE_BUNDLE)
      );
    }
  }, [isPro]);

  useEffect(() => {
    if (!geometry) {
      setStrokePoints([]);
      return;
    }
    const points = playerCells.map((cell) => cellCenter(geometry, cell));
    if (activePointer) {
      points.push(activePointer);
    }
    setStrokePoints(points.length ? points : [cellCenter(geometry, { x: 0, y: 0 })]);
  }, [activePointer, geometry, playerCells]);

  useEffect(() => {
    if (isPro) {
      setIapMessage('Pro unlocked — enjoy the maze!');
    }
  }, [isPro]);

  const solutionCells = useMemo(() => makeSolutionCells(solutionMoves), [solutionMoves]);

  const evaluateMoves = useCallback(
    (moves: number[]) => {
      if (!solutionMoves.length) {
        setDivergence(-1);
        setProgress(0);
        return { divergenceIndex: -1, correctCount: 0 };
      }
      const divergenceIndex = firstDivergence(moves, solutionMoves);
      const correctCount = divergenceIndex === -1 ? Math.min(moves.length, solutionMoves.length) : divergenceIndex;
      setDivergence(divergenceIndex);
      setProgress(correctCount);
      return { divergenceIndex, correctCount };
    },
    [solutionMoves]
  );

  const resetPlayerState = useCallback(
    (mazeOverride?: MazeRecord | null) => {
      const initialCell: GridPoint = { x: 0, y: 0 };
      playerMovesRef.current = [];
      playerCellsRef.current = [initialCell];
      setPlayerMoves([]);
      setPlayerCells([initialCell]);
      setDivergence(-1);
      setProgress(0);
      if (hintTimerRef.current) {
        clearTimeout(hintTimerRef.current);
        hintTimerRef.current = null;
      }
      setHintCells([]);
      setHintCount(0);
      setSliceCount(0);
      setCompleted(false);
      setStars(0);
      setElapsedMs(0);
      gestureStartRef.current = null;
      lastCellRef.current = `${initialCell.x},${initialCell.y}`;
      setActivePointer(null);
      setSliceActive(false);
      setBlockedMarker(null);

      // Use the ref for currentMaze to avoid recreating this callback when currentMaze changes
      const targetMaze = mazeOverride ?? currentMazeRef.current;
      const targetGeometry = computeGeometry(targetMaze, canvasSize);
      if (targetGeometry) {
        setStrokePoints([cellCenter(targetGeometry, initialCell)]);
      } else {
        setStrokePoints([]);
      }
    },
    [canvasSize]
  );

  const startGame = useCallback(
    (skill: SkillTier, difficulty: Difficulty) => {
      if (!puzzles.length) return;

      // Prefer mazes matching skill+difficulty and not yet played.
      const candidates = puzzles.filter((item) => item.skillTier === skill && item.difficulty === difficulty);
      const pool = candidates.length ? candidates : puzzles;

      // Filter out already played ones
      const unplayed = pool.filter((item) => {
        const id = `${item.skillTier}-${item.difficulty}-${item.alg}-${item.v}`;
        return !playedSet.has(id);
      });

      const pickPool = unplayed.length ? unplayed : pool;
      const selection = pickPool[Math.floor(Math.random() * pickPool.length)];
      const newOpenings = decodeOpenings(selection.g, selection.w, selection.h);
      const newMoves = decodeMoves(selection.p, selection.L);

      // Debug: surface detailed selection and decode info for troubleshooting
      // eslint-disable-next-line no-console
      console.info('Selected puzzle', {
        id: (selection as any).id,
        alg: selection.alg,
        v: selection.v,
        w: selection.w,
        h: selection.h,
        openingsLength: newOpenings.length,
        startMask: newOpenings[0],
        firstRowMasks: Array.from(newOpenings.slice(0, Math.min(newOpenings.length, selection.w))).map((b) => b.toString(16)),
      });
      setCurrentMaze(selection);
      setOpenings(newOpenings);
      setSolutionMoves(newMoves);
      resetPlayerState(selection);
      // geometry logging will happen in handleCanvasLayout when we measure
      setStartTimestamp(Date.now());
    },
    [canvasSize, puzzles, resetPlayerState, playedSet]
  );

  const markMazePlayed = useCallback(async (maze: MazeRecord | null) => {
    if (!maze) return;
    try {
      const id = `${maze.skillTier}-${maze.difficulty}-${maze.alg}-${maze.v}`;
      setPlayedSet((prev) => {
        if (prev.has(id)) return prev;
        const next = new Set(prev);
        next.add(id);
        AsyncStorage.setItem('@playedMazes', JSON.stringify(Array.from(next))).catch((e) =>
          console.warn('Failed to save played set', e)
        );
        return next;
      });
    } catch (e) {
      console.warn('Failed to mark maze played', e);
    }
  }, []);

  const goBackToDifficulty = useCallback(() => {
    // Stop the current game and return to difficulty selection
    resetPlayerState(null);
    setCurrentMaze(null);
    setSelectedDifficulty(null);
  }, [resetPlayerState]);

  const goBackToMain = useCallback(() => {
    // Stop the current game and return to main skill selection
    resetPlayerState(null);
    setCurrentMaze(null);
    setSelectedDifficulty(null);
    setSelectedSkill(null);
  }, [resetPlayerState]);

  const attemptSlice = useCallback(
    async (segmentIndex?: number) => {
      if (!currentMaze) {
        return false;
      }
      let anchor = segmentIndex;
      if (anchor === undefined) {
        const fallback = divergence === -1 ? progress : divergence;
        anchor = fallback;
      }
      if (anchor === undefined || anchor < 0) {
        return false;
      }
      if (anchor >= playerMovesRef.current.length) {
        return false;
      }

      const trimmedMoves = playerMovesRef.current.slice(0, anchor);
      const trimmedCells = playerCellsRef.current.slice(0, anchor + 1);
      // if trimming doesn't change anything, don't charge or apply
      if (trimmedCells.length === playerCellsRef.current.length) {
        return false;
      }

      // Only now check and consume slice resources (or show rewarded ad)
      if (!isPro) {
        if (availableSlices <= 0) {
          const rewarded = await ads.showRewarded('slice');
          if (!rewarded) {
            return false;
          }
          setAvailableSlices(BASE_RESOURCE_BUNDLE);
        }
        setAvailableSlices((value) =>
          value === Number.POSITIVE_INFINITY ? value : Math.max(value - 1, 0)
        );
      }

      playerMovesRef.current = trimmedMoves;
      playerCellsRef.current = trimmedCells;
      setPlayerMoves(trimmedMoves);
      setPlayerCells(trimmedCells);
      const tail = trimmedCells[trimmedCells.length - 1];
      lastCellRef.current = tail ? `${tail.x},${tail.y}` : null;
      setSliceCount((count) => count + 1);
      setActivePointer(null);
      setBlockedMarker(null);
  setSliceHighlight(null);
      evaluateMoves(trimmedMoves);
      return true;
    },
    [ads, availableSlices, currentMaze, divergence, evaluateMoves, isPro, progress]
  );

  const handleWin = useCallback(
    async (moves: number[], cells: GridPoint[]) => {
      if (!currentMaze || completed) {
        return;
      }
      const finishTime = startTimestamp ? Date.now() - startTimestamp : elapsedMs;
      const earnedStars = computeStars(finishTime, hintCount, sliceCount);
      setCompleted(true);
      setStars(earnedStars);
      setElapsedMs(finishTime);
      if (!isPro) {
        await ads.showInterstitial();
      }
      await recordGameResult({
        mazeId: `${currentMaze.skillTier}-${currentMaze.difficulty}-${currentMaze.alg}-${currentMaze.v}`,
        moves: moves.length,
        hintsUsed: hintCount,
        slicesUsed: sliceCount,
        durationMs: finishTime,
        completedAt: Date.now(),
        stars: earnedStars,
      });
      // Persist that this maze was played so future selections prefer unplayed puzzles
      await markMazePlayed(currentMaze);
    },
    [ads, completed, currentMaze, elapsedMs, hintCount, isPro, sliceCount, startTimestamp, markMazePlayed]
  );

  const processCell = useCallback(
    (target: GridPoint) => {
      if (!currentMaze) {
        return;
      }
      const cells = playerCellsRef.current;
      const last = cells[cells.length - 1];
      if (last.x === target.x && last.y === target.y) {
        return;
      }

      const prev = cells[cells.length - 2];
      if (prev && prev.x === target.x && prev.y === target.y) {
        return;
      }

      const dx = target.x - last.x;
      const dy = target.y - last.y;
      if (Math.abs(dx) + Math.abs(dy) !== 1) {
        return;
      }

      const directionIndex = DIRECTIONS.findIndex((dir) => dir.dx === dx && dir.dy === dy) as DirectionIndex | -1;
      if (directionIndex === -1) {
        return;
      }

      const mask = openings[last.y * currentMaze.w + last.x] ?? 0;
      if ((mask & DIRECTIONS[directionIndex].mask) === 0) {
        return;
      }

      const nextCells = [...cells, target];
      const nextMoves = [...playerMovesRef.current, directionIndex];

      playerCellsRef.current = nextCells;
      playerMovesRef.current = nextMoves;
      setPlayerCells(nextCells);
      setPlayerMoves(nextMoves);
      lastCellRef.current = `${target.x},${target.y}`;

      const { correctCount, divergenceIndex } = evaluateMoves(nextMoves);
      const reachedGoal = target.x === currentMaze.w - 1 && target.y === currentMaze.h - 1;
      if (reachedGoal) {
        handleWin(nextMoves, nextCells);
        return;
      }

      const requiredMoves = solutionMoves.length > 0 ? solutionMoves.length : currentMaze.L;
      if (divergenceIndex === -1 && correctCount >= requiredMoves) {
        handleWin(nextMoves, nextCells);
      }
    },
    [currentMaze, evaluateMoves, handleWin, openings, solutionMoves]
  );

  const handlePointer = useCallback(
    (rawX: number, rawY: number) => {
      if (!currentMaze || !geometry) {
        return;
      }
      const pointer: CanvasPoint = {
        x: clamp(rawX, geometry.offsetX, geometry.offsetX + geometry.width),
        y: clamp(rawY, geometry.offsetY, geometry.offsetY + geometry.height),
      };

      if (sliceActive) {
        setActivePointer(pointer);
        if (!sliceStartRef.current) {
          sliceStartRef.current = pointer;
        }

        // highlight the cell under the pointer and all cells after it in
        // the current player path so the user can see what will be removed
        const cellUnder = getCellFromPoint(geometry, pointer, currentMaze);
        if (cellUnder) {
          const idx = playerCellsRef.current.findIndex((c) => c.x === cellUnder.x && c.y === cellUnder.y);
          if (idx !== -1) {
            const highlight = playerCellsRef.current.slice(idx + 1);
            setSliceHighlight(highlight.length ? highlight : null);
          } else {
            setSliceHighlight(null);
          }
        } else {
          setSliceHighlight(null);
        }

        return;
      }

      setActivePointer(pointer);

      const cell = getCellFromPoint(geometry, pointer, currentMaze);
      if (!cell) {
        setBlockedMarker(pointer);
        return;
      }

      const cells = playerCellsRef.current;
      const currentCell = cells[cells.length - 1];
      const prevCell = cells[cells.length - 2];

      if (cell.x === currentCell.x && cell.y === currentCell.y) {
        setBlockedMarker(null);
        lastCellRef.current = `${cell.x},${cell.y}`;
        return;
      }

      if (prevCell && prevCell.x === cell.x && prevCell.y === cell.y) {
        setBlockedMarker(pointer);
        return;
      }

      if (lastCellRef.current === `${cell.x},${cell.y}`) {
        setBlockedMarker(null);
        return;
      }

      let progressed = false;
      const maxSteps = currentMaze.w + currentMaze.h;
      for (let step = 0; step < maxSteps; step += 1) {
        const activeCell = playerCellsRef.current[playerCellsRef.current.length - 1];
        if (cell.x === activeCell.x && cell.y === activeCell.y) {
          progressed = true;
          break;
        }

        const dx = cell.x - activeCell.x;
        const dy = cell.y - activeCell.y;
        let directionIndex: DirectionIndex | null = null;
        if (Math.abs(dx) >= Math.abs(dy) && dx !== 0) {
          directionIndex = dx > 0 ? 1 : 3;
        } else if (dy !== 0) {
          directionIndex = dy > 0 ? 2 : 0;
        }
        if (directionIndex === null) {
          break;
        }

        const mask = openings[activeCell.y * currentMaze.w + activeCell.x] ?? 0;
        if ((mask & DIRECTIONS[directionIndex].mask) === 0) {
          break;
        }

        const beforeMoves = playerMovesRef.current.length;
        const nextCell = {
          x: activeCell.x + DIRECTIONS[directionIndex].dx,
          y: activeCell.y + DIRECTIONS[directionIndex].dy,
        };
        processCell(nextCell);
        if (playerMovesRef.current.length === beforeMoves) {
          break;
        }
        progressed = true;
      }

      setBlockedMarker(progressed ? null : pointer);
    },
    [currentMaze, geometry, openings, processCell, sliceActive]
  );

  const performSlice = useCallback(
    async (startPoint: CanvasPoint, endPoint: CanvasPoint) => {
      if (!geometry) {
        return false;
      }
      const clampPoint = (point: CanvasPoint): CanvasPoint => ({
        x: clamp(point.x, geometry.offsetX, geometry.offsetX + geometry.width),
        y: clamp(point.y, geometry.offsetY, geometry.offsetY + geometry.height),
      });
      const a = clampPoint(startPoint);
      const b = clampPoint(endPoint);
      // If the drag is effectively a tap (very short), attempt a proximity
      // cut: find the nearest segment to the tap and cut there if within
      // tolerance. Otherwise, fall back to segment intersection test for
      // swipe cuts.
      const distAB = Math.hypot(a.x - b.x, a.y - b.y);
  const TAP_THRESHOLD = Math.max(10, (geometry.cellSize ?? 20) * 0.35);

      const distancePointToSegment = (p: CanvasPoint, v: CanvasPoint, w: CanvasPoint) => {
        const l2 = (v.x - w.x) * (v.x - w.x) + (v.y - w.y) * (v.y - w.y);
        if (l2 === 0) return Math.hypot(p.x - v.x, p.y - v.y);
        let t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2;
        t = Math.max(0, Math.min(1, t));
        const proj = { x: v.x + t * (w.x - v.x), y: v.y + t * (w.y - v.y) };
        return Math.hypot(p.x - proj.x, p.y - proj.y);
      };

      let cutIndex = -1;
      if (distAB <= TAP_THRESHOLD) {
        // tap: find nearest segment
        let bestDist = Infinity;
        let bestIdx = -1;
        for (let i = 0; i < playerCellsRef.current.length - 1; i += 1) {
          const segStart = cellCenter(geometry, playerCellsRef.current[i]);
          const segEnd = cellCenter(geometry, playerCellsRef.current[i + 1]);
          const d = distancePointToSegment(a, segStart, segEnd);
          if (d < bestDist) {
            bestDist = d;
            bestIdx = i + 1;
          }
        }
        const TOLERANCE = Math.max(8, geometry.cellSize * 0.3);
        if (bestIdx !== -1 && bestDist <= TOLERANCE) {
          cutIndex = bestIdx;
        }
      } else {
        // swipe: detect intersection with any path segment
        for (let i = 0; i < playerCellsRef.current.length - 1; i += 1) {
          const segStart = cellCenter(geometry, playerCellsRef.current[i]);
          const segEnd = cellCenter(geometry, playerCellsRef.current[i + 1]);
          if (segmentsIntersect(a, b, segStart, segEnd)) {
            cutIndex = Math.max(cutIndex, i + 1);
          }
        }
      }

      if (cutIndex !== -1) {
        return attemptSlice(cutIndex);
      }
      return false;
    },
    [attemptSlice, geometry]
  );


  const onGestureEvent = useCallback(
    (event: PanGestureHandlerGestureEvent) => {
      if (!currentMaze || completed) {
        return;
      }
      setActivePointer({ x: event.nativeEvent.x, y: event.nativeEvent.y });
      handlePointer(event.nativeEvent.x, event.nativeEvent.y);
    },
    [completed, currentMaze, handlePointer]
  );

  const onHandlerStateChange = useCallback(
    (event: PanGestureHandlerStateChangeEvent) => {
      if (!currentMaze || completed) {
        return;
      }
      const { state, x, y } = event.nativeEvent;
      if (state === State.BEGAN) {
        gestureStartRef.current = { x, y, time: Date.now() };
        if (sliceActive && geometry) {
          sliceStartRef.current = {
            x: clamp(x, geometry.offsetX, geometry.offsetX + geometry.width),
            y: clamp(y, geometry.offsetY, geometry.offsetY + geometry.height),
          };
        }
        handlePointer(x, y);
      } else if (state === State.END || state === State.CANCELLED || state === State.FAILED) {
        const snapshot = gestureStartRef.current;
        if (sliceActive && sliceStartRef.current) {
          const startPoint = sliceStartRef.current;
          const endPoint: CanvasPoint = { x, y };
          (async () => {
            const sliced = await performSlice(startPoint, endPoint);
            // If performSlice didn't find a cut (missed due to noisy tap),
            // and the gesture was effectively a tap, fall back to using
            // the highlighted suffix (if any) to compute an anchor and
            // attempt a guaranteed slice there.
            const distAB = Math.hypot(startPoint.x - endPoint.x, startPoint.y - endPoint.y);
            const TAP_THRESHOLD = Math.max(10, (geometry?.cellSize ?? 20) * 0.35);
            if (!sliced && distAB <= TAP_THRESHOLD && sliceHighlight && sliceHighlight.length) {
              const anchor = Math.max(0, playerCellsRef.current.length - sliceHighlight.length - 1);
              await attemptSlice(anchor);
            }
          })();
          sliceStartRef.current = null;
          setSliceActive(false);
        } else if (snapshot) {
          const dt = Date.now() - snapshot.time;
          const dx = x - snapshot.x;
          const dy = y - snapshot.y;
          const distance = Math.hypot(dx, dy);
          const cellSize = geometry
            ? geometry.cellSize
            : Math.min(canvasSize.width / currentMaze.w, canvasSize.height / currentMaze.h);
          if (dt < 200 && distance < cellSize * 0.5) {
            void attemptSlice();
          }
        }
        gestureStartRef.current = null;
        sliceStartRef.current = null;
        setActivePointer(null);
        setBlockedMarker(null);
      }
    },
    [attemptSlice, canvasSize, completed, currentMaze, geometry, handlePointer, performSlice, sliceActive, sliceHighlight]
  );

  const handleCanvasLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setCanvasSize({ width, height });
    // Debug: log measured canvas size and derived geometry for diagnosis
    // eslint-disable-next-line no-console
    console.info('Canvas layout measured', { width, height });
    // compute geometry for the current maze so we can see cellSize/offsets
    try {
      const geo = computeGeometry(currentMaze, { width, height });
      // eslint-disable-next-line no-console
      console.info('Computed geometry', geo);
      if (openings && openings.length) {
        // eslint-disable-next-line no-console
        console.info('Openings sample', {
          total: openings.length,
          startMask: openings[0],
          firstRow: Array.from(openings.slice(0, Math.min(openings.length, currentMaze?.w ?? 0))).map((b) => b.toString(16)),
        });
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('Failed to compute geometry in layout handler', e);
    }
  }, []);

  const requestHint = useCallback(async () => {
    if (!currentMaze || !solutionMoves.length) {
      return;
    }

    if (!isPro) {
      if (availableHints <= 0) {
        const rewarded = await ads.showRewarded('hint');
        if (!rewarded) {
          return;
        }
        setAvailableHints(BASE_RESOURCE_BUNDLE);
      }
      setAvailableHints((value) =>
        value === Number.POSITIVE_INFINITY ? value : Math.max(value - 1, 0)
      );
    }

    setHintCount((count) => count + 1);

    const segment = hintSegment(solutionMoves, progress, divergence, currentMaze.L);
    if (!segment.length) {
      return;
    }

    const startIndex = Math.max(progress, divergence >= 0 ? divergence : progress);
    const highlight: GridPoint[] = [];
    let cursor = solutionCells[Math.min(startIndex, solutionCells.length - 1)];

    segment.forEach((move) => {
      const direction = DIRECTIONS[move as DirectionIndex] ?? { dx: 0, dy: 0 };
      cursor = { x: cursor.x + direction.dx, y: cursor.y + direction.dy };
      highlight.push(cursor);
    });

    setHintCells(highlight);
    if (hintTimerRef.current) {
      clearTimeout(hintTimerRef.current);
    }
    hintTimerRef.current = setTimeout(() => {
      setHintCells([]);
      hintTimerRef.current = null;
    }, HINT_FLASH_DURATION);
  }, [ads, availableHints, currentMaze, divergence, isPro, progress, solutionCells, solutionMoves]);

  const restart = useCallback(() => {
    if (selectedSkill && selectedDifficulty) {
      startGame(selectedSkill, selectedDifficulty);
    }
  }, [selectedDifficulty, selectedSkill, startGame]);

  const upgradeToPro = useCallback(async () => {
    if (iapProcessing) {
      return;
    }
    setIapProcessing(true);
    try {
      const success = await buyProUnlock();
      setIapMessage(success ? 'Pro unlocked — enjoy the maze!' : 'Purchase cancelled.');
    } catch (error) {
      console.warn('Purchase error', error);
      setIapMessage('Purchase failed. Please try again.');
    } finally {
      setIapProcessing(false);
    }
  }, [iapProcessing]);

  const restoreAccess = useCallback(async () => {
    if (iapProcessing) {
      return;
    }
    setIapProcessing(true);
    try {
      const restored = await restorePurchases();
      setIapMessage(restored ? 'Purchase restored.' : 'No purchases found.');
    } catch (error) {
      console.warn('Restore error', error);
      setIapMessage('Restore failed.');
    } finally {
      setIapProcessing(false);
    }
  }, [iapProcessing, restorePurchases]);

  useInterval(Boolean(startTimestamp) && !completed, () => {
    if (startTimestamp) {
      setElapsedMs(Date.now() - startTimestamp);
    }
  }, 500);

  useEffect(() => {
    // Only auto-start a game when the user has selected options and the
    // previous game isn't in a completed state. This prevents an immediate
    // reload after completion.
    if (!completed && selectedSkill && selectedDifficulty && puzzles.length) {
      startGame(selectedSkill, selectedDifficulty);
    }
  }, [puzzles, selectedSkill, selectedDifficulty, startGame]);

  useEffect(() => {
    return () => {
      if (hintTimerRef.current) {
        clearTimeout(hintTimerRef.current);
      }
    };
  }, []);

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}> 
      <Text style={styles.title}>MazeMin Challenge</Text>
      {loading ? (
        <View style={styles.center}> 
          <ActivityIndicator color={theme.colors.accent} />
          <Text style={styles.subtitle}>Loading puzzles...</Text>
        </View>
      ) : !selectedSkill ? (
        <View style={styles.selectionGroup}>
          <Text style={styles.subtitle}>Choose your skill tier</Text>
          <View style={styles.buttonRow}>
            {skillTiers.map((tier) => (
              <Pressable
                key={tier}
                style={({ pressed }) => [
                  styles.choiceButton,
                  pressed && styles.choiceButtonPressed,
                ]}
                onPress={() => setSelectedSkill(tier)}
              >
                <Text style={styles.choiceLabel}>{tier.toUpperCase()}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : !selectedDifficulty ? (
        <View style={styles.selectionGroup}>
          <Text style={styles.subtitle}>Pick your difficulty</Text>
          <View style={styles.buttonRow}>
            {difficulties.map((level) => (
              <Pressable
                key={level}
                style={({ pressed }) => [
                  styles.choiceButton,
                  pressed && styles.choiceButtonPressed,
                ]}
                onPress={() => setSelectedDifficulty(level)}
              >
                <Text style={styles.choiceLabel}>{level.toUpperCase()}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : !currentMaze ? (
        <View style={styles.center}>
          <Text style={styles.subtitle}>No maze available for this combination. Tap Play Random.</Text>
          <Pressable style={styles.primaryButton} onPress={() => startGame(selectedSkill, selectedDifficulty)}>
            <Text style={styles.primaryLabel}>PLAY RANDOM</Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.gameArea}>
          <View style={styles.infoRow}>
            <Text style={styles.infoText}>Skill: {selectedSkill.toUpperCase()}</Text>
            <Text style={styles.infoText}>Difficulty: {selectedDifficulty.toUpperCase()}</Text>
            <Pressable style={styles.secondaryButton} onPress={() => startGame(selectedSkill, selectedDifficulty)}>
              <Text style={styles.secondaryLabel}>Play Random</Text>
            </Pressable>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.stat}>Time: {toMillis(elapsedMs)}</Text>
            <Text style={styles.stat}>Hints: {isPro ? '∞' : availableHints}</Text>
            <Text style={styles.stat}>Slices: {isPro ? '∞' : availableSlices}</Text>
          </View>
          <PanGestureHandler onGestureEvent={onGestureEvent} onHandlerStateChange={onHandlerStateChange}>
            <View style={styles.canvasWrapper} onLayout={handleCanvasLayout}>
              <GameCanvas
                width={canvasSize.width}
                height={canvasSize.height}
                mazeWidth={currentMaze.w}
                mazeHeight={currentMaze.h}
                openings={openings}
                strokePoints={strokePoints}
                hintPath={hintCells}
                playerOpacity={sliceActive ? 0.25 : 1}
                strokeWidth={sliceActive ? 2 : undefined}
                blockedMarker={sliceActive ? null : blockedMarker}
                debugMask={debugMask}
                colors={{
                  background: theme.colors.card,
                  wall: theme.colors.wall,
                  player: theme.colors.player,
                  hint: theme.colors.hint,
                  goal: theme.colors.goal,
                  start: theme.colors.start,
                  blocked: theme.colors.danger,
                }}
              />
              {sliceActive && activePointer && (
                <View style={[styles.scissorOverlay, { left: activePointer.x - 18, top: activePointer.y - 18 }]} pointerEvents="none">
                  <Text style={styles.scissorText}>✂️</Text>
                </View>
              )}
            </View>
          </PanGestureHandler>
          <View style={styles.watchRow}>
            <Pressable style={[styles.secondaryButton, styles.controlButton]} onPress={async () => {
              const rewarded = await ads.showRewarded('slice');
              if (rewarded) setAvailableSlices(BASE_RESOURCE_BUNDLE);
            }}>
              <Text style={styles.secondaryLabel}>Watch to refill Slices</Text>
            </Pressable>
            <Pressable style={[styles.secondaryButton, styles.controlButton]} onPress={async () => {
              const rewarded = await ads.showRewarded('hint');
              if (rewarded) setAvailableHints(BASE_RESOURCE_BUNDLE);
            }}>
              <Text style={styles.secondaryLabel}>Watch to refill Hints</Text>
            </Pressable>
          </View>
          <View style={styles.controlsRow}>
            <Pressable
              style={[styles.primaryButton, styles.controlButton, iapProcessing && styles.buttonDisabled]}
              onPress={requestHint}
              disabled={iapProcessing}
            >
              <Text style={styles.primaryLabel}>Hint</Text>
            </Pressable>
            <Pressable
              style={[
                styles.secondaryButton,
                styles.controlButton,
                styles.sliceButton,
                (iapProcessing || playerMoves.length === 0) && styles.buttonDisabled,
                sliceActive && styles.sliceActive,
              ]}
              onPress={() => {
                if (iapProcessing || playerMoves.length === 0) {
                  return;
                }
                setSliceActive((value) => {
                  const next = !value;
                  if (!next) setSliceHighlight(null);
                  return next;
                });
              }}
              disabled={iapProcessing || playerMoves.length === 0}
            >
              <Text style={styles.sliceLabel}>{sliceActive ? 'Cancel' : 'Slice'}</Text>
            </Pressable>
            <Pressable
              style={[styles.secondaryButton, styles.controlButton, iapProcessing && styles.buttonDisabled]}
              onPress={restart}
              disabled={iapProcessing}
            >
              <Text style={styles.secondaryLabel}>Reset</Text>
            </Pressable>
            <Pressable
              style={[styles.secondaryButton, styles.controlButton]}
              onPress={goBackToDifficulty}
            >
              <Text style={styles.secondaryLabel}>Back to Difficulty</Text>
            </Pressable>
            <Pressable
              style={[styles.secondaryButton, styles.controlButton]}
              onPress={goBackToMain}
            >
              <Text style={styles.secondaryLabel}>Main Menu</Text>
            </Pressable>
            {__DEV__ && (
              <Pressable style={[styles.secondaryButton, styles.controlButton]} onPress={() => setDebugMask((v) => !v)}>
                <Text style={styles.secondaryLabel}>{debugMask ? 'Hide Masks' : 'Show Masks'}</Text>
              </Pressable>
            )}
          </View>
          {!isPro && (
            <View style={styles.iapRow}>
              <Text style={styles.iapText}>Unlock Pro to remove ads and gain unlimited hints & slices.</Text>
              <View style={styles.iapButtons}>
                <Pressable
                  style={[styles.secondaryButton, styles.controlButton, iapProcessing && styles.buttonDisabled]}
                  onPress={restoreAccess}
                  disabled={iapProcessing}
                >
                  <Text style={styles.secondaryLabel}>Restore</Text>
                </Pressable>
                <Pressable
                  style={[styles.primaryButton, styles.controlButton, iapProcessing && styles.buttonDisabled]}
                  onPress={upgradeToPro}
                  disabled={iapProcessing}
                >
                  <Text style={styles.primaryLabel}>Go Pro</Text>
                </Pressable>
              </View>
            </View>
          )}
          {iapMessage && (
            <Text style={styles.iapMessage}>{iapMessage}</Text>
          )}
          {completed && (
            <View style={styles.resultsCard}>
              <Text style={styles.resultsTitle}>Maze cleared!</Text>
              <Text style={styles.resultsText}>Time: {toMillis(elapsedMs)}</Text>
              <Text style={styles.resultsText}>Stars: {'★'.repeat(stars)}</Text>
            </View>
          )}
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: theme.colors.textPrimary,
    textAlign: 'center',
    marginBottom: 12,
  },
  subtitle: {
    fontSize: 16,
    color: theme.colors.textSecondary,
    marginTop: 12,
    textAlign: 'center',
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  selectionGroup: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    marginTop: 16,
  },
  choiceButton: {
    backgroundColor: theme.colors.card,
    borderRadius: theme.radius.lg,
    paddingVertical: 14,
    paddingHorizontal: 20,
    minWidth: 120,
    alignItems: 'center',
    margin: 8,
  },
  choiceButtonPressed: {
    transform: [{ scale: 0.97 }],
    opacity: 0.85,
  },
  choiceLabel: {
    color: theme.colors.textPrimary,
    fontSize: 16,
    fontWeight: '600',
  },
  primaryButton: {
    backgroundColor: theme.colors.accent,
    borderRadius: theme.radius.md,
    paddingVertical: 12,
    paddingHorizontal: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 16,
  },
  primaryLabel: {
    color: '#04131c',
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  secondaryButton: {
    borderColor: theme.colors.accentMuted,
    borderWidth: 1,
    borderRadius: theme.radius.md,
    paddingVertical: 10,
    paddingHorizontal: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryLabel: {
    color: theme.colors.accentMuted,
    fontWeight: '600',
  },
  controlButton: {
    flex: 1,
    marginHorizontal: 6,
  },
  buttonDisabled: {
    opacity: 0.7,
  },
  sliceButton: {
    borderColor: theme.colors.danger,
  },
  sliceLabel: {
    color: theme.colors.danger,
    fontWeight: '700',
  },
  sliceActive: {
    backgroundColor: "rgba(239,68,68,0.12)",
    borderColor: theme.colors.danger,
  },
  gameArea: {
    flex: 1,
    paddingBottom: 16,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginVertical: 6,
  },
  infoText: {
    color: theme.colors.textSecondary,
    fontSize: 14,
  },
  stat: {
    color: theme.colors.textPrimary,
    fontSize: 15,
    fontWeight: '600',
  },
  canvasWrapper: {
    // allocate a generous portion of the screen to the maze canvas so it
    // renders larger on phones and simulators
    height: '44%',
    minHeight: 260,
    maxHeight: 520,
    alignItems: 'center',
    justifyContent: 'center',
  },
  controlsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 12,
  },
  resultsCard: {
    backgroundColor: theme.colors.card,
    borderRadius: theme.radius.lg,
    padding: 16,
    alignItems: 'center',
    marginTop: 12,
  },
  resultsTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: theme.colors.textPrimary,
    marginBottom: 6,
  },
  resultsText: {
    color: theme.colors.textSecondary,
    fontSize: 15,
  },
  scissorOverlay: {
    position: 'absolute',
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(239,68,68,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  scissorText: {
    fontSize: 22,
  },
  watchRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  iapRow: {
    marginTop: 12,
    backgroundColor: theme.colors.card,
    padding: 12,
    borderRadius: theme.radius.md,
  },
  iapText: {
    color: theme.colors.textSecondary,
    fontSize: 13,
    marginBottom: 8,
  },
  iapButtons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  iapMessage: {
    marginTop: 8,
    color: theme.colors.textSecondary,
    textAlign: 'center',
  },
});

export default GameScreen;
