// Generates a multi-resolution Windows .ico (PNG-compressed entries) for the
// desktop launcher shortcut. Run: npm run ico
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { drawPng } from './draw-icon.mjs';

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'desktop');
mkdirSync(outDir, { recursive: true });

const SIZES = [16, 32, 48, 64, 128, 256];
const images = SIZES.map((size) => ({ size, png: drawPng(size, { maskable: false }) }));

function packIco(imgs) {
  const count = imgs.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(count, 4);
  const entries = Buffer.alloc(16 * count);
  let offset = 6 + 16 * count;
  imgs.forEach((img, i) => {
    const e = i * 16;
    entries[e] = img.size >= 256 ? 0 : img.size; // width (0 = 256)
    entries[e + 1] = img.size >= 256 ? 0 : img.size; // height
    entries[e + 2] = 0; // palette
    entries[e + 3] = 0; // reserved
    entries.writeUInt16LE(1, e + 4); // color planes
    entries.writeUInt16LE(32, e + 6); // bits per pixel
    entries.writeUInt32LE(img.png.length, e + 8); // bytes of data
    entries.writeUInt32LE(offset, e + 12); // offset
    offset += img.png.length;
  });
  return Buffer.concat([header, entries, ...imgs.map((i) => i.png)]);
}

const out = join(outDir, 'void.ico');
writeFileSync(out, packIco(images));
console.log('Icon written to', out);
