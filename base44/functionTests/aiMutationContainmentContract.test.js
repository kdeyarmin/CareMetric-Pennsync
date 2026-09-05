import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (relativePath) => readFile(new URL(`../../${relativePath}`, import.meta.url), 'utf8');

const REVIEW_ONLY_COMPONENTS = [
  'src/components/oasis/OASISTaskGenerator.jsx',
  'src/components/carePlan/AutomatedTaskGenerator.jsx',
  'src/components/alerts/PatientAlertAnalyzer.jsx',
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

test('legacy OASIS workflow execution remains literally hard-paused before every mutation path', async () => {
  const source = await read('src/components/oasis/WorkflowExecutionEngine.jsx');
  assert.match(source, /const OASIS_AUTOMATION_EXECUTION_PAUSED = true;/);
  assert.match(source, /enabled:\s*!OASIS_AUTOMATION_EXECUTION_PAUSED/);

  const executeStart = source.indexOf('const executeWorkflows = useCallback');
  const pauseGuard = source.indexOf('if (OASIS_AUTOMATION_EXECUTION_PAUSED)', executeStart);
  const actionDispatch = source.indexOf('await executeActions', executeStart);
  assert.ok(executeStart >= 0 && pauseGuard > executeStart && pauseGuard < actionDispatch);
  assert.match(source, /Automated OASIS actions are paused pending one atomic, idempotent, patient-authorized broker/);
});

test('AI pathway activation and IDT alert creation stay fail-closed', async () => {
  const pathway = await read('src/components/oasis/AIPathwayRecommender.jsx');
  const idt = await read('src/components/coordination/InterdisciplinaryTeamCoordinator.jsx');
  assert.match(pathway, /if \(selectedTaskCount > 0\) \{\s*return;/);
  assert.doesNotMatch(pathway, ENTITY_MUTATION_PATTERN);
  assert.doesNotMatch(idt, ENTITY_MUTATION_PATTERN);
});
