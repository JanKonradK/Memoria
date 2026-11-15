// Writes the reminder sounds Android plays: one gentle chime and four alarm rings.
// Synthesised here so the repository holds no third-party audio. Run after changing
// a tone: node app/scripts/gen-tones.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RATE = 12_000;
const out = join(dirname(fileURLToPath(import.meta.url)), '../../android/app/src/main/res/raw');
mkdirSync(out, { recursive: true });

/** A tone with a soft attack and an exponential tail, added into `buffer`. */
function note(buffer, start, length, freqs, gain, decay = 6) {
  const from = Math.round(start * RATE);
  const count = Math.round(length * RATE);
  for (let i = 0; i < count && from + i < buffer.length; i++) {
    const t = i / RATE;
    const attack = Math.min(1, t / 0.008);
    const release = Math.min(1, (count - i) / (0.01 * RATE));
    const envelope = attack * release * Math.exp(-decay * t);
    let sample = 0;
    for (const [freq, weight] of freqs) sample += weight * Math.sin(2 * Math.PI * freq * t);
    buffer[from + i] += gain * envelope * sample;
  }
}

function wav(name, seconds, draw) {
  const buffer = new Float32Array(Math.round(seconds * RATE));
  draw(buffer);
  const data = Buffer.alloc(buffer.length * 2);
  for (let i = 0; i < buffer.length; i++)
    data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, buffer[i])) * 32_000), i * 2);
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(RATE, 24);
  header.writeUInt32LE(RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  writeFileSync(join(out, `${name}.wav`), Buffer.concat([header, data]));
}

const bell = (freq) => [
  [freq, 1],
  [freq * 2.01, 0.35],
  [freq * 3.02, 0.12],
];

// Gentle: two soft bell notes.
wav('memoria_gentle', 1.4, (b) => {
  note(b, 0, 1.0, bell(784), 0.32, 4);
  note(b, 0.18, 1.2, bell(1047), 0.28, 3.5);
});

const RING_SECONDS = 12;

// Classic: the bedside alarm, four quick beeps and a pause.
wav('memoria_alarm_classic', RING_SECONDS, (b) => {
  for (let at = 0; at < RING_SECONDS; at += 1)
    for (let k = 0; k < 4; k++) note(b, at + k * 0.12, 0.08, [[2000, 1]], 0.45, 0);
});

// Pulse: a steady, low pulse that grows more insistent.
wav('memoria_alarm_pulse', RING_SECONDS, (b) => {
  for (let at = 0, i = 0; at < RING_SECONDS; at += 0.5, i++)
    note(
      b,
      at,
      0.25,
      [
        [880, 1],
        [1320, 0.3],
      ],
      Math.min(0.55, 0.25 + i * 0.012),
      2,
    );
});

// Chime: a rising three-note bell phrase.
wav('memoria_alarm_chime', RING_SECONDS, (b) => {
  for (let at = 0; at < RING_SECONDS; at += 2.5) {
    note(b, at, 1.2, bell(659), 0.4, 3);
    note(b, at + 0.3, 1.2, bell(784), 0.4, 3);
    note(b, at + 0.6, 1.6, bell(1047), 0.42, 2.5);
  }
});

// Ring: a telephone, two bursts of a warbling dual tone.
wav('memoria_alarm_ring', RING_SECONDS, (b) => {
  for (let at = 0; at < RING_SECONDS; at += 3)
    for (let k = 0; k < 2; k++)
      for (let w = 0; w < 10; w++)
        note(
          b,
          at + k * 0.6 + w * 0.04,
          0.04,
          [
            [440, 0.5],
            [480, 0.5],
            [w % 2 ? 1200 : 1000, 0.4],
          ],
          0.5,
          0,
        );
});

console.log(`Tones written to ${out}`);
