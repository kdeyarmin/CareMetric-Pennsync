import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// <<<BEGIN SHARED HELPER: pennsyncProductionAppId — generated, edit base44/_shared/backendHelpers.mjs>>>
const PENNSYNC_PRODUCTION_APP_ID = '694ec16e72e01b60d22f7cbf';
// <<<END SHARED HELPER: pennsyncProductionAppId>>>
// <<<BEGIN SHARED HELPER: base44ClientRequest — generated, edit base44/_shared/backendHelpers.mjs>>>
function pinnedBase44Request(req, expectedAppId, forwardUserCredential) {
  if (typeof expectedAppId !== 'string' || expectedAppId === '') {
    throw new Error('pinned Base44 request requires an expected Base44-App-Id');
  }
  // Read the inbound headers without ever throwing on the SHAPE of req. A production
  // request is always a real Request with a Headers bag; a bare object with no usable
  // headers (a test fixture, a malformed direct call) carries no inbound header, which
  // is the absent case handled below. Only a PRESENT, different app id throws, and that
  // requires a real header an attacker would have to set — so a real Request always
  // reaches this read and the refusal is never skipped by the tolerance.
  const inbound =
    req && req.headers && typeof req.headers.get === 'function' ? req.headers : null;
  const read = (name) => (inbound ? inbound.get(name) : null);
  const received = read('Base44-App-Id');
  // Refuse only an ACTIVE mismatch: a caller presenting a DIFFERENT app id is the
  // tenant-redirect attack, and that is the case the refusal exists for. An ABSENT
  // header is not a mismatch and selects no other tenant — it only means the request
  // did not arrive through the platform, which always injects this header. We SET the
  // pinned constant below either way, so absent falls back to the correct app exactly
  // as the dropped Base44-Api-Url falls back to the default serverUrl. Throwing on
  // absent would turn every anonymous denial into a 500 instead of a clean 403.
  if (received !== null && received !== expectedAppId) {
    throw new Error(
      'Base44-App-Id mismatch: expected ' + expectedAppId + ', received ' + received
    );
  }
  const headers = new Headers();
  // Load-bearing: SET the constant (never forward the inbound value). The SDK reads
  // appId from this header and throws of its own accord when it is absent, so pinning
  // requires setting it here — dropping the inbound header alone would not suffice.
  headers.set('Base44-App-Id', expectedAppId);
  const serviceAuth = read('Base44-Service-Authorization');
  if (serviceAuth !== null) headers.set('Base44-Service-Authorization', serviceAuth);
  if (forwardUserCredential) {
    const authorization = read('Authorization');
    if (authorization !== null) headers.set('Authorization', authorization);
    const dataEnv = read('X-Data-Env');
    if (dataEnv === 'dev' || dataEnv === 'prod') headers.set('X-Data-Env', dataEnv);
  }
  // Cosmetic URL: serverUrl comes from the dropped Base44-Api-Url, not from here.
  // No method: the SDK request factory reads only headers.get(...), never the
  // method, so the request defaults to GET. An explicit POST would be inert for the
  // SDK and would read as an outbound delivery primitive to the inventory scanner
  // once this block is inlined into the fax status pollers.
  return new Request('https://base44.app', { headers });
}
function userScopedClientRequest(req, expectedAppId) {
  return pinnedBase44Request(req, expectedAppId, true);
}
function serviceRoleClientRequest(req, expectedAppId) {
  return pinnedBase44Request(req, expectedAppId, false);
}
// <<<END SHARED HELPER: base44ClientRequest>>>
// <<<BEGIN SHARED HELPER: requireActiveUser — generated, edit base44/_shared/backendHelpers.mjs>>>
const isDeactivatedUser = (u) => !!u && u.is_active === false;
const DEACTIVATED_USER_RESPONSE = () => Response.json(
  { error: 'Unauthorized - account is deactivated' },
  { status: 403 },
);
// <<<END SHARED HELPER: requireActiveUser>>>

const MAX_IDENTIFIER_LENGTH = 200;
const MAX_DECISIONS = 200;
const ATTEMPT_SCAN_LIMIT = 1000;

class PublicError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'PublicError';
    this.status = status;
  }
}

const normalizeEmail = (value: unknown) =>
  typeof value === 'string' ? value.trim().toLowerCase() : '';

function exactIdentifier(value: unknown, required = true) {
  if (value === undefined || value === null || value === '') {
    if (!required) return null;
    throw new PublicError(400, 'A required identifier is missing');
  }
  if (
    typeof value !== 'string'
    || value.length > MAX_IDENTIFIER_LENGTH
    || value.trim() !== value
  ) {
    throw new PublicError(400, 'An identifier is invalid');
  }
  return value;
}

