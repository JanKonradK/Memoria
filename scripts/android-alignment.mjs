import { readFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';

/**
 * Google Play requires native code built for 16 KB memory pages: every
 * loadable segment of every 64-bit `.so` must be aligned to at least 16 KB.
 * This reads an APK (a zip) and each native library's ELF program headers in
 * plain Node, with no Android SDK tools, so the check runs anywhere.
 */
export const PAGE_ALIGN = 16384;
/** The ABIs Play checks: 16 KB pages only exist on 64-bit devices. */
export const CHECKED_ABIS = ['arm64-v8a', 'x86_64'];

const EOCD = 0x06054b50;
const ZIP64_LOCATOR = 0x07064b50;
const ZIP64_EOCD = 0x06064b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;
const PT_LOAD = 1;

/** The zip's central directory: every entry's name, method, sizes and local header offset. */
export function zipEntries(zip) {
  const searchFrom = Math.max(0, zip.length - 22 - 0xffff);
  let eocd = -1;
  for (let index = zip.length - 22; index >= searchFrom; index--) {
    if (zip.readUInt32LE(index) === EOCD) {
      eocd = index;
      break;
    }
  }
  if (eocd < 0) throw new Error('Not a zip file: no end of central directory.');
  let count = zip.readUInt16LE(eocd + 10);
  let offset = zip.readUInt32LE(eocd + 16);
  if (offset === 0xffffffff || count === 0xffff) {
    const locator = eocd - 20;
    if (locator < 0 || zip.readUInt32LE(locator) !== ZIP64_LOCATOR) throw new Error('Damaged zip64 directory.');
    const record = Number(zip.readBigUInt64LE(locator + 8));
    if (zip.readUInt32LE(record) !== ZIP64_EOCD) throw new Error('Damaged zip64 directory.');
    count = Number(zip.readBigUInt64LE(record + 32));
    offset = Number(zip.readBigUInt64LE(record + 48));
  }
  const entries = [];
  for (let index = 0; index < count; index++) {
    if (zip.readUInt32LE(offset) !== CENTRAL) throw new Error('Damaged zip central directory.');
    const method = zip.readUInt16LE(offset + 10);
    let compressedSize = zip.readUInt32LE(offset + 20);
    let size = zip.readUInt32LE(offset + 24);
    const nameLength = zip.readUInt16LE(offset + 28);
    const extraLength = zip.readUInt16LE(offset + 30);
    const commentLength = zip.readUInt16LE(offset + 32);
    let localOffset = zip.readUInt32LE(offset + 42);
    const name = zip.toString('utf8', offset + 46, offset + 46 + nameLength);
    // Zip64 sizes and offsets live in the extra field, in this order, only when the 32-bit field is full.
    let extra = offset + 46 + nameLength;
    const extraEnd = extra + extraLength;
    while (extra + 4 <= extraEnd) {
      const id = zip.readUInt16LE(extra);
      const length = zip.readUInt16LE(extra + 2);
      if (id === 0x0001) {
        let field = extra + 4;
        if (size === 0xffffffff) {
          size = Number(zip.readBigUInt64LE(field));
          field += 8;
        }
        if (compressedSize === 0xffffffff) {
          compressedSize = Number(zip.readBigUInt64LE(field));
          field += 8;
        }
        if (localOffset === 0xffffffff) localOffset = Number(zip.readBigUInt64LE(field));
      }
      extra += 4 + length;
    }
    entries.push({ name, method, compressedSize, size, localOffset });
    offset = extraEnd + commentLength;
  }
  return entries;
}

/** Where an entry's data starts in the zip, past its local header. */
export function dataOffset(zip, entry) {
  if (zip.readUInt32LE(entry.localOffset) !== LOCAL) throw new Error(`Damaged local header for ${entry.name}.`);
  return entry.localOffset + 30 + zip.readUInt16LE(entry.localOffset + 26) + zip.readUInt16LE(entry.localOffset + 28);
}

/** An entry's bytes: stored as is, or deflated. */
export function entryBytes(zip, entry) {
  const start = dataOffset(zip, entry);
  const raw = zip.subarray(start, start + entry.compressedSize);
  if (entry.method === 0) return raw;
  if (entry.method === 8) return inflateRawSync(raw);
  throw new Error(`${entry.name} uses zip method ${entry.method}, which this check cannot read.`);
}

/**
 * The smallest `p_align` among an ELF file's PT_LOAD segments, or null when it
 * has none. Reads 32- and 64-bit, little- and big-endian ELF.
 */
export function minLoadAlignment(elf) {
  if (elf.length < 52 || elf.readUInt32BE(0) !== 0x7f454c46) throw new Error('Not an ELF file.');
  const wide = elf[4] === 2;
  const little = elf[5] !== 2;
  const u16 = (at) => (little ? elf.readUInt16LE(at) : elf.readUInt16BE(at));
  const u32 = (at) => (little ? elf.readUInt32LE(at) : elf.readUInt32BE(at));
  const u64 = (at) => Number(little ? elf.readBigUInt64LE(at) : elf.readBigUInt64BE(at));
  const phoff = wide ? u64(0x20) : u32(0x1c);
  const phentsize = u16(wide ? 0x36 : 0x2a);
  const phnum = u16(wide ? 0x38 : 0x2c);
  let smallest = null;
  for (let index = 0; index < phnum; index++) {
    const header = phoff + index * phentsize;
    if (header + phentsize > elf.length) throw new Error('Truncated ELF program headers.');
    if (u32(header) !== PT_LOAD) continue;
    const align = wide ? u64(header + 0x30) : u32(header + 0x1c);
    smallest = smallest === null ? align : Math.min(smallest, align);
  }
  return smallest;
}

/**
 * Every native library in the APK: its ABI, its smallest load alignment, and
 * whether it passes. Libraries for ABIs Play does not check are listed, never failed.
 */
export function nativeLibraryAlignment(apkPath) {
  const zip = readFileSync(apkPath);
  return zipEntries(zip)
    .filter((entry) => /^lib\/[^/]+\/[^/]+\.so$/.test(entry.name))
    .map((entry) => {
      const abi = entry.name.split('/')[1];
      const zipOffset = dataOffset(zip, entry);
      const zipAligned = entry.method !== 0 || zipOffset % PAGE_ALIGN === 0;
      const align = minLoadAlignment(entryBytes(zip, entry));
      const checked = CHECKED_ABIS.includes(abi);
      return {
        name: entry.name,
        abi,
        align,
        zipOffset,
        zipAligned,
        checked,
        ok: !checked || (align !== null && align >= PAGE_ALIGN && zipAligned),
      };
    });
}
