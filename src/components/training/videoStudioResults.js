// Validate the read/mutation shape before calling an empty list or a job count
// successful. Does not execute a provider request or change delivery permissions.
function resultBody(response) {
  const value = response?.data ?? response;
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.error || value.success === false) {
    throw new Error('Training video response is unavailable.');
  }
  return value;
}
const isRecord = value => value && typeof value === 'object' && !Array.isArray(value);
const optionalText = value => value == null || typeof value === 'string';
function uniqueRecords(records, idKey) {
  if (!Array.isArray(records)) return false;
  const ids = new Set();
  return Array.from(records).every(record => {
    if (!isRecord(record) || typeof record[idKey] !== 'string' || !record[idKey].trim()
      || ids.has(record[idKey]) || !optionalText(record.title)) return false;
    ids.add(record[idKey]);
    return true;
  });
}
export function readTrainingRecords(records) {
  if (!uniqueRecords(records, 'id') || !records.every(record => record.content_json == null || isRecord(record.content_json))) {
    throw new Error('Training records could not be verified.');
  }
  return records;
}
function validModules(modules) {
  return uniqueRecords(modules, 'module_id') && modules.every(module =>
    ['none', 'processing', 'completed', 'failed'].includes(module.video_status)
    && ['video_url', 'video_thumbnail_url', 'video_error'].every(key => optionalText(module[key])));
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
