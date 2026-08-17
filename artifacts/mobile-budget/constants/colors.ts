/**
 * Design tokens derived from the sibling web artifact (family-budget/src/index.css).
 * Earthy Greens and Rich Ambers palette — synced so both artifacts share the same identity.
 */

const colors = {
  light: {
    // Legacy aliases
    text: '#133921',
    tint: '#2e6b44',

    // Surfaces
    background: '#f7faf6',
    foreground: '#133921',

    // Cards
    card: '#ffffff',
    cardForeground: '#133921',

    // Primary — forest green (HSL 142 40% 30%)
    primary: '#2e6b44',
    primaryForeground: '#ffffff',

    // Secondary — rich amber (HSL 30 80% 45%)
    secondary: '#cf7217',
    secondaryForeground: '#ffffff',

    // Muted
    muted: '#edf2ed',
    mutedForeground: '#5c8a6c',

    // Accent — warm amber tint (HSL 30 80% 95%)
    accent: '#fcf3e8',
    accentForeground: '#a15912',

    // Destructive
    destructive: '#d92626',
    destructiveForeground: '#ffffff',

    // Borders / inputs
    border: '#e0ebe4',
    input: '#d1e0d7',
  },

  dark: {
    text: '#f7faf6',
    tint: '#4a9b60',

    background: '#0f2217',
    foreground: '#f7faf6',

    card: '#162d20',
    cardForeground: '#f7faf6',

    primary: '#4a9b60',
    primaryForeground: '#ffffff',

    secondary: '#d4801f',
    secondaryForeground: '#ffffff',

    muted: '#1a3325',
    mutedForeground: '#7aaa8a',

    accent: '#2a4535',
    accentForeground: '#f0c070',

    destructive: '#e53e3e',
    destructiveForeground: '#ffffff',

    border: '#1e3b2b',
    input: '#244033',
  },

  // 0.75rem = 12px — matches web app's --radius: 0.75rem
  radius: 12,
};

export default colors;
