/**
 * The class that sets a game's name in the title face (see `.game-title` in
 * index.css; the @fontsource import lives in main.tsx).
 *
 * Every game shares the one script face. A game's identity is its colours and
 * its name, so `Game.titleFont` — still present on stored games from when each
 * had a face of its own — is no longer read.
 */
export const GAME_TITLE = 'game-title';
