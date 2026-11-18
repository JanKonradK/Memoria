// Memoria's internet relay: a Cloudflare Worker with one Durable Object per
// PC mailbox. See relay/README.md to deploy it and mailbox.mjs for how calls
// and replies meet. It stores nothing but each mailbox's owner-token hash.

import { Mailbox } from './mailbox.mjs';

const ROOM = /^[a-f0-9]{32}$/;
const ID = /^[A-Za-z0-9-]{1,64}$/;
/** Twice the app's 8 MB sync limit, sealed, with room to spare. */
const MAX_BODY = 20_000_000;

function json(status, body) {
  const headers = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };
  if (body == null) return new Response(null, { status, headers });
  return new Response(JSON.stringify(body), { status, headers: { ...headers, 'content-type': 'application/json' } });
}

/** The request's JSON body, or null when it is missing, too large or not JSON. */
async function readJson(request) {
  if (Number(request.headers.get('content-length') ?? 0) > MAX_BODY) return null;
  const text = await request.text();
  if (text.length > MAX_BODY) return null;
  try {
    const value = JSON.parse(text);
    return value && typeof value === 'object' ? value : null;
  } catch {
    return null;
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
      const message = await readJson(request);
      if (!message || typeof message.path !== 'string' || message.path.length > 32)
        return json(400, { error: 'Not a Memoria request.' });
      // Always 200: the PC's own status travels inside, beside the relay's errors.
      return json(200, await this.mailbox.call(message.path, message.body ?? null));
    }
    if (!(await this.owns(request))) return json(403, { error: 'This mailbox belongs to another PC.' });
    if (action === 'next' && request.method === 'GET') {
      const message = await this.mailbox.next();
      return message ? json(200, message) : json(204, null);
    }
    if (action === 'reply' && request.method === 'POST' && ID.test(id ?? '')) {
      const message = await readJson(request);
      if (!message || !Number.isInteger(message.status)) return json(400, { error: 'Not a Memoria reply.' });
      return this.mailbox.reply(id, message.status, message.body ?? null)
        ? json(204, null)
        : json(410, { error: 'That request already timed out.' });
    }
    return json(404, { error: 'Not found.' });
  }

  /** The first PC to collect claims the mailbox; after that only its token works. */
  async owns(request) {
    const token = /^Bearer ([a-f0-9]{64})$/.exec(request.headers.get('authorization') ?? '')?.[1];
    if (!token) return false;
    const hash = hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)));
    const owner = await this.state.storage.get('owner');
    if (owner === undefined) {
      await this.state.storage.put('owner', hash);
      return true;
    }
    return owner === hash;
  }
}
