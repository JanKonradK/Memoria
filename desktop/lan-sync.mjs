import { createServer } from 'node:http';
import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { networkInterfaces } from 'node:os';

export const LAN_PORT = 17820;
const MAX_BYTES = 1_000_000;
const CODE_TTL = 5 * 60_000;
const hash = (value) => createHash('sha256').update(value).digest('hex');
const fail = (status, message) => Object.assign(new Error(message), { status });

export function privateAddress(value) {
  const address = value?.replace(/^::ffff:/, '');
  return /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|127\.)/.test(address ?? '');
}

/** Both loopback and LAN writes enter this queue before reading disk. */
export function createStateAccess({ loadCore, read, write }) {
  let pending = Promise.resolve();
  const queue = (work) => {
    const next = pending.then(work);
    pending = next.catch(() => undefined);
    return next;
  };
  return {
    read: () => queue(async () => (await loadCore()).normalizeState(read())),
    merge: (incoming, authorized = () => true) =>
      queue(async () => {
        const { normalizeState, safeParseAppState, mergeState } = await loadCore();
        if (!authorized()) throw fail(401, 'This device is no longer connected. Pair it again.');
        const parsed = safeParseAppState(incoming);
        if (!parsed.success) throw fail(400, `Invalid app state: ${parsed.error}`);
        const current = normalizeState(read());
        let combined;
        try {
          // Preserve original clocks for normalization to discard impossible
          // future readings before they can replace the current PC reading.
          combined = mergeState(current, normalizeState(incoming));
        } catch (error) {
          if (error.name === 'StateCapacityError') throw fail(413, error.message);
          throw error;
        }
        const merged = safeParseAppState(combined);
        if (!merged.success) throw fail(500, 'The merged state failed validation. No data was changed.');
        const json = JSON.stringify(merged.data);
        if (Buffer.byteLength(json) > MAX_BYTES - 100)
          throw fail(413, 'Combined data exceeds the 1 MB sync limit. Export a backup and reduce old data.');
        if (json !== JSON.stringify(current)) write(merged.data);
        return merged.data;
      }),
  };
}

function json(res, status, body) {
  res.writeHead(status, {
    'content-type': 'application/json',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(JSON.stringify(body));
}

export async function readJson(req, limit = MAX_BYTES) {
  if (req.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json')
    throw fail(415, 'Content-Type must be application/json.');
  if (Number(req.headers['content-length']) > limit) throw fail(413, 'Request exceeds the sync size limit.');
  const chunks = [];
  let size = 0;
  // Do not use a for-await iterator here: its early exit destroys the socket,
  // preventing the caller from receiving the helpful 413 response.
  await new Promise((resolve, reject) => {
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        req.pause();
        reject(fail(413, 'Request exceeds the sync size limit.'));
      } else chunks.push(chunk);
    });
    req.on('end', resolve);
    req.on('error', reject);
    req.on('aborted', () => reject(fail(400, 'Request interrupted.')));
  });
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw fail(400, 'Request body is not valid JSON.');
  }
}

