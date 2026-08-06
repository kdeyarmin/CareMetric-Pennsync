import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { transpileTs } from "../../tools-transpile-ts.mjs";

import * as videoNarration from "../../src/components/training/videoNarration.js";

/**
 * Drift guard for the HeyGen presenter-video helpers mirrored into
 * manageTrainingVideos. Transpiles the inline copies and asserts they behave
 * identically to src/components/training/videoNarration.js (the unit-tested
 * source). Mirrors faxRetryInlineParity.test.js.
 */
globalThis.Deno = globalThis.Deno || { serve() {}, env: { get: () => undefined } };

async function loadInline(entryPath, names) {
  let src = await readFile(new URL(entryPath, import.meta.url), "utf8");
  src = src.replace(/import\s+\{[^}]*\}\s+from\s+'npm:[^']*';?/, "const createClientFromRequest = () => ({});");
  const present = names.filter((n) => new RegExp(`(function|const)\\s+${n}\\b`).test(src));
  const js = transpileTs(src).outputText;
  const tmp = join(tmpdir(), `videoinline_${Date.now()}_${Math.random().toString(36).slice(2)}.mjs`);
  await writeFile(tmp, `${js}\nexport { ${present.join(", ")} };\n`);
  try {
    return { mod: await import(pathToFileURL(tmp).href), present };
  } finally {
    await unlink(tmp).catch(() => {});
  }
}

const ENTRY = "../functions/manageTrainingVideos/entry.ts";
const NAMES = [
  "buildNarrationScript", "truncateAtSentence", "sanitizeForSpeech", "speakableList",
  "normalizeHeyGenAvatars", "normalizeHeyGenVoices",
];

const CONTENTS = [
  undefined,
  {},
  {
    intro: "Falls are the leading cause of injury in home care.",
    sections: [
      { heading: "Risks", body: "Loose rugs and poor lighting.", pro_tip: "Scan the path.", warning: "Never leave patients standing." },
      null,
      {},
      { heading: "Reporting:", body: "Per CMS CoP §484.60(a), report same day, e.g. before end of shift. Safety & quality **matter**." },
      { heading: "Review", body: "Sterile vs. clean technique." },
    ],
    key_takeaways: ["Assess every visit", "Clear paths.", "  "],
    clinical_pearl: "Ask about near-falls.",
    summary: "Observe first.",
  },
  { sections: [{ heading: "Only one", body: "Single-section lead-in." }] },
  {
    intro: "Ignored when a script is authored.",
    video_narration:
      "Picture your first visit of the day. Before you knock, you are already assessing fall risk. Today we walk through what to look for, per §484.60, and how to document it the same day.",
  },
  { video_narration: "Too short.", sections: [{ heading: "Fallback", body: "Mechanical build runs." }] },
  { intro: "This sentence pads the script toward the provider limit. ".repeat(200) },
  { intro: "x".repeat(6000) },
];

test("inline narration helpers match videoNarration.js", async () => {
  const { mod, present } = await loadInline(ENTRY, NAMES);
  assert.deepEqual(present, NAMES, "expected all helpers inline in manageTrainingVideos");

  for (const content of CONTENTS) {
    assert.equal(mod.buildNarrationScript("Module Title", content), videoNarration.buildNarrationScript("Module Title", content));
  }
  for (const s of ["short", "A. ".repeat(3000), "y".repeat(5100)]) {
    assert.equal(mod.truncateAtSentence(s), videoNarration.truncateAtSentence(s));
  }
  for (const s of ["Per §484.60, e.g. now, i.e. today. A & B vs. C **bold**", "  spaced   out  ", "P&amp;P review, same&nbsp;day"]) {
    assert.equal(mod.sanitizeForSpeech(s), videoNarration.sanitizeForSpeech(s));
  }
  for (const list of [[], ["One."], ["One", "Two:"], ["One", "Two", "Three"]]) {
    assert.equal(mod.speakableList(list), videoNarration.speakableList(list));
  }

  const rawAvatars = [
    { avatar_id: "b", avatar_name: "Bravo", gender: "male", preview_image_url: "https://x/b.png" },
    { avatar_id: "b", avatar_name: "dupe" },
    { avatar_name: "no id" },
    null,
    { avatar_id: "a" },
  ];
  assert.deepEqual(mod.normalizeHeyGenAvatars(rawAvatars), videoNarration.normalizeHeyGenAvatars(rawAvatars));
  assert.deepEqual(mod.normalizeHeyGenAvatars(rawAvatars, 1), videoNarration.normalizeHeyGenAvatars(rawAvatars, 1));

  const rawVoices = [
    { voice_id: "fr1", name: "Zoe", language: "French" },
    { voice_id: "en1", name: "Beth", language: "English (US)", gender: "female", preview_audio: "https://x/beth.mp3" },
    { voice_id: "en1", name: "dupe", language: "English" },
    { voice_id: "en2", name: "Adam", language: "English", preview_audio_url: "https://x/adam.mp3" },
    { name: "no id" },
  ];
  assert.deepEqual(mod.normalizeHeyGenVoices(rawVoices), videoNarration.normalizeHeyGenVoices(rawVoices));
  assert.deepEqual(mod.normalizeHeyGenVoices(rawVoices, 2), videoNarration.normalizeHeyGenVoices(rawVoices, 2));
});
