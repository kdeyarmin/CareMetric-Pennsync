import { exactObject, fail, text } from './contracts.mjs';

// Shared browser/server request contract. No provider credential or network I/O.
export function emailAddress(value) {
  const address = text(value, 320).trim();
  if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(address)) fail(400, 'INVALID_EMAIL');
  return address;
}
export function validateMailParams(value) {
  exactObject(value, ['to', 'subject', 'body', 'content_type', 'from_name']);
  const recipients = Array.isArray(value.to) ? value.to : [value.to];
  if (!recipients.length || recipients.length > 10) fail(400, 'INVALID_RECIPIENTS');
  recipients.forEach(emailAddress);
  text(value.subject, 500); text(value.body, 100000);
  // Existing v1 plain-text requests keep their exact behavior. HTML must be an
  // explicit new choice; never guess content type by sniffing user text.
  if (Object.hasOwn(value, 'content_type') && !['text/plain', 'text/html'].includes(value.content_type)) fail(400, 'INVALID_EMAIL_CONTENT_TYPE');
  if (Object.hasOwn(value, 'from_name')) {
    text(value.from_name, 100);
    if (value.from_name.trim() !== value.from_name || /[\r\n\t]/.test(value.from_name)) fail(400, 'INVALID_SENDER_NAME');
  }
  if (/[\r\n]/.test(value.subject)) fail(400, 'INVALID_EMAIL_SUBJECT');
  return value;
}

/** No arbitrary header, sender-address, attachment or tracking options allowed. */
export function buildMailPayload(value, fixedSender, { sandbox = false } = {}) {
  validateMailParams(value);
  if (typeof sandbox !== 'boolean') fail(400, 'INVALID_SANDBOX_MODE');
  const recipients = (Array.isArray(value.to) ? value.to : [value.to]).map(emailAddress);
  const payload = {
    personalizations: [{ to: recipients.map(address => ({ email: address })) }],
    from: { email: emailAddress(fixedSender), ...(Object.hasOwn(value, 'from_name') ? { name: value.from_name } : {}) },
    subject: value.subject,
    content: [{ type: value.content_type || 'text/plain', value: value.body }],
    tracking_settings: { click_tracking: { enable: false, enable_text: false }, open_tracking: { enable: false } },
  };
  if (sandbox) payload.mail_settings = { sandbox_mode: { enable: true } };
  return payload;
}
