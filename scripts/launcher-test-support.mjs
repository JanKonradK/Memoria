import { once } from 'node:events';
import { readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';

/** Use a free port in a copied test install, leaving real browser storage origins alone. */
export async function isolateLauncherPort(launcher, candidates = [0]) {
  let port;
  for (const candidate of candidates) {
    const probe = createServer();
    probe.listen(candidate, '127.0.0.1');
    try {
      await once(probe, 'listening');
    } catch (error) {
      if (error.code === 'EADDRINUSE') continue;
      throw error;
    }
    port = probe.address().port;
    await new Promise((resolve, reject) => probe.close((error) => (error ? reject(error) : resolve())));
    break;
  }
  if (!port) throw new Error('No test launcher port is available');
  const source = readFileSync(launcher, 'utf8');
  const declaration = 'const PORTS = [17817, 17818, 17819];';
  if (!source.includes(declaration)) throw new Error('Test launcher port declaration changed');
  writeFileSync(launcher, source.replace(declaration, `const PORTS = [${port}];`));
}
