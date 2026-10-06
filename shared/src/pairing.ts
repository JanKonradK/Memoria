/** A QR code carries connection details, never a saved device credential. */
export interface PairingCode {
  kind: 'memoria-pair';
  version: 1;
  addresses: string[];
  code: string;
}

export function normalizeLanHost(value: string): string {
  const match = /^(?:http:\/\/)?(\d{1,3}(?:\.\d{1,3}){3})(?::(\d{1,5}))?\/?$/.exec(value.trim());
  const address = match?.[1];
  if (!address) {
    throw new Error('Check the PC address. Copy it from Memoria on your computer.');
  }
  const parts = address.split('.');
  const octets = parts.map(Number);
  const [first = -1, second = -1] = octets;
  const port = Number(match?.[2] ?? 17820);
  const privateIp =
    parts.length === 4 &&
    octets.every((octet) => octet <= 255) &&
    (first === 10 || (first === 192 && second === 168) || (first === 172 && second >= 16 && second <= 31));
  if (!privateIp || port < 1 || port > 65535 || parts.some((part) => part.length > 1 && part.startsWith('0'))) {
    throw new Error('Use the PC address shown in Memoria on your computer.');
  }
  return `http://${octets.join('.')}:${port}`;
}

export function parsePairingCode(text: string): PairingCode {
  const invalid = () => new Error('This is not a Memoria connection code. Scan the code in Memoria on your PC.');
  if (text.length > 2048) throw invalid();
  let value: Partial<PairingCode>;
  try {
    value = JSON.parse(text);
  } catch {
    throw invalid();
  }
  if (
    !value ||
    value.kind !== 'memoria-pair' ||
    value.version !== 1 ||
    typeof value.code !== 'string' ||
    !/^\d{8}$/.test(value.code) ||
    !Array.isArray(value.addresses) ||
    value.addresses.length === 0 ||
    value.addresses.length > 8 ||
    value.addresses.some((host) => typeof host !== 'string')
  )
    throw invalid();
  let addresses: string[];
  try {
    addresses = [...new Set(value.addresses.map(normalizeLanHost))];
  } catch {
    throw invalid();
  }
  return { kind: 'memoria-pair', version: 1, addresses, code: value.code };
}

export function encodePairingCode(addresses: string[], code: string): string {
  const value = { kind: 'memoria-pair', version: 1, addresses: addresses.slice(0, 8), code };
  return JSON.stringify(parsePairingCode(JSON.stringify(value)));
}
