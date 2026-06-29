import { test } from "node:test";
import assert from "node:assert/strict";
import {
  renderTemplate,
  buildTemplateContext,
  getTemplates,
  MERGE_FIELDS,
  DEFAULT_TEMPLATES,
} from "./smsTemplates.js";

test("renderTemplate substitutes known tokens", () => {
  const out = renderTemplate("Hi {first_name}, this is {nurse_name}.", {
    first_name: "Ada",
    nurse_name: "Nurse Joy",
  });
  assert.equal(out, "Hi Ada, this is Nurse Joy.");
});

test("renderTemplate is case-insensitive on tokens and keys", () => {
  assert.equal(
    renderTemplate("Hello {First_Name}", { FIRST_NAME: "Sam" }),
    "Hello Sam"
  );
});

test("renderTemplate leaves unknown tokens untouched", () => {
  assert.equal(
    renderTemplate("Visit at {when} for {first_name}", { first_name: "Lee" }),
    "Visit at {when} for Lee"
  );
});

test("renderTemplate drops missing values and tidies spacing/punctuation", () => {
  // last_name missing -> empty, leaving "Lee " then comma; collapse + fix.
  assert.equal(
    renderTemplate("Hi {first_name} {last_name}, welcome.", { first_name: "Lee" }),
    "Hi Lee, welcome."
  );
});

test("renderTemplate returns empty string for empty body", () => {
  assert.equal(renderTemplate(""), "");
  assert.equal(renderTemplate(null), "");
});

test("buildTemplateContext pulls only the fields we can populate", () => {
  const ctx = buildTemplateContext({
    patient: { first_name: "Ada", last_name: "Lovelace" },
    user: { full_name: "Nurse Joy" },
    settings: { main_office_number_e164: "+12155550100" },
  });
  assert.deepEqual(ctx, {
    first_name: "Ada",
    last_name: "Lovelace",
    nurse_name: "Nurse Joy",
    office: "+12155550100",
  });
});

test("buildTemplateContext is safe with nothing provided", () => {
  const ctx = buildTemplateContext();
  assert.equal(ctx.first_name, "");
  assert.equal(ctx.office, "");
});

test("getTemplates falls back to defaults when none configured", () => {
  assert.deepEqual(getTemplates(undefined), DEFAULT_TEMPLATES.map((t) => ({ label: t.label, body: t.body })));
  assert.deepEqual(getTemplates({ sms_templates: [] }), DEFAULT_TEMPLATES.map((t) => ({ label: t.label, body: t.body })));
});

test("getTemplates parses 'Label | body' strings", () => {
  const out = getTemplates({ sms_templates: ["Reminder | Hi {first_name}, see you soon."] });
  assert.equal(out.length, 1);
  assert.equal(out[0].label, "Reminder");
  assert.equal(out[0].body, "Hi {first_name}, see you soon.");
});

test("getTemplates accepts object form and drops bodyless entries", () => {
  const out = getTemplates({
    sms_templates: [
      { label: "A", body: "Body A" },
      { label: "Empty", body: "   " },
      { body: "No label body" },
    ],
  });
  assert.equal(out.length, 2);
  assert.equal(out[0].label, "A");
  assert.equal(out[1].label, "No label body");
});

test("getTemplates derives a label for a bare string without a pipe", () => {
  const out = getTemplates({ sms_templates: ["Just a short one"] });
  assert.equal(out[0].label, "Just a short one");
  assert.equal(out[0].body, "Just a short one");
});

test("MERGE_FIELDS expose tokens with human labels", () => {
  assert.ok(MERGE_FIELDS.length >= 3);
  for (const f of MERGE_FIELDS) {
    assert.match(f.token, /^\{[a-z_]+\}$/);
    assert.ok(f.label);
  }
});
