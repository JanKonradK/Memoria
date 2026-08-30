import { readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import type { Plugin } from 'vite';

/**
 * Collapses the build into ONE `.html` file that runs from `file://` — the copy
 * you hand a friend. Everything the page needs (JS, CSS, fonts, favicon) becomes
 * an inline or `data:` payload, because a `file://` page has no server to make a
 * second request to and Chrome blocks cross-file module loads.
 *
 * The build settings this depends on live in `config()` below, not in
 * vite.config.ts, so they cannot drift away from the plugin that needs them.
 *
 * This runs in `writeBundle`, on the written files, deliberately: during
 * `generateBundle` the CSS still carries unresolved `__VITE_ASSET__` placeholders
 * instead of font filenames, so nothing would match and Vite would then paste the
 * real URLs back into the inlined <style> — leaving a "single" file that still
 * asks the disk for 66 fonts.
 */
export function singleFile(): Plugin {
  return {
    name: 'memoria-single-file',
    apply: 'build',
    enforce: 'post',

    config() {
      return {
        build: {
          assetsInlineLimit: 0, // this plugin does the inlining, so Vite must not
          cssCodeSplit: false,
          // public/ is copied so favicon.svg can be inlined from disk; writeBundle
          // deletes everything it did not inline.
          copyPublicDir: true,
          modulePreload: { polyfill: false },
          rollupOptions: {
            output: {
              // Every lazy route and the deferred motion feature set folds back
              // into the entry chunk — a dynamic import has nothing to fetch.
              inlineDynamicImports: true,
            },
          },
        },
      };
    },

    writeBundle(options) {
      const dir = options.dir;
      if (!dir) throw new Error('single-file build has no output directory');

      const files = listFiles(dir);
      const html = pickOne(files, '.html', dir);
      const js = pickOne(files, '.js', dir);
      const css = pickOne(files, '.css', dir);

      const assets = new Map<string, Uint8Array>();
      for (const file of files) {
        if (file === html || file === js || file === css) continue;
        assets.set(basename(file), readFileSync(file));
      }

      const page = inlineHtml(readFileSync(html, 'utf8'), {
        js: readFileSync(js, 'utf8'),
        css: inlineFonts(readFileSync(css, 'utf8'), assets),
        favicon: assets.get('favicon.svg'),
      });

      for (const entry of readdirSync(dir)) rmSync(join(dir, entry), { recursive: true, force: true });
      writeFileSync(join(dir, 'Memoria.html'), page);
    },
  };
}

function listFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? listFiles(path) : [path];
  });
}

function pickOne(files: string[], ext: string, dir: string): string {
  const matches = files.filter((file) => extname(file) === ext);
  if (matches.length !== 1) {
    throw new Error(`single-file build expected exactly one ${ext} in ${dir}, found ${matches.length}`);
  }
  return matches[0];
}

function dataUri(mime: string, bytes: Uint8Array): string {
  return `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`;
}

/**
 * `</script` and `</style` close the host element wherever they appear, including
 * inside a string literal. The backslash is inert in both JS and CSS.
 */
function escapeClosingTags(code: string): string {
  return code.replace(/<\/(script|style)/gi, '<\/$1');
}

/** Turns every emitted font URL into a `data:` payload and drops the .woff twins. */
function inlineFonts(css: string, assets: Map<string, Uint8Array>): string {
  // @fontsource lists woff2 first and woff as the fallback. Every browser that can
  // run this app reads woff2, so inlining the fallback would add ~1 MB for nothing.
  const withoutWoff = css.replace(/\s*,\s*url\([^)]+\.woff\)\s*format\(["']woff["']\)/gi, '');

  // Deliberately narrow: Tailwind emits its own inline `url("data:image/svg+xml,…")`
  // payloads full of commas, parens and quotes that a generic url() pattern shreds.
  // Only a bare path ending in an emitted asset extension is rewritten.
  const emitted = /url\(\s*(["']?)((?:(?!data:)[^"')\s])+\.(?:woff2|woff|png|svg|jpe?g|gif|webp))\1\s*\)/g;

  let inlined = 0;
  const out = withoutWoff.replace(emitted, (_match, _quote: string, url: string) => {
    const bytes = assets.get(basename(url));
    if (!bytes) throw new Error(`single-file build could not inline CSS asset: ${url}`);
    inlined += 1;
    return `url(${dataUri(mimeFor(url), bytes)})`;
  });
  if (inlined === 0) throw new Error('single-file build inlined no fonts — the CSS URLs did not match');
  return out;
}

function mimeFor(url: string): string {
  if (url.endsWith('.woff2')) return 'font/woff2';
  if (url.endsWith('.woff')) return 'font/woff';
  if (url.endsWith('.svg')) return 'image/svg+xml';
  if (url.endsWith('.png')) return 'image/png';
  return 'application/octet-stream';
}

function inlineHtml(html: string, parts: { js: string; css: string; favicon?: Uint8Array }): string {
  let out = html
    .replace(
      /<script[^>]*\ssrc="[^"]*"[^>]*><\/script>/,
      () => `<script type="module">\n${escapeClosingTags(parts.js)}\n</script>`,
    )
    .replace(/<link[^>]*\srel="stylesheet"[^>]*>/, () => `<style>\n${escapeClosingTags(parts.css)}\n</style>`)
    // Only a real install target uses these, and a file:// page can be neither.
    .replace(/[ \t]*<link[^>]*\srel="(apple-touch-icon|manifest)"[^>]*>\r?\n?/g, '');

  if (parts.favicon) {
    const href = dataUri('image/svg+xml', parts.favicon);
    out = out.replace(/<link[^>]*\srel="icon"[^>]*>/, () => `<link rel="icon" type="image/svg+xml" href="${href}" />`);
  }

  for (const [what, marker] of [
    ['script', '<script type="module">'],
    ['stylesheet', '<style>'],
  ] as const) {
    if (!out.includes(marker)) throw new Error(`single-file build failed to inline the ${what}`);
  }
  if (/(?:src|href)="(?!data:)[^"]*\.(?:js|css|woff2?|png|svg|webmanifest)"/.test(out)) {
    throw new Error('single-file build left an external file reference in the HTML');
  }
  return out;
}
