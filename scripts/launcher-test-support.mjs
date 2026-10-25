import { once } from 'node:events';
import { readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';

/** A loopback port nothing is listening on, from the candidates in order. */
export async function freePort(candidates = [0]) {
  for (const candidate of candidates) {
    const probe = createServer();
    probe.listen(candidate, '127.0.0.1');
    try {
      await once(probe, 'listening');
    } catch (error) {
      if (error.code === 'EADDRINUSE') continue;
      throw error;
    }
    const { port } = probe.address();
    await new Promise((resolve, reject) => probe.close((error) => (error ? reject(error) : resolve())));
    return port;
  }
  throw new Error('No test launcher port is available');
}

/** Use a free port in a copied test install, leaving real browser storage origins alone. */
export async function isolateLauncherPort(launcher, candidates = [0]) {
  const port = await freePort(candidates);
  const source = readFileSync(launcher, 'utf8');
  const declaration = 'const PORTS = [17817, 17818, 17819];';
  if (!source.includes(declaration)) throw new Error('Test launcher port declaration changed');
  writeFileSync(launcher, source.replace(declaration, `const PORTS = [${port}];`));
}
