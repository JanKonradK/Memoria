import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { afterAll, describe, expect, it } from 'vitest';
import {
  minLoadAlignment,
  nativeLibraryAlignment,
  zipEntries,
  // @ts-expect-error A plain build script without type declarations.
} from '../../scripts/android-alignment.mjs';

/** A 64-bit little-endian ELF with one program header per entry: [type, align]. */
function elf64(segments: [number, number][]): Buffer {
  const phoff = 64;
  const buffer = Buffer.alloc(phoff + segments.length * 56);
  buffer.writeUInt32BE(0x7f454c46, 0);
  buffer[4] = 2; // 64-bit
  buffer[5] = 1; // little-endian
  buffer.writeBigUInt64LE(BigInt(phoff), 0x20);
  buffer.writeUInt16LE(56, 0x36);
  buffer.writeUInt16LE(segments.length, 0x38);
  segments.forEach(([type, align], index) => {
    const header = phoff + index * 56;
    buffer.writeUInt32LE(type, header);
    buffer.writeBigUInt64LE(BigInt(align), header + 0x30);
  });
  return buffer;
}

/** A 32-bit little-endian ELF, as armeabi-v7a libraries are. */
function elf32(align: number): Buffer {
  const phoff = 52;
  const buffer = Buffer.alloc(phoff + 32);
  buffer.writeUInt32BE(0x7f454c46, 0);
  buffer[4] = 1;
  buffer[5] = 1;
  buffer.writeUInt32LE(phoff, 0x1c);
  buffer.writeUInt16LE(32, 0x2a);
  buffer.writeUInt16LE(1, 0x2c);
  buffer.writeUInt32LE(1, phoff);
  buffer.writeUInt32LE(align, phoff + 0x1c);
  return buffer;
}

/** A minimal zip: each entry stored (optionally aligned in the file) or deflated when asked. */
function zip(entries: { name: string; data: Buffer; deflate?: boolean; alignData?: number }[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const body = entry.deflate ? deflateRawSync(entry.data) : entry.data;
    const name = Buffer.from(entry.name);
    const pad = entry.alignData
      ? (entry.alignData - ((offset + 30 + name.length) % entry.alignData)) % entry.alignData
      : 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(entry.deflate ? 8 : 0, 8);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(pad, 28);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(entry.deflate ? 8 : 0, 10);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, Buffer.alloc(pad), body);
    centrals.push(central, name);
    offset += local.length + name.length + pad + body.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

const PT_LOAD = 1;
const PT_DYNAMIC = 2;
const folder = mkdtempSync(join(tmpdir(), 'memoria-align-'));
afterAll(() => rmSync(folder, { recursive: true, force: true }));

describe('16 KB page alignment check', () => {
  it('reads the smallest PT_LOAD alignment, ignoring other segments', () => {
    expect(
      minLoadAlignment(
        elf64([
          [PT_LOAD, 16384],
          [PT_DYNAMIC, 8],
          [PT_LOAD, 65536],
        ]),
      ),
    ).toBe(16384);
    expect(
      minLoadAlignment(
        elf64([
          [PT_LOAD, 16384],
          [PT_LOAD, 4096],
        ]),
      ),
    ).toBe(4096);
    expect(minLoadAlignment(elf64([[PT_DYNAMIC, 8]]))).toBeNull();
    expect(minLoadAlignment(elf32(4096))).toBe(4096);
    expect(() => minLoadAlignment(Buffer.from('not an elf file, at least fifty-two bytes long....'))).toThrow(
      'Not an ELF',
    );
  });

  it('lists every native library in an APK and fails only 64-bit ones under 16 KB (ELF or zip offset)', () => {
    const apk = join(folder, 'app.apk');
    writeFileSync(
      apk,
      zip([
        { name: 'AndroidManifest.xml', data: Buffer.from('manifest') },
        { name: 'lib/arm64-v8a/libgood.so', data: elf64([[PT_LOAD, 16384]]), alignData: 16384 },
        { name: 'lib/arm64-v8a/libunaligned-zip.so', data: elf64([[PT_LOAD, 16384]]) },
        { name: 'lib/x86_64/libbad.so', data: elf64([[PT_LOAD, 4096]]), deflate: true },
        { name: 'lib/armeabi-v7a/libold.so', data: elf32(4096) },
      ]),
    );
    expect(nativeLibraryAlignment(apk)).toMatchObject([
      { name: 'lib/arm64-v8a/libgood.so', abi: 'arm64-v8a', align: 16384, zipAligned: true, checked: true, ok: true },
      {
        name: 'lib/arm64-v8a/libunaligned-zip.so',
        abi: 'arm64-v8a',
        align: 16384,
        zipAligned: false,
        checked: true,
        ok: false,
      },
      { name: 'lib/x86_64/libbad.so', abi: 'x86_64', align: 4096, zipAligned: true, checked: true, ok: false },
      {
        name: 'lib/armeabi-v7a/libold.so',
        abi: 'armeabi-v7a',
        align: 4096,
        zipAligned: false,
        checked: false,
        ok: true,
      },
    ]);
  });

  it('refuses a file that is not a zip', () => {
    expect(() => zipEntries(Buffer.alloc(64))).toThrow('Not a zip');
  });
});
