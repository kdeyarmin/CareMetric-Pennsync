import { transform } from 'esbuild';
import { inspectJavaScript } from '../tools-check-production-diagnostics.mjs';

// Invoke the supported transform explicitly: Vite 8's deprecated esbuild
// configuration can be ignored, while Oxc's console removal alone leaves
// vendor console.*.apply calls and conditional debugger statements behind.
export async function stripProductionDiagnostics(code) {
  const result = await transform(code, {
    loader: 'js',
    target: 'esnext',
    drop: ['console', 'debugger'],
    minify: false,
    sourcemap: false,
    legalComments: 'inline',
  });
  if (inspectJavaScript(result.code).length) {
    // Fail closed on unsupported diagnostic forms. Do not print source text
    // or arguments, and never replace a diagnostic with a runtime no-op that
    // would still evaluate sensitive arguments in the user's browser.
    throw new Error('PRODUCTION_DIAGNOSTIC_REMOVAL_INCOMPLETE');
  }
  return { code: result.code, map: null };
}

export function productionDiagnosticsPlugin() {
  return {
    name: 'caremetric-production-diagnostics',
    apply: 'build',
    enforce: 'post',
    renderChunk: {
      order: 'post',
      handler: stripProductionDiagnostics,
    },
  };
}
