import { sanitizeHtml } from '@/components/utils/security';

// CVE-2025-15056: sanitize at the persistence boundary as well as on editor
// input/output, including older templates saved without opening the editor.
export function sanitizeTemplateRichText(template) {
  if (!Array.isArray(template.visual_elements)) return template;
  return {
    ...template,
    visual_elements: template.visual_elements.map(element =>
      element.type === 'rich_text' ? {
        ...element,
        properties: {
          ...element.properties,
          defaultValue: sanitizeHtml(element.properties?.defaultValue || ''),
        },
      } : element
    ),
  };
}