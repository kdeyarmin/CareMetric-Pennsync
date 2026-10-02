import { buildLearningUrl, buildCourseEditorUrl, buildMyLearningUrl } from '@caremetric/help-sdk';
import { resolveCentralHelpActivation } from './centralHelp';

export const PENNSYNC_LEARNING_URL = buildLearningUrl({ product: 'pennsync' });
export const CENTRAL_COURSE_EDITOR_URL = buildCourseEditorUrl();
export const CENTRAL_MY_LEARNING_URL = buildMyLearningUrl();

// Deploy the Hub runtime and migrate tenant/account history before cutover.
// This is a release switch, not a vendor credential.
// The verified-production-build question is `centralHelp`'s and is asked of the
// Base44 app id or, in a build no longer identified to Base44, the owned
// production build id. This switch adds its own requirement on top: the flag
// must be the exact string `true` under either identity, so the omitted-flag
// default that path allows for the Help launcher never activates learning.
/** @param {{appId?: string, buildId?: string, backend?: string, environment?: string, flag?: string, isDevelopment?: boolean}} input */
export function resolveCentralLearningActivation(input = {}) {
  return input.flag === 'true' && resolveCentralHelpActivation(input);
}
const env = import.meta.env || {};
export const CENTRAL_LEARNING_ENABLED = resolveCentralLearningActivation({
  appId: env.VITE_BASE44_APP_ID,
  buildId: env.VITE_PENNSYNC_BUILD_ID,
  backend: env.VITE_PENNSYNC_BACKEND,
  environment: env.VITE_DEPLOY_ENV,
  flag: env.VITE_CENTRAL_LEARNING_ENABLED,
  isDevelopment: env.DEV === true,
});
