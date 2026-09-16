import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { createHandler } from './app.mjs';
import { loadConfig } from './runtime.mjs';
import { runPreflight } from './preflight.mjs';

const config = loadConfig();
const handle = createHandler(config);
const port = Number(process.env.PORT || 8080);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('INVALID_PORT');
const server = createServer(async (incoming, outgoing) => {
  try {
    if (Number(incoming.headers['content-length'] || 0) > 12 * 1024 * 1024) {
      outgoing.writeHead(413, { 'Cache-Control': 'no-store', 'Content-Type': 'application/json' });
      outgoing.end('{"success":false,"error":"BODY_TOO_LARGE"}'); return;
    }
    const body = ['GET', 'HEAD'].includes(incoming.method || '') ? undefined : Readable.toWeb(incoming);
    const req = new Request(new URL(incoming.url || '/', 'http://runtime.invalid'), {
      method: incoming.method, headers: incoming.headers, body, ...(body ? { duplex: 'half' } : {}),
    });
    const response = await handle(req);
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    outgoing.end(Buffer.from(await response.arrayBuffer()));
  } catch {
    if (!outgoing.headersSent) outgoing.writeHead(503, { 'Cache-Control': 'no-store', 'Content-Type': 'application/json' });
    outgoing.end('{"success":false,"error":"RUNTIME_UNAVAILABLE"}');
  }
});
server.requestTimeout = 120000;
server.headersTimeout = 20000;
server.maxConnections = 100;
server.listen(port, '0.0.0.0', () => process.stdout.write(JSON.stringify({ event: 'external_runtime_started', revision: config.revision, released: config.released }) + '\n'));
process.on('SIGTERM', () => server.close(() => process.exit(0)));
process.on('SIGINT', () => server.close(() => process.exit(0)));
if (process.env.INTEGRATIONS_PREFLIGHT === 'read-only') {
  runPreflight(config).then(report => process.stdout.write(JSON.stringify(report) + '\n'))
    .catch(() => process.stdout.write('{"event":"external_integration_preflight","passed":false}\n'));
}
