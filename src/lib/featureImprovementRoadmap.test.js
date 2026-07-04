import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FEATURE_IMPROVEMENT_ROADMAP,
  summarizeImprovementRoadmap,
  getRoadmapForFeature,
  getFeatureEnhancementSuggestions
} from './featureImprovementRoadmap.js';

test('feature improvement roadmap covers robust enhancement inventory', () => {
  const summary = summarizeImprovementRoadmap();
  assert.equal(summary.totalInitiatives, FEATURE_IMPROVEMENT_ROADMAP.length);
  assert.ok(summary.totalInitiatives >= 6);
  assert.ok(summary.totalEnhancements >= 18);
  assert.ok(summary.byTier.critical >= 3);
  assert.ok(summary.uniqueFeatureTargets.size >= 12);
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

test('can find roadmap items for app feature names', () => {
  assert.ok(getRoadmapForFeature('OASIS Analyzer').some((item) => item.id === 'oasis-quality-readiness'));
  assert.ok(getRoadmapForFeature('Offline Mode').some((item) => item.id === 'hipaa-cyber-resilience'));
});


test('roadmap lookup supports broad category and feature-context matching', () => {
  assert.ok(getRoadmapForFeature('Document Hub').some((item) => item.id === 'hipaa-cyber-resilience'));
  assert.ok(getRoadmapForFeature('Smart Note Assistant quality AI').some((item) => item.id === 'ai-governance-trust'));
  assert.deepEqual(getRoadmapForFeature(''), []);
});

test('feature enhancement suggestions are flattened and priority sorted', () => {
  const suggestions = getFeatureEnhancementSuggestions('Offline Documentation Mode', 'Smart Note Assistant');
  assert.ok(suggestions.length >= 3);
  assert.equal(suggestions[0].tier, 'critical');
  assert.ok(suggestions.some((suggestion) => suggestion.initiativeId === 'hipaa-cyber-resilience'));
  assert.ok(suggestions.every((suggestion) => suggestion.enhancement.length > 20));
});
