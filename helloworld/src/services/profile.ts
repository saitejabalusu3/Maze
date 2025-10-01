import AsyncStorage from '@react-native-async-storage/async-storage';

export type GameResult = {
  mazeId: string;
  moves: number;
  hintsUsed: number;
  slicesUsed: number;
  durationMs: number;
  completedAt: number;
  stars: number;
};

const STORAGE_KEY = 'maze:history';
const HISTORY_LIMIT = 100;

export const loadHistory = async (): Promise<GameResult[]> => {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as GameResult[];
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed;
  } catch (error) {
    console.warn('Failed to read history', error);
    return [];
  }
};

export const recordGameResult = async (result: GameResult): Promise<void> => {
  const history = await loadHistory();
  const next = [result, ...history].slice(0, HISTORY_LIMIT);
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch (error) {
    console.warn('Failed to persist history', error);
  }
};
