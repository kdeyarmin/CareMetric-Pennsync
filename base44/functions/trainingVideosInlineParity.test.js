import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

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
  const js = ts.transpileModule(src, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;
  const tmp = join(tmpdir(), `videoinline_${Date.now()}_${Math.random().toString(36).slice(2)}.mjs`);
  await writeFile(tmp, `${js}\nexport { ${present.join(", ")} };\n`);
  try {
    return { mod: await import(pathToFileURL(tmp).href), present };
  } finally {
    await unlink(tmp).catch(() => {});
  }
}

const ENTRY = "./manageTrainingVideos/entry.ts";
const NAMES = ["buildNarrationScript", "truncateAtSentence", "normalizeHeyGenAvatars", "normalizeHeyGenVoices"];

const CONTENTS = [
  undefined,
  {},
  {
    intro: "Falls are the leading cause of injury in home care.",
    sections: [
      { heading: "Risks", body: "Loose rugs and poor lighting.", pro_tip: "Scan the path.", warning: "Never leave patients standing." },
      null,
      {},
    ],
    key_takeaways: ["Assess every visit", "Clear paths.", "  "],
    clinical_pearl: "Ask about near-falls.",
    summary: "Observe first.",
  },
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
    { name: "no id" },
  ];
  assert.deepEqual(mod.normalizeHeyGenVoices(rawVoices), videoNarration.normalizeHeyGenVoices(rawVoices));
  assert.deepEqual(mod.normalizeHeyGenVoices(rawVoices, 2), videoNarration.normalizeHeyGenVoices(rawVoices, 2));
});
