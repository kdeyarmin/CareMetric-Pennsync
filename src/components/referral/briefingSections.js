/**
 * Append one accepted documentation section to the nurse briefing
 * narrative that AdmissionBriefEmailCard embeds.
 */
export function appendBriefingSection(current, title, content) {
  const heading = typeof title === 'string' && title.trim() ? title.trim() : 'Admission documentation';
  const block = `${heading.toUpperCase()}\n${content.trim()}`;
  const existing = typeof current === 'string' ? current.trim() : '';
  return existing ? `${existing}\n\n${block}` : block;
}
