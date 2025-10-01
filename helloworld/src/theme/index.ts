export const theme = {
  colors: {
    background: '#0f172a',
    surface: '#1e293b',
    card: '#111827',
    accent: '#14b8a6',
    accentMuted: '#0ea5e9',
    textPrimary: '#f8fafc',
    textSecondary: '#94a3b8',
    wall: '#64748b',
    player: '#f97316',
    hint: '#38bdf8',
    goal: '#22c55e',
    start: '#6366f1',
    danger: '#ef4444',
  },
  spacing: (multiplier: number) => multiplier * 8,
  radius: {
    sm: 8,
    md: 12,
    lg: 16,
  },
};

export type Theme = typeof theme;