function requireRows(value: unknown, label: string) {
  if (!Array.isArray(value)) throw new Error(`${label} returned a non-array result`);
  return value as Array<Record<string, any>>;
}

async function parsePayload(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new PublicError(400, 'Invalid JSON body');
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new PublicError(400, 'Request body must be an object');
  }

  const record = body as Record<string, unknown>;
  const rawDecisions = record.decisions;
  if (!Array.isArray(rawDecisions) || rawDecisions.length === 0 || rawDecisions.length > MAX_DECISIONS) {
    throw new PublicError(400, `decisions must contain 1-${MAX_DECISIONS} choices`);
  }

  const decisions = rawDecisions.map((raw, index) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new PublicError(400, `Decision ${index + 1} is invalid`);
    }
    const decision = raw as Record<string, unknown>;
    const nodeId = exactIdentifier(decision.node_id ?? decision.nodeId);
    const choiceIndex = decision.choice_index ?? decision.choiceIndex;
    if (!Number.isInteger(choiceIndex) || Number(choiceIndex) < 0) {
      throw new PublicError(400, `Decision ${index + 1} has an invalid choice index`);
    }
    return { nodeId, choiceIndex: Number(choiceIndex) };
  });

  return {
    scenarioId: exactIdentifier(record.scenario_id ?? record.scenarioId),
    assignmentId: exactIdentifier(record.assignment_id ?? record.assignmentId, false),
    decisions,
  };
}

async function loadExact(
  entity: { filter: (...args: any[]) => Promise<unknown> },
  entityName: string,
  id: string,
) {
  const rows = requireRows(
    await entity.filter({ id }, undefined, 10),
    `${entityName}.filter`,
  );
  const exact = rows.filter((row) => row?.id === id);
  if (exact.length === 0) throw new PublicError(404, `${entityName} not found`);
  if (exact.length !== 1 || rows.length >= 10) {
    throw new PublicError(409, `${entityName} is ambiguous`);
  }
  return exact[0];
}

