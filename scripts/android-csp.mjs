import { createHash } from 'node:crypto';

/**
 * The Android WebView gets no HTTP headers from Capacitor's local server, so its
 * content policy goes into the page as a meta tag. Inline scripts are allowed by
 * hash only. Network calls the page makes itself: the GitHub release check.
 * The feed, Wi-Fi sync and update downloads use native HTTP, outside the page.
 */
export function androidPolicy(html) {
  const hashes = [...html.replace(/\r\n?/g, '\n').matchAll(/<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map(
    (match) => `'sha256-${createHash('sha256').update(match[1]).digest('base64')}'`,
  );
  return [
    "default-src 'self'",
    `script-src 'self' ${hashes.join(' ')}`.trim(),
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "connect-src 'self' https://api.github.com",
    "font-src 'self' data:",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
}

/** The page with its policy as the first thing in <head>. */
export function withAndroidPolicy(html) {
  if (html.includes('http-equiv="Content-Security-Policy"')) return html;
  const normalized = html.replace(/\r\n?/g, '\n');
  const meta = `<meta http-equiv="Content-Security-Policy" content="${androidPolicy(normalized)}" />`;
  return normalized.replace(/<head>/i, `<head>\n    ${meta}`);
}
