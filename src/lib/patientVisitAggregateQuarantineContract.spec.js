import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { describe, expect, it } from 'vitest';

const readSource = (relative) => readFileSync(path.join(process.cwd(), relative), 'utf8');

describe('Patient/Visit aggregate UI quarantine', () => {
  it('loads System Health visit counts once through the broker and never polls them', () => {
    // 2026-10-08 owner decision: visit volume and error rate are measured
    // again — through the purpose-limited broker, loaded once and refreshed on
    // demand, with an unsettled source shown as a dash rather than zero.
    const source = readSource('src/components/admin/SystemHealthMonitor.jsx');

    expect(source).toMatch(/useAuthorizedVisits\(\{\s*purpose: 'activity',/);
    expect(source).not.toMatch(/refetchInterval\s*:/);
    expect(source).not.toMatch(/visitAggregatesAvailable\s*=\s*false/);
    expect(source).toMatch(/const healthVisits = visitAggregatesAvailable \? visitQuery\.data : null;/);
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

  it('withholds Compliance metrics while sources reauthorize and loads Visit documentation once', () => {
    // 2026-10-08 owner decision: incomplete-documentation compliance is back,
    // from one broker read (no timer) that the Refresh button re-runs.
    const source = readSource('src/components/hub-tabs/ComplianceMonitoringDashboard.jsx');

    expect(source).toMatch(/useAuthorizedVisits\(\{\s*purpose: 'compliance_monitoring',/);
    expect(source).not.toMatch(/\blistAuthorizedVisits\b/);
    expect(source).not.toMatch(/refetchInterval\s*:|initialData\s*:/);
    expect(source).not.toMatch(/visitComplianceAvailable\s*=\s*false/);
    expect(source).toMatch(/const incompleteDoc = visitComplianceAvailable/);
    expect(source.match(/isFetchedAfterMount:/g)).toHaveLength(4);
    expect(source.match(/isFetching:/g)).toHaveLength(4);
    expect(source).toMatch(/results\.some\(\(result\)\s*=>\s*result && \(result\.isError\s*\|\|\s*result\.error\)\)/);
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