function authoritativeGrade(scenario: Record<string, any>, submitted: Array<{ nodeId: string; choiceIndex: number }>) {
  const flow = scenario.scenario_flow_json;
  if (!flow || typeof flow !== 'object' || Array.isArray(flow)) {
    throw new PublicError(409, 'Scenario flow is invalid');
  }

  let startNodeId: string;
  let nodes: Record<string, any>;
  if (flow.nodes && typeof flow.nodes === 'object' && !Array.isArray(flow.nodes)) {
    nodes = flow.nodes;
    startNodeId = typeof flow.startNodeId === 'string' && flow.startNodeId
      ? flow.startNodeId
      : 'node-start';
  } else if (typeof flow.id === 'string' && flow.id) {
    startNodeId = flow.id;
    nodes = { [flow.id]: flow };
  } else {
    throw new PublicError(409, 'Scenario flow is invalid');
  }

  let currentNodeId = startNodeId;
  const canonicalDecisions: Array<Record<string, unknown>> = [];
  for (const decision of submitted) {
    if (decision.nodeId !== currentNodeId) {
      throw new PublicError(409, 'Submitted choices do not follow the scenario flow');
    }
    const node = nodes[currentNodeId];
    if (!node || !Array.isArray(node.choices) || node.choices.length === 0) {
      throw new PublicError(409, 'Submitted choices do not follow the scenario flow');
    }
    const choice = node.choices[decision.choiceIndex];
    if (!choice || typeof choice !== 'object' || typeof choice.isCorrect !== 'boolean') {
      throw new PublicError(409, 'Scenario choice is invalid');
    }

    canonicalDecisions.push({
      nodeId: currentNodeId,
      choiceIndex: decision.choiceIndex,
      isCorrect: choice.isCorrect,
    });

    if (choice.isCorrect) {
      const nextNodeId = choice.nextNodeId;
      if (nextNodeId === null || nextNodeId === undefined || nextNodeId === '') {
        currentNodeId = 'node-end';
      } else if (nextNodeId === 'node-end') {
        currentNodeId = 'node-end';
      } else if (typeof nextNodeId === 'string' && nodes[nextNodeId]) {
        currentNodeId = nextNodeId;
      } else {
        throw new PublicError(409, 'Scenario flow points to an unknown node');
      }
    }
  }

  if (currentNodeId !== 'node-end') {
    const terminal = nodes[currentNodeId];
    if (!terminal || (Array.isArray(terminal.choices) && terminal.choices.length > 0)) {
      throw new PublicError(409, 'Scenario is not complete');
    }
  }

  const finalDecisionByNode = new Map<string, Record<string, unknown>>();
  for (const decision of canonicalDecisions) {
    finalDecisionByNode.set(String(decision.nodeId), decision);
  }
  const finalDecisions = [...finalDecisionByNode.values()];
  const correctDecisions = finalDecisions.filter((decision) => decision.isCorrect === true).length;
  const totalDecisions = finalDecisions.length;
  const scorePercentage = totalDecisions > 0
    ? Math.round((correctDecisions / totalDecisions) * 100)
    : 0;

  const rawPassingScore = scenario.passing_score ?? 80;
  const passingScore = Number(rawPassingScore);
  if (!Number.isFinite(passingScore) || passingScore < 0 || passingScore > 100) {
    throw new PublicError(409, 'Scenario passing score is invalid');
  }

  return {
    canonicalDecisions,
    correctDecisions,
    totalDecisions,
    scorePercentage,
    passingScore,
    passed: scorePercentage >= passingScore,
  };
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(userScopedClientRequest(req, PENNSYNC_PRODUCTION_APP_ID));
    const user = await base44.auth.me().catch(() => null);
    if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    const ownerEmail = normalizeEmail(user?.email);
    const ownerUserId = exactIdentifier(user?.id, false);
    if (!ownerUserId || !ownerEmail) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    const payload = await parsePayload(req);
    const entities = base44.asServiceRole.entities;
    const scenario = await loadExact(
      entities.ClinicalScenario,
      'ClinicalScenario',
      payload.scenarioId,
    );
    if (scenario.active === false) throw new PublicError(409, 'Scenario is inactive');

    if (payload.assignmentId) {
      const assignment = await loadExact(
        entities.TrainingAssignment,
        'TrainingAssignment',
        payload.assignmentId,
      );
      if (normalizeEmail(assignment.assigned_to_user_id) !== ownerEmail) {
        throw new PublicError(403, 'Assignment does not belong to the authenticated user');
      }
      if (scenario.course_id && assignment.course_id !== scenario.course_id) {
        throw new PublicError(409, 'Assignment does not match the scenario course');
      }
    }

    const grade = authoritativeGrade(scenario, payload.decisions);
    const priorRows = requireRows(
      await entities.ScenarioAttempt.filter(
        { scenario_id: payload.scenarioId },
        '-created_date',
        ATTEMPT_SCAN_LIMIT,
      ),
      'ScenarioAttempt.filter',
    );
    if (priorRows.length >= ATTEMPT_SCAN_LIMIT) {
      throw new PublicError(409, 'Scenario attempt history is too large to grade safely');
    }
    const ownPrior = priorRows.filter(
      (row) => row?.scenario_id === payload.scenarioId
        && normalizeEmail(row?.user_id) === ownerEmail,
    );
    const maxAttempts = Number(scenario.max_attempts);
    if (Number.isInteger(maxAttempts) && maxAttempts > 0 && ownPrior.length >= maxAttempts) {
      throw new PublicError(409, 'Maximum scenario attempts reached');
    }

    // There is no trustworthy server-side start event in the legacy UI. Record
    // submission time for both timestamps and an honest zero duration rather
    // than accepting a caller-forged elapsed time.
    const submittedAt = new Date().toISOString();
    const created = await entities.ScenarioAttempt.create({
      scenario_id: payload.scenarioId,
      user_id: ownerEmail,
      assignment_id: payload.assignmentId,
      started_at: submittedAt,
      completed_at: submittedAt,
      decisions_made_json: grade.canonicalDecisions,
      correct_decisions: grade.correctDecisions,
      total_decisions: grade.totalDecisions,
      score_percentage: grade.scorePercentage,
      passed: grade.passed,
      attempt_number: ownPrior.length + 1,
      time_spent_minutes: 0,
    });
    if (!created?.id) throw new Error('ScenarioAttempt.create returned no id');

    return Response.json({
      attempt_id: created.id,
      attempt_number: ownPrior.length + 1,
      score_percentage: grade.scorePercentage,
      passing_score: grade.passingScore,
      passed: grade.passed,
      correct_decisions: grade.correctDecisions,
      total_decisions: grade.totalDecisions,
    });
  } catch (error) {
    if (error instanceof PublicError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    console.error('submitScenarioAttempt failed:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
});
