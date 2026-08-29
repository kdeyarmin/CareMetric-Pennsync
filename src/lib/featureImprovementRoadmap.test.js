import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FEATURE_IMPROVEMENT_ROADMAP,
  IMPLEMENTED_FEATURE_IMPROVEMENT_ROADMAP,
  ROADMAP_IMPLEMENTATION_DETAILS,
  summarizeImprovementRoadmap,
  getRoadmapForFeature,
  getFeatureEnhancementSuggestions
} from './featureImprovementRoadmap.js';

test('feature improvement roadmap covers robust enhancement inventory', () => {
  const summary = summarizeImprovementRoadmap();
  assert.equal(summary.totalInitiatives, FEATURE_IMPROVEMENT_ROADMAP.length);
  // 24 since the offline-readiness initiative retired with the offline feature.
  assert.equal(summary.totalInitiatives, 24);
  assert.equal(summary.totalEnhancements, 24);
  assert.equal(summary.byTier.critical, 5);
  assert.ok(summary.uniqueFeatureTargets.size >= 25);
  assert.equal(summary.totalAcceptanceCriteria, 24 * 3);
  assert.equal(summary.totalLaunchSignals, 24 * 2);
  assert.ok(Object.keys(summary.byPhase).length >= 10);
  assert.ok(summary.uniquePrimaryUsers.size >= 10);
});

test('roadmap entries include actionable fields', () => {
  for (const item of FEATURE_IMPROVEMENT_ROADMAP) {
    assert.match(item.id, /^[a-z0-9-]+$/);
    assert.ok(item.pillar.length > 5);
    assert.ok(item.source.length > 5);
    assert.ok(item.why.length > 20);
    assert.ok(item.expectedOutcome.length > 20);
    assert.ok(item.enhancements.every((enhancement) => enhancement.length > 20));
    assert.ok(item.featureTargets.length >= 4);
  }
});



test('every roadmap suggestion has implementation metadata', () => {
  assert.equal(IMPLEMENTED_FEATURE_IMPROVEMENT_ROADMAP.length, 24);
  assert.equal(Object.keys(ROADMAP_IMPLEMENTATION_DETAILS).length, 24);

  for (const item of IMPLEMENTED_FEATURE_IMPROVEMENT_ROADMAP) {
    assert.ok(item.phase.startsWith('Phase '));
    assert.ok(item.primaryUsers.length >= 1);
    assert.equal(item.acceptanceCriteria.length, 3);
    assert.equal(item.launchSignals.length, 2);
    assert.ok(item.routeTargets.length >= 2);
    assert.ok(item.acceptanceCriteria.every((criterion) => criterion.length > 20));
    assert.ok(item.launchSignals.every((signal) => signal.length > 10));
  }
});

test('can find roadmap items for app feature names', () => {
  assert.ok(getRoadmapForFeature('OASIS Analyzer').some((item) => item.id === 'oasis-readiness-checklist'));
  assert.ok(getRoadmapForFeature('Dashboard').some((item) => item.id === 'visit-command-center'));
  assert.ok(getRoadmapForFeature('Features').some((item) => item.id === 'release-notes-center'));
});


test('roadmap lookup supports broad category and feature-context matching', () => {
  assert.ok(getRoadmapForFeature('Document Hub').some((item) => item.id === 'document-packet-control-board'));
  assert.ok(getRoadmapForFeature('Smart Note Assistant quality AI').some((item) => item.id === 'ai-provenance-governance'));
  assert.deepEqual(getRoadmapForFeature(''), []);
});

test('feature enhancement suggestions are flattened and priority sorted', () => {
  const suggestions = getFeatureEnhancementSuggestions('Smart Note Assistant', 'ClinicalDocumentation');
  assert.ok(suggestions.length >= 3);
  assert.equal(suggestions[0].tier, 'critical');
  assert.ok(suggestions.some((suggestion) => suggestion.initiativeId === 'universal-draft-recovery'));
  assert.ok(suggestions.every((suggestion) => suggestion.enhancement.length > 20));
  assert.ok(suggestions.every((suggestion) => suggestion.phase.startsWith('Phase ')));
  assert.ok(suggestions.every((suggestion) => suggestion.acceptanceCriteria.length === 3));
  assert.ok(suggestions.every((suggestion) => suggestion.launchSignals.length === 2));
});
