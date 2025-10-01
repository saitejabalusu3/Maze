# MazeMin (Expo React Native)

MazeMin is a 2D maze runner built with Expo + TypeScript. Puzzles come from the MazeMin v1 JSONL feed and render with Skia for smooth wall drawing and gesture-driven tracing. Rewarded ads refill hint/slice allowances, while a one-time IAP unlock removes ads and grants unlimited assists.

## Getting Started

1. **Install dependencies**
   ```bash
   npm install
   ```
2. **Launch Expo dev tools**
   ```bash
   npx expo start
   ```
3. Open the project using the QR code (Expo Go), Android emulator (`npm run android`), or iOS simulator (`npm run ios`).

> This project targets Expo SDK 49 (React Native 0.72). Ensure you are running the matching Expo CLI.

## Puzzles

- Drop your `puzzles.jsonl` file into `assets/puzzles.jsonl`. Each line must be a MazeMin record with the schema `{ v, alg, w, h, g, p, L, hints[], skillTier, difficulty }`.
- During development you can swap in single-maze fixtures (like the provided `10.json` entry) to test layout variations.
- The loader picks a puzzle by matching the selected skill tier and difficulty, or falls back to a random maze if none match.

## Key Code Paths

- `src/maze/decoder.ts` — Browser-safe base64 decoding + maze data unpacking.
- `src/maze/engine.ts` — Divergence detection and hint slicing.
- `src/ui/GameCanvas.tsx` — Skia-based wall rendering, path polyline, and hint overlays.
- `src/screens/GameScreen.tsx` — Gesture handling, state management, hint/slice tools, win detection, and AsyncStorage score logging.
- `src/services/ads.ts` — Rewarded + interstitial wrappers using Google Mobile Ads test IDs.
- `src/services/iap.ts` — One-time “Pro” unlock via `react-native-iap`, with AsyncStorage-backed fallback mock mode.
- `src/services/profile.ts` — Persists recent run history to `AsyncStorage` (`maze:history`).

## Monetisation Flow

- **Rewarded ad** (`ads.showRewarded`) refills hints or slices when the player is out of stock.
- **Interstitial ad** fires after a win (skipped automatically for Pro users).
- **Pro unlock** (`Go Pro` button) removes ads and sets `isPro` → unlimited hints/slices. Purchases and restores sync to `AsyncStorage` key `maze:pro`.

## Project Notes

- Canvas interactions use `react-native-gesture-handler`. Short, fast strokes trigger a “slice” rewind back to the last correct move.
- Player progress, hint use, and slice counts feed a simple 3-star scoring model and persist locally.
- Theme tokens live in `src/theme/index.ts` for quick palette tweaks.
- Babel is configured with `react-native-reanimated` plugin; TypeScript config lives in `tsconfig.json`.

## Building & Release

- Update `app.json` package identifiers (`com.mazemin.game`) before shipping.
- Replace AdMob test IDs with your production IDs when ready.
- Run EAS builds to produce native binaries (`eas build --platform ios|android`).

## Troubleshooting

- If ads fail to initialise in simulator, confirm Play Services / Google frameworks are available or temporarily enable Pro mode via the mock fallback.
- The puzzle loader logs to the console when malformed JSONL entries are encountered.
- Purge AsyncStorage (e.g., using Expo dev tools) to reset Pro status, hint/slice balances, and history.
