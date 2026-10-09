// Only app-owned uploads can be attached to these bounded document operations.
// No caller-supplied prompts, model selection, output schemas, or remote hosts.
const APP_ID = '694ec16e72e01b60d22f7cbf';
const STORAGE_HOSTS = new Set(['qtrypzzcjebvfcihiynt.supabase.co', 'media.base44.com']);
export function clinicalUploadUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw Object.assign(new Error('Invalid uploaded file'), { status: 400 }); }
  if (typeof value !== 'string' || value.length > 4096 || url.protocol !== 'https:' || url.username || url.password || url.hash || !STORAGE_HOSTS.has(url.hostname)
      || !url.pathname.split('/').includes(APP_ID)) {
    throw Object.assign(new Error('An upload belonging to this app is required'), { status: 400 });
  }
  return url.href;
}