/** The LAN listener is separate from the authenticated loopback launcher. */
export function createLanSync({
  state,
  load = () => ({}),
  save = () => {},
  reset = () => {},
  now = Date.now,
  port = LAN_PORT,
}) {
  let config = { enabled: false, devices: [] };
  let loadError = null;
  try {
    const saved = load();
    if (
      !saved ||
      typeof saved !== 'object' ||
      Array.isArray(saved) ||
      ('enabled' in saved && typeof saved.enabled !== 'boolean') ||
      ('devices' in saved &&
        (!Array.isArray(saved.devices) ||
          saved.devices.some(
            (d) =>
              !d ||
              typeof d.id !== 'string' ||
              !/^[a-f0-9]{64}$/.test(d.hash) ||
              typeof d.name !== 'string' ||
              !Number.isFinite(d.pairedAt) ||
              d.pairedAt < 0,
          )))
    )
      throw new Error('Invalid phone connection settings.');
    config = { enabled: saved.enabled === true, devices: saved.devices ?? [] };
  } catch {
    // Pairing metadata must not prevent the PC app from opening local progress.
    // Never write over the unreadable file until the user requests recovery.
    loadError =
      'Saved phone connections could not be read. Your progress is safe. Reset phone connections to pair again.';
  }
  let server;
  let pairing;
  let failures = [];
  let controlPending = Promise.resolve();
  const commitConfig = (next) => {
    // Keep the visible state and authorization in agreement with disk. A failed
    // write must leave the previous controls available for an explicit retry.
    save(next);
    config = next;
  };
  const active = (device) => Boolean(server && config.devices.includes(device));
  const status = () => ({
    enabled: Boolean(server),
    error: loadError,
    port: server?.address().port ?? port,
    addresses: server
      ? Object.values(networkInterfaces())
          .flat()
          .filter((i) => i && i.family === 'IPv4' && !i.internal && privateAddress(i.address))
          .map((i) => `http://${i.address}:${server.address().port}`)
      : [],
    code: pairing && pairing.expiresAt > now() ? pairing.code : null,
    expiresAt: pairing && pairing.expiresAt > now() ? pairing.expiresAt : null,
    devices: config.devices.map(({ id, name, pairedAt }) => ({ id, name, pairedAt })),
  });
  const code = () => {
    if (!server) throw fail(409, 'Turn on Wi-Fi sync first.');
    pairing = { code: String(randomInt(0, 100_000_000)).padStart(8, '0'), expiresAt: now() + CODE_TTL };
    return status();
  };
  async function handle(req, res) {
    try {
      // A native HTTP client sends no Origin. Browser pages are never admitted,
      // even when a user has accidentally shared a pairing code with a page.
      if (req.headers.origin || req.headers['sec-fetch-site'] || !privateAddress(req.socket.remoteAddress))
        throw fail(403, 'Use the Memoria Android app on the same private Wi-Fi network.');
      if (req.method !== 'POST' || !['/pair', '/sync', '/disconnect'].includes(req.url))
        throw fail(404, 'Route not found.');
      if (req.url === '/pair') {
        failures = failures.filter((at) => at > now() - 60_000);
        if (failures.length >= 5) throw fail(429, 'Too many pairing attempts. Wait one minute and try again.');
        failures.push(now());
        const body = await readJson(req, 1024);
        const candidate = typeof body?.code === 'string' ? body.code.replace(/\s/g, '') : '';
        if (
          !pairing ||
          pairing.expiresAt <= now() ||
          !/^[0-9]{8}$/.test(candidate) ||
          !timingSafeEqual(Buffer.from(candidate), Buffer.from(pairing.code))
        )
          throw fail(401, 'The pairing code is wrong or has expired. Get a new code from PC Settings.');
        if (config.devices.length >= 10)
          throw fail(409, 'Remove an old device from PC Settings before pairing another.');
        const token = randomBytes(32).toString('base64url');
        const device = {
          id: randomBytes(12).toString('hex'),
          hash: hash(token),
          name: typeof body.name === 'string' ? body.name.trim().slice(0, 60) || 'Android phone' : 'Android phone',
          pairedAt: now(),
        };
        commitConfig({ ...config, devices: [...config.devices, device] });
        pairing = undefined;
        json(res, 200, { token, deviceId: device.id });
        return;
      }
      const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(req.headers.authorization ?? '');
      const device = match && config.devices.find((d) => d.hash === hash(match[1]));
      if (!device || !active(device)) throw fail(401, 'This phone is no longer paired. Pair it again in Settings.');
      if (req.url === '/disconnect') {
        commitConfig({ ...config, devices: config.devices.filter((d) => d !== device) });
        json(res, 200, { ok: true });
        return;
      }
      const body = await readJson(req);
      const merged = await state.merge(body?.state, () => active(device));
      if (!active(device)) throw fail(401, 'This device was disconnected.');
      json(res, 200, { state: merged });
    } catch (error) {
      if (!res.headersSent) {
        if (error.status === 413) res.setHeader('connection', 'close');
        json(res, error.status ?? 500, {
          error: error.status ? error.message : 'PC sync could not save data. Check the PC and try again.',
        });
      }
    }
  }
  async function start() {
    if (server) return status();
    const listener = createServer(handle);
    listener.requestTimeout = 15_000;
    listener.headersTimeout = 10_000;
    listener.maxConnections = 20;
    await new Promise((resolve, reject) => {
      listener.once('error', reject);
      listener.listen(port, '0.0.0.0', resolve);
    });
    try {
      commitConfig({ ...config, enabled: true });
    } catch (error) {
      listener.close();
      throw error;
    }
    server = listener;
    return code();
  }
  async function stop() {
    commitConfig({ ...config, enabled: false });
    pairing = undefined;
    const listener = server;
    server = undefined;
    listener?.closeAllConnections();
    if (listener) await new Promise((resolve) => listener.close(resolve));
    return status();
  }
  return {
    status,
    restore: () => (config.enabled ? start() : Promise.resolve(status())),
    // Settings commands are serialized, so double clicks cannot create a stray listener.
    control(body) {
      const next = controlPending.then(async () => {
        if (loadError && body?.action !== 'reset') throw fail(409, loadError);
        switch (body?.action) {
          case 'reset':
            if (!loadError) throw fail(409, 'Phone connections do not need to be reset.');
            await reset();
            commitConfig({ enabled: false, devices: [] });
            loadError = null;
            return status();
          case 'start':
            return start();
          case 'stop':
            return stop();
          case 'code':
            return code();
          case 'revoke':
            commitConfig({ ...config, devices: config.devices.filter((d) => d.id !== body.id) });
            return status();
          default:
            throw fail(400, 'Unknown device action.');
        }
      });
      controlPending = next.catch(() => undefined);
      return next;
    },
  };
}
