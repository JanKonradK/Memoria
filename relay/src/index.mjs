// Memoria's internet relay: a Cloudflare Worker with one Durable Object per
// PC mailbox. See relay/README.md to deploy it and mailbox.mjs for how calls
// and replies meet. It stores nothing but each mailbox's owner hash.

import { Mailbox } from './mailbox.mjs';

const ROOM = /^[a-f0-9]{32}$/;
const ID = /^[A-Za-z0-9-]{1,64}$/;
const SECRET = /^[a-f0-9]{64}$/;
/**
 * The largest request or reply body, 8 MiB. Sealed packets are hex, so this
 * carries about 4 MB of app data; larger syncs go over Wi-Fi. With at most
 * MAX_WAITING calls held, one mailbox stays well inside a Durable Object's memory.
 */
const MAX_BODY = 8_388_608;
/** The header carrying the PC's second owner secret, beside its bearer token. */
const OWNER_HEADER = 'x-memoria-owner';
const TOO_LARGE = {
  status: 413,
  body: { error: 'This sync is too large for the relay. Sync on the same Wi-Fi as your PC.' },
};

function json(status, body) {
  const headers = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };
  if (body == null) return new Response(null, { status, headers });
  return new Response(JSON.stringify(body), { status, headers: { ...headers, 'content-type': 'application/json' } });
}

/** Whether the request says up front that its body is over MAX_BODY. */
function declaredTooLarge(request) {
  const length = Number(request.headers.get('content-length') ?? 0);
  return !Number.isFinite(length) || length > MAX_BODY;
}

/**
 * The request's JSON body: `{ value }`, with value null when it is missing or
 * not a JSON object, or `{ tooLarge: true }`. The body is read as a stream and
 * abandoned past MAX_BODY, so a missing or false content-length cannot make the
 * relay buffer more.
 */
async function readJson(request) {
  if (declaredTooLarge(request)) return { tooLarge: true };
  const chunks = [];
  let size = 0;
  if (request.body) {
    const reader = request.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY) {
        await reader.cancel().catch(() => {});
        return { tooLarge: true };
      }
      chunks.push(value);
    }
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    const value = JSON.parse(new TextDecoder().decode(bytes));
    return { value: value && typeof value === 'object' ? value : null };
  } catch {
    return { value: null };
  }
}

const hex = (buffer) => [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, '0')).join('');

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/') return new Response('Memoria relay\n', { headers: { 'content-type': 'text/plain' } });
    const match = /^\/v1\/rooms\/([^/]+)\/(?:call|next|reply\/[^/]+)$/.exec(url.pathname);
    if (!match || !ROOM.test(match[1])) return json(404, { error: 'Not found.' });
    return env.ROOMS.get(env.ROOMS.idFromName(match[1])).fetch(request);
  },
};

/** One PC's mailbox. Calls wait in memory; only the owner-token hash is stored. */
export class Room {
  constructor(state) {
    this.state = state;
    this.mailbox = new Mailbox();
  }

  async fetch(request) {
    const [, , , , action, id] = new URL(request.url).pathname.split('/');
    if (action === 'call' && request.method === 'POST') {
      // Always 200: the PC's own status travels inside, beside the relay's errors.
      // An offline PC or a full mailbox is answered before the body is read.
      const refused = this.mailbox.refusal() ?? (declaredTooLarge(request) ? TOO_LARGE : null);
      if (refused) return json(200, refused);
      const read = await readJson(request);
      if (read.tooLarge) return json(200, TOO_LARGE);
      const message = read.value;
      if (!message || typeof message.path !== 'string' || message.path.length > 32)
        return json(400, { error: 'Not a Memoria request.' });
      return json(200, await this.mailbox.call(message.path, message.body ?? null));
    }
    if (!(await this.owns(request))) return json(403, { error: 'This mailbox belongs to another PC.' });
    if (action === 'next' && request.method === 'GET') {
      const message = await this.mailbox.next();
      return message ? json(200, message) : json(204, null);
    }
    if (action === 'reply' && request.method === 'POST' && ID.test(id ?? '')) {
      const read = await readJson(request);
      if (read.tooLarge) {
        // The phone still hears why, instead of waiting for a timeout.
        this.mailbox.reply(id, TOO_LARGE.status, TOO_LARGE.body);
        return json(413, TOO_LARGE.body);
      }
      const message = read.value;
      if (!message || !Number.isInteger(message.status)) return json(400, { error: 'Not a Memoria reply.' });
      return this.mailbox.reply(id, message.status, message.body ?? null)
        ? json(204, null)
        : json(410, { error: 'That request already timed out.' });
    }
    return json(404, { error: 'Not found.' });
  }

  /**
   * The first PC to collect claims the mailbox; after that only its secrets
   * work. Every collect and reply needs BOTH a 64-hex bearer token and a
   * 64-hex X-Memoria-Owner secret, and only a hash of the pair is stored, so
   * a caller without both can neither claim an unclaimed room nor use one.
   */
  async owns(request) {
    const token = /^Bearer ([a-f0-9]{64})$/.exec(request.headers.get('authorization') ?? '')?.[1];
    const secret = request.headers.get(OWNER_HEADER) ?? '';
    if (!token || !SECRET.test(secret)) return false;
    const digest = async (text) => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
    const hash = await digest(`${token}:${secret}`);
    const owner = await this.state.storage.get('owner');
    if (owner === hash) return true;
    // Unclaimed, or claimed by this same PC before owner secrets existed (the
    // hash of its token alone): bind the room to the pair from now on.
    if (owner === undefined || owner === (await digest(token))) {
      await this.state.storage.put('owner', hash);
      return true;
    }
    return false;
  }
}
