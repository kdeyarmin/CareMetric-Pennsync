import test from "node:test";
import assert from "node:assert/strict";
import {
  openItemsForExtraction,
  buildResponseExtractionPrompt,
  RESPONSE_EXTRACTION_SCHEMA,
  usableAnswers,
} from "./responseIngestion.js";

const items = [
  { id: "f2f_missing", item_status: "open", title: "F2F missing", provider_request: { question: "Attach the F2F note" } },
  { id: "orders_missing", title: "Orders", needed: "Signed orders" }, // no status = open, no question → needed
  { id: "insurance_missing", item_status: "answered", title: "Insurance" },
  { id: "homebound_undocumented", item_status: "resolved", title: "Homebound" },
];

test("openItemsForExtraction keeps only open items with their question text", () => {
  const open = openItemsForExtraction(items);
  assert.deepEqual(open.map((it) => it.id), ["f2f_missing", "orders_missing"]);
  assert.equal(open[0].question, "Attach the F2F note");
  assert.equal(open[1].question, "Signed orders");
  assert.deepEqual(openItemsForExtraction(null), []);
});

test("the prompt lists every open item with its id and forbids invented answers", () => {
  const prompt = buildResponseExtractionPrompt(openItemsForExtraction(items));
  assert.match(prompt, /Additional Information Request/);
  assert.match(prompt, /id: f2f_missing/);
  assert.match(prompt, /id: orders_missing/);
  assert.match(prompt, /Do NOT invent or infer answers/);
  assert.ok(!prompt.includes("insurance_missing"), "answered items must not be requested");
});

test("an item missing title/question never renders 'undefined' or an empty Question line", () => {
  const bare = [{ id: "certifier_missing", item_status: "open" }]; // no title, no question, no needed
  const prompt = buildResponseExtractionPrompt(openItemsForExtraction(bare));
  assert.match(prompt, /id: certifier_missing/);
  assert.ok(!prompt.includes("undefined"), "no field may render as 'undefined'");
  assert.ok(!/Question:\s*$/m.test(prompt), "no empty Question line");
  // The id doubles as the display title when none is documented.
  assert.match(prompt, /1\. id: certifier_missing\n {3}certifier_missing/);
});

test("the schema carries per-item answers", () => {
  const props = RESPONSE_EXTRACTION_SCHEMA.properties.answers.items.properties;
  assert.deepEqual(Object.keys(props).sort(), ["answered", "id", "response_text"]);
});

test("usableAnswers keeps only answered, non-empty answers targeting open items", () => {
  const open = openItemsForExtraction(items);
  const usable = usableAnswers(
    {
      answers: [
        { id: "f2f_missing", answered: true, response_text: "Note attached" },
        { id: "orders_missing", answered: true, response_text: "   " }, // blank
        { id: "insurance_missing", answered: true, response_text: "not an open item" },
        { id: "made_up", answered: true, response_text: "hallucinated id" },
        { id: "f2f_missing", answered: false, response_text: "unanswered" },
      ],
    },
    open
  );
  assert.equal(usable.length, 1);
  assert.equal(usable[0].id, "f2f_missing");
  assert.deepEqual(usableAnswers(null, open), []);
});
