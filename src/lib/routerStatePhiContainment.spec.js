import { readdirSync, readFileSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import process from 'node:process';
import { describe, expect, it } from 'vitest';

const readSource = (relativePath) => readFileSync(`${process.cwd()}/${relativePath}`, 'utf8');

function productionSourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return productionSourceFiles(path);
    if (!['.js', '.jsx', '.ts', '.tsx'].includes(extname(entry.name))) return [];
    if (/\.(?:spec|test)\.[jt]sx?$/.test(entry.name)) return [];
    return [path];
  });
}

const OASIS_HISTORY_CALLERS = [
  'src/components/hub-tabs/OASISAnalyzer.jsx',
  'src/components/hub-tabs/OASISClinicalReview.jsx',
  'src/components/hub-tabs/OASISComplianceReview.jsx',
  'src/components/hub-tabs/OASISDocumentationReview.jsx',
];

describe('Router-state PHI containment', () => {
  it('has no production React Router state writer or location.state consumer', () => {
    const violations = [];
    for (const file of productionSourceFiles(`${process.cwd()}/src`)) {
      const source = readFileSync(file, 'utf8');
      const usesDeclarativeRouterState = /<(?:Link|NavLink|Navigate)\b[^>]*\bstate\s*=/s.test(source);
      const readsRouterState = /\blocation\.state\b/.test(source);
      const usesImperativeRouterState = /\bnavigate\s*\([^;]{0,800},\s*\{[^}]{0,300}\bstate\s*:/s.test(source);
      if (usesDeclarativeRouterState || readsRouterState || usesImperativeRouterState) {
        violations.push(relative(process.cwd(), file));
      }
    }

    expect(violations).toEqual([]);
  });

  it('keeps OASIS analysis payloads in the authority-bound component tree, not session history', () => {
    const center = readSource('src/pages/OASISCenter.jsx');
    const callers = OASIS_HISTORY_CALLERS.map(readSource).join('\n');

    expect(center).toContain('const [analysisHandoff, setAnalysisHandoff] = useState(null)');
    expect(center).toContain('onAnalysisHandoff={setAnalysisHandoff}');
    expect(callers).not.toMatch(/\blocation\.state\b/);
    expect(callers).not.toMatch(/\bstate\s*=\s*\{\s*\{/);
    expect(callers).not.toContain('history.pushState');
    expect(callers).not.toContain('history.replaceState');
  });

  it('does not copy arbitrary router state through legacy redirects', () => {
    const app = readSource('src/App.jsx');
    const redirectStart = app.indexOf('const RedirectTo =');
    const redirectEnd = app.indexOf('const RoutePageLoader', redirectStart);
    const redirectSource = app.slice(redirectStart, redirectEnd);

    expect(redirectStart).toBeGreaterThan(-1);
    expect(redirectEnd).toBeGreaterThan(redirectStart);
    expect(redirectSource).not.toMatch(/\bstate\s*=/);
    expect(redirectSource).not.toMatch(/\blocation\.state\b/);
  });

  it('does not let NavigationTracker effects retain the Router location object', () => {
    const tracker = readSource('src/lib/NavigationTracker.jsx');

    expect(tracker).toContain('const pathname = useLocation().pathname');
    expect(tracker).not.toMatch(/const\s+location\s*=\s*useLocation/);
    expect(tracker).not.toMatch(/\[location(?:,|\])/);
  });
});
