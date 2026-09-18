import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

export const BROWSER_ORIGIN = 'http://127.0.0.1:4179';
export async function startBrowserServer(configuration) {
  const bundled = await build({ entryPoints: [fileURLToPath(new URL('./entry.mjs', import.meta.url))],
    bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022', logLevel: 'silent',
    alias: { '@/api/base44Client': fileURLToPath(new URL('./adapter.mjs', import.meta.url)) },
    metafile: true });
  // Fail the test build if a production SDK/client somehow enters the graph.
  if (Object.keys(bundled.metafile.inputs).some(path => /node_modules|src\/api\/base44Client/.test(path.replaceAll('\\', '/')))) {
    throw new Error('BROWSER_UNEXPECTED_BUNDLE_DEPENDENCY');
  }
  const html = await readFile(new URL('./index.html', import.meta.url));
  const routes = new Map([
    ['/', ['text/html; charset=utf-8', html]],
    ['/entry.js', ['text/javascript; charset=utf-8', bundled.outputFiles[0].contents]],
    ['/configuration', ['application/json', JSON.stringify(configuration)]],
  ]);
  const server = createServer((request, response) => {
    const route = routes.get(request.url);
    if (request.method !== 'GET' || request.headers.host !== '127.0.0.1:4179' || !route) {
      response.writeHead(404).end(); return;
    }
    response.writeHead(200, { 'content-type': route[0], 'cache-control': 'no-store',
      'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' });
    response.end(route[1]);
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(4179, '127.0.0.1', resolve); });
  return async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); };
}
