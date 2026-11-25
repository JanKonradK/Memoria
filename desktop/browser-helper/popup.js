/* global document */
// Memoria Browser Connect: reads only the sign-in cookies Memoria needs and
// posts them to the Memoria app on this PC (127.0.0.1). No other network calls.
'use strict';

const api = globalThis.browser ?? globalThis.chrome;
const PORTS = [17817, 17818, 17819];

const SERVICES = {
  hoyolab: {
    names: ['ltuid_v2', 'ltoken_v2', 'ltmid_v2', 'cookie_token_v2', 'account_id_v2', 'account_mid_v2'],
    domains: ['hoyolab.com', 'hoyoverse.com'],
    ready: (found) => Boolean(found.ltuid_v2 && found.ltoken_v2 && found.ltmid_v2),
  },
  skport: {
    names: ['ACCOUNT_TOKEN', 'SK_OAUTH_CRED_KEY'],
    domains: ['skport.com', 'gryphline.com'],
    ready: (found) => Boolean(found.ACCOUNT_TOKEN || found.SK_OAUTH_CRED_KEY),
  },
};

const $ = (id) => document.getElementById(id);
const codeInput = $('code');
const sendButton = $('send');
const message = $('message');
const signedIn = {};

function say(text, kind = '') {
  message.textContent = text;
  message.className = kind;
}

function ownDomain(cookieDomain, domains) {
  const domain = String(cookieDomain || '')
    .toLowerCase()
    .replace(/^\./, '');
  return domains.some((allowed) => domain === allowed || domain.endsWith(`.${allowed}`));
}

async function readCookies(key) {
  const service = SERVICES[key];
  const found = {};
  for (const domain of service.domains) {
    let cookies;
    try {
      cookies = await api.cookies.getAll({ domain });
    } catch {
      cookies = [];
    }
    for (const cookie of cookies ?? []) {
      if (
        service.names.includes(cookie.name) &&
        cookie.value &&
        !found[cookie.name] &&
        ownDomain(cookie.domain, service.domains)
      ) {
        found[cookie.name] = cookie.value;
      }
    }
  }
  return found;
}

function selected() {
  return document.querySelector('input[name="provider"]:checked')?.value ?? null;
}

function cleanCode() {
  return codeInput.value
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 6);
}

function refreshButton() {
  const provider = selected();
  sendButton.disabled = !provider || !signedIn[provider] || cleanCode().length !== 6;
}

async function post(port, body) {
  return fetch(`http://127.0.0.1:${port}/api/browser-connect`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    credentials: 'omit',
    cache: 'no-store',
    referrerPolicy: 'no-referrer',
  });
}

async function send() {
  const provider = selected();
  if (!provider) return;
  sendButton.disabled = true;
  say('Sending to Memoria…');
  const cookies = await readCookies(provider);
  if (!SERVICES[provider].ready(cookies)) {
    say('You are not signed in to that service in this browser. Sign in first, then try again.', 'bad');
    refreshButton();
    return;
  }
  const body = { provider, code: cleanCode(), cookies };
  for (const port of PORTS) {
    let response;
    try {
      response = await post(port, body);
    } catch {
      continue; // Nothing on this port: try the next one.
    }
    // Some other program on the port, not Memoria.
    if (response.headers.get('x-memoria') !== '1') continue;
    const answer = await response.json().catch(() => ({}));
    if (response.ok && answer.ok) {
      const name = provider === 'hoyolab' ? 'HoYoLAB' : 'SKPORT';
      const roles = Number(answer.rolesCount) || 0;
      say(
        `Connected ${name}${answer.maskedUid ? ` (${answer.maskedUid})` : ''}. ${roles} game account${roles === 1 ? '' : 's'} found. You can close this.`,
        'ok',
      );
      codeInput.value = '';
      refreshButton();
      return;
    }
    if (response.status === 401 || response.status === 403) {
      say(answer.error || 'Memoria refused the code. Start again in Memoria.', 'bad');
      refreshButton();
      return;
    }
    say(answer.error || `Memoria could not connect (error ${response.status}).`, 'bad');
    refreshButton();
    return;
  }
  say('Memoria is not open on this PC. Open it, start Connect with browser, then try again.', 'bad');
  refreshButton();
}

async function init() {
  for (const key of Object.keys(SERVICES)) {
    const found = await readCookies(key);
    signedIn[key] = SERVICES[key].ready(found);
    const label = $(`state-${key}`);
    label.textContent = signedIn[key] ? 'Signed in' : 'Not signed in';
    label.className = signedIn[key] ? 'state on' : 'state';
  }
  const first = Object.keys(SERVICES).find((key) => signedIn[key]);
  if (first) document.querySelector(`input[value="${first}"]`).checked = true;
  if (!first) say('Sign in to HoYoLAB or SKPORT in this browser first.');
  refreshButton();
  codeInput.focus();
}

codeInput.addEventListener('input', () => {
  codeInput.value = cleanCode();
  refreshButton();
});
codeInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !sendButton.disabled) send();
});
for (const radio of document.querySelectorAll('input[name="provider"]'))
  radio.addEventListener('change', refreshButton);
sendButton.addEventListener('click', send);
init();
