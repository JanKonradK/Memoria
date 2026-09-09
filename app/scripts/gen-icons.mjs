// Generates the PWA icons (PNG). Run: npm run icons
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { drawPng } from './draw-icon.mjs';

const outDir = join(import.meta.dirname, '..', 'public');
mkdirSync(outDir, { recursive: true });

writeFileSync(join(outDir, 'icon-192.png'), drawPng(192, { maskable: false }));
writeFileSync(join(outDir, 'icon-512.png'), drawPng(512, { maskable: false }));
writeFileSync(join(outDir, 'icon-maskable.png'), drawPng(512, { maskable: true }));
console.log('PWA icons written to', outDir);
