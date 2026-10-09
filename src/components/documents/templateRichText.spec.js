import { describe, it, expect, vi } from 'vitest';

// No telemetry or backend requests are needed to test HTML sanitization.
vi.mock('@/components/utils/activityLogger', () => ({ logError: vi.fn() }));
import { sanitizeHtml } from '@/components/utils/security';
import { sanitizeTemplateRichText } from '@/components/documents/templateRichText';

const payloads = [
  '<span></span><img src=x onerror=alert(1)>',
  '<a href="https://example.com" onmouseover="alert(1)">video</a>',
  '<a href="javascript:alert(1)">video</a>',
  '<a href="java&#x73;cript:alert(1)">video</a>',
  '<svg onload="alert(1)"><script>alert(1)</script></svg>',
  '<iframe srcdoc="<script>alert(1)</script>"></iframe>',
];

function expectInert(html) {
  const container = document.createElement('div');
  container.innerHTML = html;
  expect(container.querySelector('script, iframe, svg, object, embed')).toBeNull();
  for (const node of container.querySelectorAll('*')) {
    for (const attr of node.attributes) {
      expect(attr.name).not.toMatch(/^on/i);
      if (['href', 'src'].includes(attr.name)) {
        expect(attr.value).not.toMatch(/^\s*(javascript|vbscript|data:text\/html):/i);
      }
    }
  }
}

describe('Quill HTML export XSS mitigation (CVE-2025-15056)', () => {
  it.each(payloads)('sanitizes formula/video export payload: %s', payload => {
    expectInert(sanitizeHtml(payload));
  });

  it('preserves normal rich text formatting and safe links', () => {
    const html = '<h2>Instructions</h2><p><strong>Bold</strong><em>Italic</em><u>Underline</u><span style="color: rgb(255, 0, 0);">Color</span><a href="https://example.com">Link</a></p><ol><li>First</li></ol>';
    expect(sanitizeHtml(html)).toBe(html);
  });

  it('sanitizes every rich text field at save, including unchanged legacy content', () => {
    const plain = { id: 'plain', type: 'text', properties: { defaultValue: '<literal>' } };
    const original = { template_name: 'Existing template', visual_elements: [plain,
      ...payloads.map((payload, index) => ({ id: String(index), type: 'rich_text', properties: { defaultValue: payload, required: true } })),
    ] };
    const saved = sanitizeTemplateRichText(original);
    expect(saved.template_name).toBe(original.template_name);
    expect(saved.visual_elements[0]).toBe(plain);
    saved.visual_elements.slice(1).forEach(element => {
      expectInert(element.properties.defaultValue);
      expect(element.properties.required).toBe(true);
    });
    expect(original.visual_elements[1].properties.defaultValue).toBe(payloads[0]);
  });

  it('preserves templates without visual elements and handles empty rich text', () => {
    const template = { template_name: 'PDF only' };
    expect(sanitizeTemplateRichText(template)).toBe(template);
    expect(sanitizeTemplateRichText({ visual_elements: [{ type: 'rich_text', properties: {} }] })
      .visual_elements[0].properties.defaultValue).toBe('');
  });
});