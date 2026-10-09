import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (relativePath) => readFile(new URL(`../../${relativePath}`, import.meta.url), 'utf8');

const REVIEW_ONLY_COMPONENTS = [
  'src/components/oasis/OASISTaskGenerator.jsx',
  'src/components/carePlan/AutomatedTaskGenerator.jsx',
  'src/components/tasks/ProactiveClinicalTaskGenerator.jsx',
  'src/components/oasis/ClinicalPathwayTrigger.jsx',
  'src/components/oasis/AIPathwayRecommender.jsx',
];

const ENTITY_MUTATION_PATTERN = /\bentities(?:\.[A-Za-z_$][\w$]*|\[['"][^'"]+['"]\])(?:\.(?:create|bulkCreate|update|delete)|\[['"](?:create|bulkCreate|update|delete)['"]\])\s*\(/;
const FUNCTION_INVOKE_PATTERN = /\bbase44(?:\.asServiceRole)?\.functions\.invoke\s*\(/g;
const LITERAL_FUNCTION_INVOKE_PATTERN = /\bbase44(?:\.asServiceRole)?\.functions\.invoke\s*\(\s*(['"])([^'"]+)\1/g;

const ALLOWED_READ_ONLY_FUNCTIONS = new Map([
  [
    'src/components/tasks/ProactiveClinicalTaskGenerator.jsx',
    ['analyzeAndGenerateClinicalTasks'],
  ],
]);

function literalFunctionInvocations(source) {
  return [...source.matchAll(LITERAL_FUNCTION_INVOKE_PATTERN)].map((match) => match[2]);
}

test('review-only AI surfaces cannot directly mutate entities or invoke unreviewed functions', async () => {
  for (const path of REVIEW_ONLY_COMPONENTS) {
    const source = await read(path);
    assert.doesNotMatch(source, ENTITY_MUTATION_PATTERN, `${path} contains a direct entity mutation`);

    const invokeSites = source.match(FUNCTION_INVOKE_PATTERN) || [];
    const invokedFunctions = literalFunctionInvocations(source);
    assert.equal(
      invokedFunctions.length,
      invokeSites.length,
      `${path} contains a non-literal function invocation that cannot be reviewed`,
    );
    assert.deepEqual(
      invokedFunctions,
      ALLOWED_READ_ONLY_FUNCTIONS.get(path) || [],
      `${path} invokes a function that is not explicitly approved as read-only`,
    );
  }
});

test('the approved clinical-task analysis function remains read-only', async () => {
  const source = await read('base44/functions/analyzeAndGenerateClinicalTasks/entry.ts');
  assert.doesNotMatch(source, ENTITY_MUTATION_PATTERN);
  assert.doesNotMatch(source, /\bfunctions\.invoke\s*\(/);
});

// The owner released OASIS automation on 2026-10-08. What keeps it safe is
// WHERE it runs: the browser names only the saved upload, and the OASIS record
// broker opens the chart, evaluates the active rules against the analysis it
// stored, and claims each (upload, rule) run before any task, alert or
// notification is written. Nothing from the browser can choose a rule, a
// threshold, an action or a patient.
test('OASIS workflow execution runs only in the record broker, against the stored analysis', async () => {
  const engine = await read('src/components/oasis/WorkflowExecutionEngine.jsx');
  assert.match(engine, /const OASIS_AUTOMATION_EXECUTION_PAUSED = false;/);
  assert.doesNotMatch(engine, ENTITY_MUTATION_PATTERN);
  assert.doesNotMatch(engine, FUNCTION_INVOKE_PATTERN);
  const runs = [...engine.matchAll(/manageOASISRecords\(\s*'execute_workflows'\s*,\s*(\{[^}]*\})\s*\)/g)];
  assert.equal(runs.length, 1, 'one run path');
  assert.equal(runs[0][1].replace(/\s+/g, ' '), '{ upload_id: oasisUploadId }',
    'the browser sends the upload id and nothing a rule could be evaluated against');

  const broker = await read('base44/functions/manageOASISRecords/entry.ts');
  const body = broker.slice(broker.indexOf('async function executeWorkflows('));
  const fn = body.slice(0, body.indexOf('\n}\n'));
  const access = fn.indexOf('uploadAccess(');
  const chart = fn.indexOf('openChart(');
  const rules = fn.indexOf('OASISAutomationRule.filter(');
  const claim = fn.indexOf("createKeyedOnce(entities, 'OASISWorkflowExecution', 'run_id'");
  const action = fn.indexOf('runRuleAction(');
  assert.ok(access > 0 && access < chart && chart < rules && rules < claim && claim < action,
    'upload access, then the chart, then the stored rules, then the run claim, then any action');
  assert.match(fn, /upload\.analysis_results/);
  assert.doesNotMatch(fn, /body\.(analysis|rules?|actions?|patient_id|analysis_results)\b/,
    'no rule input is taken from the request');
  assert.match(fn, /if \(!claim\.created\)[\s\S]*?continue;/, 'a claimed run is re-reported, never re-run');
});

// Pathway activation adds tasks only through the broker's create_tasks, which
// opens the chart server-side and keys every task to the caller; the IDT
// coordinator stays read-only.
test('AI pathway activation writes tasks only through the chart-checked broker; IDT stays read-only', async () => {
  const pathway = await read('src/components/oasis/AIPathwayRecommender.jsx');
  const idt = await read('src/components/coordination/InterdisciplinaryTeamCoordinator.jsx');
  assert.doesNotMatch(pathway, ENTITY_MUTATION_PATTERN);
  assert.doesNotMatch(pathway, FUNCTION_INVOKE_PATTERN);
  assert.match(pathway, /manageOASISRecords\("create_tasks",\s*\{\s*patient_id: patientId,/);
  assert.match(pathway, /disabled=\{activating \|\| \(selectedTaskCount > 0 && !patientId\)\}/,
    'tasks cannot be requested without a chart');
  assert.doesNotMatch(idt, ENTITY_MUTATION_PATTERN);

  const broker = await read('base44/functions/manageOASISRecords/entry.ts');
  const body = broker.slice(broker.indexOf('async function createTasks('));
  const fn = body.slice(0, body.indexOf('\n}\n'));
  assert.ok(fn.indexOf('openChart(') >= 0 && fn.indexOf('openChart(') < fn.indexOf("createKeyedOnce(entities, 'Task'"),
    'the chart is opened before any task is written');
  assert.match(fn, /`oasis:\$\{scope\.userId\}:\$\{key\}`/, 'task keys are scoped to the caller');
  assert.match(fn, /assigned_to: scope\.email/);
});
