// Validate the read/mutation shape before calling an empty list or a job count
// successful. Does not execute a provider request or change delivery permissions.
function resultBody(response) {
  const value = response?.data ?? response;
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.error || value.success === false) {
    throw new Error('Training video response is unavailable.');
  }
  return value;
}
function validModules(modules) {
  return Array.isArray(modules) && modules.every(module => module && typeof module === 'object'
    && typeof module.module_id === 'string' && module.module_id.trim().length > 0);
}
export function readVideoStatus(response) {
  const value = resultBody(response);
  if (typeof value.heygen_configured !== 'boolean' || !validModules(value.modules)) {
    throw new Error('Training video status could not be verified.');
  }
  return value;
}
export function readGenerationResult(response) {
  const value = resultBody(response);
  if (!Number.isSafeInteger(value.started) || value.started < 0 || !validModules(value.modules)
    || value.started > value.modules.length) throw new Error('Video generation did not return a confirmed result.');
  return value;
}
export function formatVideoDuration(value) {
  if ((typeof value !== 'number' && typeof value !== 'string') || String(value).trim() === '') return null;
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  const rounded = Math.round(seconds);
  return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, '0')}`;
}
