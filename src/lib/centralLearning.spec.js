import { describe, expect, it } from 'vitest';
import { PENNSYNC_LEARNING_URL, CENTRAL_COURSE_EDITOR_URL, CENTRAL_MY_LEARNING_URL, resolveCentralLearningActivation } from './centralLearning';
import { PENNSYNC_OWNED_PRODUCTION_BUILD_ID, PENNSYNC_PRODUCTION_APP_ID } from './centralHelp';

describe('central learning cutover', () => {
  it('keeps local records available until an explicit verified production cutover', () => {
    const production = { appId: PENNSYNC_PRODUCTION_APP_ID, environment: 'production' };
    expect(resolveCentralLearningActivation(production)).toBe(false);
    expect(resolveCentralLearningActivation({ ...production, flag: 'true' })).toBe(true);
    expect(resolveCentralLearningActivation({ ...production, flag: 'true', environment: 'staging' })).toBe(false);
    expect(resolveCentralLearningActivation({ ...production, flag: 'true', isDevelopment: true })).toBe(false);
  });
  it('can be thrown in a production build that is no longer identified to Base44', () => {
    const owned = { buildId: PENNSYNC_OWNED_PRODUCTION_BUILD_ID, environment: 'production' };
    expect(resolveCentralLearningActivation({ ...owned, flag: 'true' })).toBe(true);
    expect(resolveCentralLearningActivation(owned)).toBe(false);
    expect(resolveCentralLearningActivation({ ...owned, flag: 'true', environment: 'staging' })).toBe(false);
    expect(resolveCentralLearningActivation({ ...owned, flag: 'true', isDevelopment: true })).toBe(false);
    // Synthetic staging holds no real learner history, so it never activates.
    expect(resolveCentralLearningActivation({
      ...owned, flag: 'true', backend: 'independent-staging',
    })).toBe(false);
    // An ambiguous build is not a verified one, under either identity.
    expect(resolveCentralLearningActivation({
      ...owned, appId: PENNSYNC_PRODUCTION_APP_ID, flag: 'true',
    })).toBe(false);
    expect(resolveCentralLearningActivation({
      buildId: 'caremetric-pennsync-preview', flag: 'true', environment: 'production',
    })).toBe(false);
  });
  it('sends only product context and no local records or identity', () => {
    const catalog = new URL(PENNSYNC_LEARNING_URL);
    expect(catalog.pathname).toBe('/learn');
    expect([...catalog.searchParams]).toEqual([['product', 'pennsync']]);
    expect(new URL(CENTRAL_COURSE_EDITOR_URL).pathname).toBe('/library/courses/new');
    expect(new URL(CENTRAL_MY_LEARNING_URL).pathname).toBe('/learn/my');
    expect(new URL(CENTRAL_COURSE_EDITOR_URL).search).toBe('');
  });
});
