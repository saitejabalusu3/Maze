import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { Canvas, Path as SkiaPath, Rect, Skia, Circle } from '@shopify/react-native-skia';
import { DIRECTION_MASK } from '../maze/decoder';

export type GridPoint = { x: number; y: number };
export type CanvasPoint = { x: number; y: number };

export type GameCanvasProps = {
  width: number;
  height: number;
  mazeWidth: number;
  mazeHeight: number;
  openings: Uint8Array;
  strokePoints: CanvasPoint[];
  hintPath?: GridPoint[];
  sliceHighlight?: GridPoint[];
  blockedMarker?: CanvasPoint | null;
  strokeWidth?: number;
  playerOpacity?: number;
  colors: {
    background: string;
    wall: string;
    player: string;
    hint: string;
    goal: string;
    start: string;
    blocked: string;
  };
  debugMask?: boolean;
};

const DEFAULT_STROKE = 3;

export const GameCanvas: React.FC<GameCanvasProps> = ({
  width,
  height,
  mazeWidth,
  mazeHeight,
  openings,
  strokePoints,
  hintPath,
  sliceHighlight,
  blockedMarker,
  strokeWidth = DEFAULT_STROKE,
  playerOpacity = 1,
  colors,
  debugMask = false,
}) => {
  const cellSize = Math.min(width / mazeWidth, height / mazeHeight);
  const offsetX = (width - mazeWidth * cellSize) / 2;
  const offsetY = (height - mazeHeight * cellSize) / 2;

  const wallsPath = useMemo(() => {
    const path = Skia.Path.Make();
    const moveTo = (x: number, y: number) => path.moveTo(x, y);
    const lineTo = (x: number, y: number) => path.lineTo(x, y);
    // Determine an effective stroke width that scales with the cell size so
    // walls don't visually close small openings. Also compute an inset so
    // wall segments are shortened slightly at their ends to leave a small
    // visible gap between orthogonal walls.
    const effectiveStroke = Math.max(1, Math.min(strokeWidth, Math.max(1, cellSize * 0.12)));
    const inset = Math.max(0.5, effectiveStroke * 0.6);

    // Draw internal walls once per shared edge: draw North and West edges
    // for each cell. Then draw the outer East/South border where needed.
    for (let y = 0; y < mazeHeight; y += 1) {
      for (let x = 0; x < mazeWidth; x += 1) {
        const idx = y * mazeWidth + x;
        const mask = openings[idx] ?? 0;
        const left = offsetX + x * cellSize;
        const top = offsetY + y * cellSize;
        const right = left + cellSize;
        const bottom = top + cellSize;

        // North wall for this cell (unique edge). Shorten by inset at both
        // ends so adjacent orthogonal walls don't overlap and visually
        // close the opening.
        if ((mask & DIRECTION_MASK.N) === 0) {
          moveTo(left + inset, top);
          lineTo(right - inset, top);
        }
        // West wall for this cell (unique edge)
        if ((mask & DIRECTION_MASK.W) === 0) {
          moveTo(left, top + inset);
          lineTo(left, bottom - inset);
        }
      }
    }

    // Draw East border where the eastern opening is closed
    for (let y = 0; y < mazeHeight; y += 1) {
      const x = mazeWidth - 1;
      const idx = y * mazeWidth + x;
      const mask = openings[idx] ?? 0;
      if ((mask & DIRECTION_MASK.E) === 0) {
        const left = offsetX + x * cellSize;
        const top = offsetY + y * cellSize;
        const right = left + cellSize;
        const bottom = top + cellSize;
        moveTo(right, top + inset);
        lineTo(right, bottom - inset);
      }
    }

    // Draw South border where the southern opening is closed
    for (let x = 0; x < mazeWidth; x += 1) {
      const y = mazeHeight - 1;
      const idx = y * mazeWidth + x;
      const mask = openings[idx] ?? 0;
      if ((mask & DIRECTION_MASK.S) === 0) {
        const left = offsetX + x * cellSize;
        const top = offsetY + y * cellSize;
        const right = left + cellSize;
        const bottom = top + cellSize;
        moveTo(left + inset, bottom);
        lineTo(right - inset, bottom);
      }
    }

    return path;
  }, [mazeHeight, mazeWidth, offsetX, offsetY, openings, cellSize, strokeWidth]);

  const playerSkiaPath = useMemo(() => {
    const path = Skia.Path.Make();
    if (!strokePoints.length) {
      return path;
    }

    const first = strokePoints[0];
    path.moveTo(first.x, first.y);
    for (let i = 1; i < strokePoints.length; i += 1) {
      const point = strokePoints[i];
      path.lineTo(point.x, point.y);
    }

    return path;
  }, [strokePoints]);

  const hintRects = useMemo(() => {
    if (!hintPath || !hintPath.length) {
      return [] as JSX.Element[];
    }

    // Build rects while guarding against out-of-bounds coordinates and
    // ensuring each child has a unique key to avoid React duplicate-key warnings.
    return hintPath
      .map((point, idx) => {
        if (point.x < 0 || point.x >= mazeWidth || point.y < 0 || point.y >= mazeHeight) {
          return null;
        }
        const key = `hint-${idx}-${point.x},${point.y}`;
        const left = offsetX + point.x * cellSize;
        const top = offsetY + point.y * cellSize;
        return (
          <Rect
            key={key}
            x={left}
            y={top}
            width={cellSize}
            height={cellSize}
            color={colors.hint}
            opacity={0.25}
          />
        );
      })
      .filter(Boolean) as JSX.Element[];
  }, [hintPath, cellSize, offsetX, offsetY, colors.hint, mazeWidth, mazeHeight]);

  const sliceRects = useMemo(() => {
    if (!sliceHighlight || !sliceHighlight.length) {
      return [] as JSX.Element[];
    }
    return sliceHighlight
      .map((point: GridPoint, idx: number) => {
        if (point.x < 0 || point.x >= mazeWidth || point.y < 0 || point.y >= mazeHeight) {
          return null;
        }
        const key = `slice-${idx}-${point.x},${point.y}`;
        const left = offsetX + point.x * cellSize;
        const top = offsetY + point.y * cellSize;
        return (
          <Rect
            key={key}
            x={left}
            y={top}
            width={cellSize}
            height={cellSize}
            color={colors.blocked}
            opacity={0.28}
          />
        );
      })
      .filter(Boolean) as JSX.Element[];
  }, [sliceHighlight, cellSize, offsetX, offsetY, colors.blocked]);

  const maskRects = useMemo(() => {
    if (!debugMask) return [] as JSX.Element[];
    const rects: JSX.Element[] = [];
    for (let y = 0; y < mazeHeight; y += 1) {
      for (let x = 0; x < mazeWidth; x += 1) {
        const idx = y * mazeWidth + x;
        const mask = openings[idx] ?? 0;
        const left = offsetX + x * cellSize;
        const top = offsetY + y * cellSize;
        const color = mask === 0 ? 'rgba(239,68,68,0.28)' : 'rgba(16,185,129,0.18)';
        rects.push(
          <Rect key={`mask-${x}-${y}`} x={left} y={top} width={cellSize} height={cellSize} color={color} />
        );
      }
    }
    return rects;
  }, [debugMask, openings, cellSize, offsetX, offsetY, mazeWidth, mazeHeight]);

  return (
    <View style={styles.container}>
      <Canvas style={{ width, height }}>
        <Rect x={0} y={0} width={width} height={height} color={colors.background} />
        <Rect
          x={offsetX}
          y={offsetY}
          width={mazeWidth * cellSize}
          height={mazeHeight * cellSize}
          color={colors.background}
        />
        {hintRects}
  {sliceRects}
        <SkiaPath
          path={wallsPath}
          color={colors.wall}
          style="stroke"
          // Use the same dynamic effectiveStroke calculation for rendering
          // so the visual stroke matches the inset used when building the
          // path.
          strokeWidth={Math.max(1, Math.min(strokeWidth, Math.max(1, cellSize * 0.12)))}
          strokeJoin="miter"
          strokeCap="butt"
        />
        <Rect
          x={offsetX + (mazeWidth - 1) * cellSize}
          y={offsetY + (mazeHeight - 1) * cellSize}
          width={cellSize}
          height={cellSize}
          color={colors.goal}
          opacity={0.3}
        />
        <Rect
          x={offsetX}
          y={offsetY}
          width={cellSize}
          height={cellSize}
          color={colors.start}
          opacity={0.4}
        />
        <SkiaPath
          path={playerSkiaPath}
          color={colors.player}
          style="stroke"
          strokeWidth={Math.max(1, (Math.min(strokeWidth, Math.max(1, cellSize * 0.12)) * 0.75))}
          strokeJoin="round"
          opacity={playerOpacity}
        />
        {blockedMarker && (
          <Circle cx={blockedMarker.x} cy={blockedMarker.y} r={cellSize * 0.18} color={colors.blocked} />
        )}
      </Canvas>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    width: '100%',
    aspectRatio: 1,
  },
});

export default GameCanvas;
