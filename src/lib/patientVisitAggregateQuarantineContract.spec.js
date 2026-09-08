import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { describe, expect, it } from 'vitest';

const readSource = (relative) => readFileSync(path.join(process.cwd(), relative), 'utf8');

describe('Patient/Visit aggregate UI quarantine', () => {
  it('keeps System Health off the full-list collector and exposes only a bounded tenant probe', () => {
    const source = readSource('src/components/admin/SystemHealthMonitor.jsx');

    expect(source).not.toMatch(/\buseAuthorizedVisits\b/);
    expect(source).not.toMatch(/refetchInterval\s*:/);
    expect(source).toMatch(/visitAggregatesAvailable\s*=\s*false/);
    expect(source).toMatch(
      /listAuthorizedVisits\s*\([\s\S]*?purpose:\s*'activity'[\s\S]*?sort:\s*'id_asc'[\s\S]*?pageSize:\s*1/,
    );
    expect(source).toMatch(/scopedApiLatency\s*\?\?\s*undefined/);
    expect(source).toMatch(/probes\.total[\s\S]*?:\s*undefined/);
    expect(source).toMatch(/Select a verified tenant before DB latency/);
    expect(source).toMatch(/Cached counts are withheld/);
    expect(source).toMatch(/upProbesRef\.current\s*=\s*\{\s*ok:\s*0,\s*total:\s*0\s*\}/);
    expect(source).toMatch(/measured\.scope\s*===\s*tenantProbeScope/);
    expect(source).toMatch(/They are not reported as zero/);
  });

  it('withholds Compliance metrics while sources reauthorize and pauses Visit aggregation', () => {
    const source = readSource('src/components/hub-tabs/ComplianceMonitoringDashboard.jsx');

    expect(source).not.toMatch(/\buseAuthorizedVisits\b|\blistAuthorizedVisits\b/);
    expect(source).not.toMatch(/refetchInterval\s*:|initialData\s*:/);
    expect(source).toMatch(/visitComplianceAvailable\s*=\s*false/);
    expect(source.match(/isFetchedAfterMount:/g)).toHaveLength(4);
    expect(source.match(/isFetching:/g)).toHaveLength(4);
    expect(source).toMatch(/results\.some\(\(result\)\s*=>\s*result\.isError\s*\|\|\s*result\.error\)/);
    expect(source).toMatch(/cached metrics are withheld/);
    expect(source).toMatch(/No empty result is being reported as compliant/);
    expect(source).not.toMatch(/All Clear!/);
  });

  it('forbids recurring polling on the paginated authorized Visit collector', () => {
    const source = readSource('src/hooks/useAuthorizedVisits.js');

    expect(source).not.toMatch(/refetchInterval\s*:/);
    expect(source).toMatch(/Object\.keys\(options\)\.filter\(\(key\)\s*=>\s*key\s*!==\s*'select'\)/);
  });
});
