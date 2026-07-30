// Keep the desktop bundle on the package boundary so validation cannot drift
// into a launcher-only interpretation of the user's state document.
export { mergeState, normalizeState, safeParseAppState } from '@void/shared';
