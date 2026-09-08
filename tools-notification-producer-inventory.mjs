import { readdir, readFile } from 'node:fs/promises';
import { extname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const NOTIFICATION_SOURCE_EXTENSIONS = Object.freeze([
  '.cjs',
  '.cts',
  '.js',
  '.jsx',
  '.mjs',
  '.mts',
  '.ts',
  '.tsx',
]);

export const PRODUCER_CLASSIFICATIONS = Object.freeze({
  AUTHORITY_V1: 'authority-v1',
  EXPLICITLY_QUARANTINED: 'explicitly-quarantined',
  SOURCE_DISABLED: 'source-disabled',
  RUNTIME_GATED: 'runtime-gated',
  LEGACY_UNMIGRATED: 'legacy-unmigrated',
  UNCLASSIFIED: 'unclassified',
});

export const PRODUCER_EXECUTION_STATES = Object.freeze({
  REACHABLE_OR_UNKNOWN: 'reachable-or-unknown',
  EXPLICITLY_QUARANTINED: 'explicitly-quarantined',
  SOURCE_DISABLED: 'source-disabled',
  RUNTIME_GATED: 'runtime-gated',
});

export const PRODUCER_AUTHORITY_STATES = Object.freeze({
  AUTHORITY_V1: 'authority-v1',
  LEGACY_UNMIGRATED: 'legacy-unmigrated',
});

const SOURCE_EXTENSION_SET = new Set(NOTIFICATION_SOURCE_EXTENSIONS);
const EXCLUDED_DIRECTORIES = new Set([
  '.git',
  'build',
  'coverage',
  'dist',
  'node_modules',
]);

function legacyClassification(execution) {
  if (execution === PRODUCER_EXECUTION_STATES.EXPLICITLY_QUARANTINED) {
    return PRODUCER_CLASSIFICATIONS.EXPLICITLY_QUARANTINED;
  }
  if (execution === PRODUCER_EXECUTION_STATES.SOURCE_DISABLED) {
    return PRODUCER_CLASSIFICATIONS.SOURCE_DISABLED;
  }
  if (execution === PRODUCER_EXECUTION_STATES.RUNTIME_GATED) {
    return PRODUCER_CLASSIFICATIONS.RUNTIME_GATED;
  }
  return PRODUCER_CLASSIFICATIONS.LEGACY_UNMIGRATED;
}

const legacy = (
  method = 'create',
  execution = PRODUCER_EXECUTION_STATES.REACHABLE_OR_UNKNOWN,
  operational = {},
) => Object.freeze({
  method,
  authority: PRODUCER_AUTHORITY_STATES.LEGACY_UNMIGRATED,
  execution,
  classification: legacyClassification(execution),
  workflow_schedule: operational.workflowSchedule || null,
  browser_reachable: operational.browserReachable === true,
});

const authorityV1 = (
  evidence,
  execution = PRODUCER_EXECUTION_STATES.REACHABLE_OR_UNKNOWN,
  method = 'create',
) => Object.freeze({
  method,
  authority: PRODUCER_AUTHORITY_STATES.AUTHORITY_V1,
  execution,
  classification: PRODUCER_CLASSIFICATIONS.AUTHORITY_V1,
  evidence: Object.freeze(evidence),
  workflow_schedule: null,
  browser_reachable: false,
});

const scheduleQuarantinedLegacy = (
  method = 'create',
  browserReachable = false,
) => legacy(method, PRODUCER_EXECUTION_STATES.REACHABLE_OR_UNKNOWN, {
  workflowSchedule: 'quarantined',
  browserReachable,
});

/**
 * This registry is deliberately per call site, in source order. A function can
 * contain both authority-v1 and legacy producers; classifying only by filename
 * would hide those mixed files. A newly added, removed, method-changed, or
 * otherwise unclassified Notification create/bulkCreate call fails the
 * inventory contract until it is reviewed here. Source-order ordinals pair
 * known calls with this registry; they are not a semantic fingerprint for
 * legacy payload bodies, so review the source diff as well.
 *
 * Authority and execution are separate facts. Legacy-unmigrated producers are
 * not assumed to be quarantined. Their rows lack authority-v1 provenance and
 * are excluded by the deny-all Notification RLS plus manageMyNotifications,
 * even when a service-role write remains reachable. They must not be backfilled
 * merely from mutable email/title/message data.
 */
export const EXPECTED_NOTIFICATION_PRODUCERS = Object.freeze({
  'assignInService/entry.ts': Object.freeze([legacy()]),
  'awardBadgeOnCompletion/entry.ts': Object.freeze([legacy()]),
  'cancelTimeOffRequest/entry.ts': Object.freeze([legacy()]),
  'checkAdrDeadlines/entry.ts': Object.freeze([legacy()]),
  'checkStaleFollowUpRequests/entry.ts': Object.freeze([
    authorityV1(
      {
        kind: 'factory-binding',
        name: 'expectedNotification',
        argumentPath: ['notification'],
        payloadPath: [],
      },
      PRODUCER_EXECUTION_STATES.RUNTIME_GATED,
    ),
  ]),
  'createNotification/entry.ts': Object.freeze([
    authorityV1({ kind: 'call-argument' }),
  ]),
  'distributePolicyAcknowledgment/entry.ts': Object.freeze([legacy()]),
  'gradeTrainingAttempt/entry.ts': Object.freeze([legacy(), legacy()]),
  'handleTelnyxStatusWebhook/entry.ts': Object.freeze([
    legacy(),
    legacy('create', PRODUCER_EXECUTION_STATES.RUNTIME_GATED),
    legacy('create', PRODUCER_EXECUTION_STATES.RUNTIME_GATED),
    authorityV1({
      kind: 'factory-binding',
      name: 'outboundFaxNotificationSpec',
      argumentPath: ['spec', 'payload'],
      payloadPath: ['payload'],
    }),
    legacy('create', PRODUCER_EXECUTION_STATES.RUNTIME_GATED),
  ]),
  'monitorClinicalDataForCarePlanUpdates/entry.ts': Object.freeze([
    legacy('create', PRODUCER_EXECUTION_STATES.SOURCE_DISABLED),
  ]),
  'pollFaxStatuses/entry.ts': Object.freeze([
    authorityV1(
      {
        kind: 'factory-binding',
        name: 'faxNotificationSpec',
        argumentPath: ['spec', 'payload'],
        payloadPath: ['payload'],
      },
      PRODUCER_EXECUTION_STATES.RUNTIME_GATED,
    ),
  ]),
  'processAnnualEducationRenewals/entry.ts': Object.freeze([
    scheduleQuarantinedLegacy(),
  ]),
  'processCompletedVisit/entry.ts': Object.freeze([
    legacy('create', PRODUCER_EXECUTION_STATES.SOURCE_DISABLED),
  ]),
  'processInboundFaxes/entry.ts': Object.freeze([
    authorityV1(
      {
        kind: 'factory-binding',
        name: 'faxNotification',
        argumentPath: ['expected'],
        payloadPath: [],
      },
      PRODUCER_EXECUTION_STATES.RUNTIME_GATED,
    ),
  ]),
  'processTrainingRenewals/entry.ts': Object.freeze([
    scheduleQuarantinedLegacy(),
  ]),
  'remindPlanOverdueStaff/entry.ts': Object.freeze([legacy()]),
  'reviewTimeOffRequest/entry.ts': Object.freeze([legacy()]),
  'reviewTimesheet/entry.ts': Object.freeze([legacy()]),
  'sendExpirationNotifications/entry.ts': Object.freeze([
    scheduleQuarantinedLegacy('create', true),
    scheduleQuarantinedLegacy('create', true),
    scheduleQuarantinedLegacy('create', true),
  ]),
  'sendFaxStatusNotification/entry.ts': Object.freeze([
    scheduleQuarantinedLegacy(),
  ]),
  'sendPersonnelExpirationNotifications/entry.ts': Object.freeze([
    scheduleQuarantinedLegacy('bulkCreate', true),
  ]),
  'sendRenewalReminders/entry.ts': Object.freeze([legacy()]),
  'sendTrainingNotifications/entry.ts': Object.freeze([
    scheduleQuarantinedLegacy('create', true),
    scheduleQuarantinedLegacy('create', true),
    scheduleQuarantinedLegacy('create', true),
  ]),
  'submitFollowUpResponse/entry.ts': Object.freeze([
    authorityV1({
      kind: 'factory-binding',
      name: 'notificationPayload',
      argumentPath: ['expected'],
      payloadPath: [],
    }),
  ]),
  'submitIncidentReport/entry.ts': Object.freeze([legacy()]),
  'submitStateReportableIncident/entry.ts': Object.freeze([legacy()]),
  'submitTimeOffRequest/entry.ts': Object.freeze([legacy()]),
  'submitTimesheet/entry.ts': Object.freeze([legacy()]),
  'syncFaxStatuses/entry.ts': Object.freeze([legacy()]),
  'triggerCorrectiveActionPlan/entry.ts': Object.freeze([
    scheduleQuarantinedLegacy(),
    scheduleQuarantinedLegacy(),
  ]),
});

function isIdentifierStart(character) {
  return /[A-Za-z_$]/.test(character);
}

function isIdentifierPart(character) {
  return /[A-Za-z0-9_$]/.test(character);
}

function decodeQuotedValue(raw) {
  if (raw[0] === '"') {
    try {
      return JSON.parse(raw);
    } catch {
      return raw.slice(1, -1);
    }
  }
  let output = '';
  for (let index = 1; index < raw.length - 1; index += 1) {
    if (raw[index] === '\\' && index + 1 < raw.length - 1) index += 1;
    output += raw[index];
  }
  return output;
}

/**
 * Minimal syntax lexer used only to locate entity method calls. It ignores
 * comments and literal contents so examples in prose cannot enter the census.
 */
export function lexNotificationSource(source) {
  const tokens = [];
  const templateExpressions = [];
  let index = 0;
  let line = 1;
  let column = 1;

  const advance = () => {
    const character = source[index];
    index += 1;
    if (character === '\n') {
      line += 1;
      column = 1;
    } else {
      column += 1;
    }
    return character;
  };

  const skipQuoted = (quote) => {
    advance();
    while (index < source.length) {
      const current = advance();
      if (current === '\\' && index < source.length) advance();
      else if (current === quote) return;
    }
  };

  const skipLineComment = () => {
    advance();
    advance();
    while (index < source.length && source[index] !== '\n') advance();
  };

  const skipBlockComment = () => {
    advance();
    advance();
    while (index < source.length) {
      if (source[index] === '*' && source[index + 1] === '/') {
        advance();
        advance();
        return;
      }
      advance();
    }
  };

  const skipTemplate = (captureExpressions = true) => {
    advance();
    while (index < source.length) {
      if (source[index] === '\\') {
        advance();
        if (index < source.length) advance();
        continue;
      }
      if (source[index] === '`') {
        advance();
        return;
      }
      if (source[index] === '$' && source[index + 1] === '{') {
        advance();
        advance();
        const expressionStart = index;
        const expressionLine = line;
        const expressionColumn = column;
        let expressionEnd = index;
        let braceDepth = 1;
        while (index < source.length && braceDepth > 0) {
          if (source[index] === '"' || source[index] === "'") {
            skipQuoted(source[index]);
          } else if (source[index] === '`') {
            skipTemplate(false);
          } else if (source[index] === '/' && source[index + 1] === '/') {
            skipLineComment();
          } else if (source[index] === '/' && source[index + 1] === '*') {
            skipBlockComment();
          } else {
            if (source[index] === '{') braceDepth += 1;
            else if (source[index] === '}') {
              braceDepth -= 1;
              if (braceDepth === 0) expressionEnd = index;
            }
            advance();
          }
        }
        if (captureExpressions) {
          templateExpressions.push({
            source: source.slice(expressionStart, expressionEnd),
            start: expressionStart,
            line: expressionLine,
            column: expressionColumn,
          });
        }
        continue;
      }
      advance();
    }
  };

  while (index < source.length) {
    const character = source[index];
    if (/\s/.test(character)) {
      advance();
      continue;
    }
    if (character === '/' && source[index + 1] === '/') {
      skipLineComment();
      continue;
    }
    if (character === '/' && source[index + 1] === '*') {
      skipBlockComment();
      continue;
    }

    if (character === '/') {
      const previous = tokens.at(-1);
      const expressionPrefix = !previous
        || previous.type === 'punctuator' && (
          '([{:;,=!?&|'.includes(previous.value) || previous.value === '=>'
        )
        || previous.type === 'identifier' && ['case', 'return', 'throw', 'typeof', 'void'].includes(previous.value);
      if (expressionPrefix) {
        const start = index;
        const startLine = line;
        const startColumn = column;
        let escaped = false;
        let inCharacterClass = false;
        advance();
        while (index < source.length) {
          const current = advance();
          if (!escaped && current === '[') inCharacterClass = true;
          else if (!escaped && current === ']') inCharacterClass = false;
          else if (!escaped && current === '/' && !inCharacterClass) break;
          escaped = !escaped && current === '\\';
          if (current !== '\\') escaped = false;
        }
        while (index < source.length && /[A-Za-z]/.test(source[index])) advance();
        tokens.push({ type: 'regex', value: '', start, end: index, line: startLine, column: startColumn });
        continue;
      }
    }

    const start = index;
    const startLine = line;
    const startColumn = column;
    if (isIdentifierStart(character)) {
      let value = advance();
      while (index < source.length && isIdentifierPart(source[index])) value += advance();
      tokens.push({ type: 'identifier', value, start, end: index, line: startLine, column: startColumn });
      continue;
    }
    if (/[0-9]/.test(character)) {
      let value = advance();
      while (index < source.length && /[0-9._A-Fa-fXx]/.test(source[index])) value += advance();
      tokens.push({ type: 'number', value, start, end: index, line: startLine, column: startColumn });
      continue;
    }
    if (character === '"' || character === "'") {
      const quote = character;
      let raw = advance();
      while (index < source.length) {
        const current = advance();
        raw += current;
        if (current === '\\' && index < source.length) raw += advance();
        else if (current === quote) break;
      }
      tokens.push({
        type: 'string',
        value: decodeQuotedValue(raw),
        start,
        end: index,
        line: startLine,
        column: startColumn,
      });
      continue;
    }
    if (character === '`') {
      // Raw template text is opaque, but ${...} is executable and is lexed
      // recursively below so a producer cannot hide in an interpolation.
      skipTemplate();
      tokens.push({ type: 'template', value: '', start, end: index, line: startLine, column: startColumn });
      continue;
    }
    if (source.slice(index, index + 2) === '=>') {
      advance();
      advance();
      tokens.push({
        type: 'punctuator',
        value: '=>',
        start,
        end: index,
        line: startLine,
        column: startColumn,
      });
      continue;
    }
    advance();
    tokens.push({
      type: 'punctuator',
      value: character,
      start,
      end: index,
      line: startLine,
      column: startColumn,
    });
  }
  for (const expression of templateExpressions) {
    const nestedTokens = lexNotificationSource(expression.source);
    for (const token of nestedTokens) {
      tokens.push({
        ...token,
        start: token.start + expression.start,
        end: token.end + expression.start,
        line: expression.line + token.line - 1,
        column: token.line === 1
          ? expression.column + token.column - 1
          : token.column,
      });
    }
  }
  return tokens.sort((left, right) => left.start - right.start || left.end - right.end);
}

function propertyAfter(tokens, index) {
  let cursor = index;
  if (tokens[cursor]?.value === '?.') cursor += 1;
  if (tokens[cursor]?.value === '?') cursor += 1;
  if (tokens[cursor]?.value === '.') {
    const property = tokens[cursor + 1];
    if (property?.type === 'identifier') return { value: property.value, end: cursor + 2 };
    return null;
  }
  if (tokens[cursor]?.value === '[') {
    const property = tokens[cursor + 1];
    if ((property?.type === 'identifier' || property?.type === 'string')
      && tokens[cursor + 2]?.value === ']') {
      return { value: property.value, end: cursor + 3 };
    }
  }
  return null;
}

function matchingToken(tokens, openingIndex, opening, closing) {
  let depth = 0;
  for (let index = openingIndex; index < tokens.length; index += 1) {
    if (tokens[index].value === opening) depth += 1;
    else if (tokens[index].value === closing) {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function accessPathAt(tokens, start) {
  const first = tokens[start];
  if (!first || !['identifier', 'string'].includes(first.type)) return null;
  const segments = [first.value];
  let cursor = start + 1;
  while (cursor < tokens.length) {
    const property = propertyAfter(tokens, cursor);
    if (!property) break;
    segments.push(property.value);
    cursor = property.end;
  }
  return { segments, end: cursor };
}

function pathIsCompleteAssignmentRhs(tokens, path) {
  const next = tokens[path.end];
  if (!next || [';', ',', ')'].includes(next.value)) return true;
  return next.line > tokens[path.end - 1].line;
}

function simpleAssignmentAt(tokens, index) {
  const candidate = tokens[index];
  if (candidate?.type !== 'identifier' || tokens[index + 1]?.value !== '=') return null;
  if (['.', '?.', '['].includes(tokens[index - 1]?.value)) return null;
  const path = accessPathAt(tokens, index + 2);
  if (!path || !pathIsCompleteAssignmentRhs(tokens, path)) return null;
  return { name: candidate.value, path };
}

function isEntityContainerPath(segments, containerAliases) {
  return segments.at(-1) === 'entities'
    || (segments.length === 1 && containerAliases.has(segments[0]));
}

function isNotificationEntityPath(segments, containerAliases, entityAliases) {
  if (segments.length === 1 && entityAliases.has(segments[0])) return true;
  if (segments.at(-1) !== 'Notification') return false;
  const containerPath = segments.slice(0, -1);
  return containerPath.includes('entities')
    || (containerPath.length > 0 && containerAliases.has(containerPath.at(-1)));
}

function destructuredAlias(tokens, open, close, property) {
  for (let index = open + 1; index < close; index += 1) {
    if (tokens[index]?.value !== property) continue;
    if (tokens[index + 1]?.value === ':' && tokens[index + 2]?.type === 'identifier') {
      return tokens[index + 2].value;
    }
    if ([',', '}'].includes(tokens[index + 1]?.value)) return property;
  }
  return null;
}

function notificationAliases(tokens) {
  const containerAliases = new Set();
  const entityAliases = new Set();
  const methodAliases = new Map();
  const ambiguousMethodAliases = new Set();
  const addMethodAlias = (name, method) => {
    if (ambiguousMethodAliases.has(name)) return false;
    if (!methodAliases.has(name)) {
      methodAliases.set(name, method);
      return true;
    }
    if (methodAliases.get(name) === method) return false;
    methodAliases.delete(name);
    ambiguousMethodAliases.add(name);
    return true;
  };
  let changed = true;
  while (changed) {
    changed = false;
    for (let index = 0; index < tokens.length; index += 1) {
      const assignment = simpleAssignmentAt(tokens, index);
      if (assignment) {
        const { name, path } = assignment;
        if (isEntityContainerPath(path.segments, containerAliases)
          && !containerAliases.has(name)) {
          containerAliases.add(name);
          changed = true;
        }
        if (isNotificationEntityPath(path.segments, containerAliases, entityAliases)
          && !entityAliases.has(name)) {
          entityAliases.add(name);
          changed = true;
        }
        const method = path.segments.at(-1);
        const entityPath = path.segments.slice(0, -1);
        if (['create', 'bulkCreate'].includes(method)
          && isNotificationEntityPath(entityPath, containerAliases, entityAliases)
        ) changed = addMethodAlias(name, method) || changed;
        if (path.segments.length === 1 && methodAliases.has(path.segments[0])) {
          const chainedMethod = methodAliases.get(path.segments[0]);
          changed = addMethodAlias(name, chainedMethod) || changed;
        }
      }

      if (!['const', 'let', 'var'].includes(tokens[index]?.value)
        || tokens[index + 1]?.value !== '{') continue;
      const close = matchingToken(tokens, index + 1, '{', '}');
      if (close === -1 || tokens[close + 1]?.value !== '=') continue;
      const sourcePath = accessPathAt(tokens, close + 2);
      if (!sourcePath || !pathIsCompleteAssignmentRhs(tokens, sourcePath)) continue;
      if (isEntityContainerPath(sourcePath.segments, containerAliases)) {
        const alias = destructuredAlias(tokens, index + 1, close, 'Notification');
        if (alias && !entityAliases.has(alias)) {
          entityAliases.add(alias);
          changed = true;
        }
      }
      if (isNotificationEntityPath(sourcePath.segments, containerAliases, entityAliases)) {
        for (const method of ['create', 'bulkCreate']) {
          const alias = destructuredAlias(tokens, index + 1, close, method);
          if (alias) changed = addMethodAlias(alias, method) || changed;
        }
      }
    }
  }
  return { containerAliases, entityAliases, methodAliases };
}

function accessPathStartsAt(tokens, index) {
  return tokens[index]?.type === 'identifier'
    && !['.', '?.', '['].includes(tokens[index - 1]?.value);
}

export function findNotificationProducerCalls(source, file = '<memory>') {
  const tokens = lexNotificationSource(source);
  const { containerAliases, entityAliases, methodAliases } = notificationAliases(tokens);
  const calls = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const start = tokens[index];
    const aliasedMethod = start.type === 'identifier' ? methodAliases.get(start.value) : null;
    if (aliasedMethod && tokens[index + 1]?.value === '(') {
      const close = matchingToken(tokens, index + 1, '(', ')');
      calls.push({
        file,
        method: aliasedMethod,
        line: start.line,
        column: start.column,
        ordinal: calls.length + 1,
        argumentTokens: tokens.slice(index + 2, close === -1 ? tokens.length : close),
        sourceTokens: tokens,
        callTokenIndex: index,
      });
      continue;
    }
    if (!accessPathStartsAt(tokens, index)) continue;
    const path = accessPathAt(tokens, index);
    const method = path?.segments.at(-1);
    if (!path
      || !['create', 'bulkCreate'].includes(method)
      || !isNotificationEntityPath(
        path.segments.slice(0, -1),
        containerAliases,
        entityAliases,
      )
      || tokens[path.end]?.value !== '(') continue;
    const close = matchingToken(tokens, path.end, '(', ')');
    const argumentStart = path.end + 1;
    const argumentEnd = close === -1 ? tokens.length : close;
    calls.push({
      file,
      method,
      line: start.line,
      column: start.column,
      ordinal: calls.length + 1,
      argumentTokens: tokens.slice(argumentStart, argumentEnd),
      sourceTokens: tokens,
      callTokenIndex: index,
    });
  }
  return calls;
}

function productionSourceFile(name) {
  return SOURCE_EXTENSION_SET.has(extname(name))
    && !/\.(?:spec|test)\.[^.]+$/i.test(name);
}

export async function discoverNotificationSourceFiles(root) {
  const absoluteRoot = resolve(root);
  const files = [];
  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const child = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        if (!EXCLUDED_DIRECTORIES.has(entry.name)) await visit(child);
      } else if (entry.isFile() && productionSourceFile(entry.name)) {
        files.push(child);
      }
    }
  }
  await visit(absoluteRoot);
  return files.sort();
}

function portableRelative(root, path) {
  return relative(resolve(root), path).split(sep).join('/');
}

function functionTokens(tokens, name) {
  let found = null;
  for (let index = 0; index < tokens.length - 2; index += 1) {
    if (tokens[index].value !== 'function' || tokens[index + 1]?.value !== name) continue;
    let bodyStart = index + 2;
    while (bodyStart < tokens.length && tokens[bodyStart].value !== '{') bodyStart += 1;
    if (bodyStart >= tokens.length) return null;
    const bodyEnd = matchingToken(tokens, bodyStart, '{', '}');
    if (bodyEnd === -1) return null;
    if (found) return null;
    found = tokens.slice(bodyStart + 1, bodyEnd);
  }
  return found;
}

function topLevelObjectStructure(objectTokens) {
  if (objectTokens[0]?.value !== '{') return null;
  const objectEnd = matchingToken(objectTokens, 0, '{', '}');
  if (objectEnd === -1 || objectEnd !== objectTokens.length - 1) return null;
  const properties = new Map();
  const spreads = [];
  let braceDepth = 1;
  let bracketDepth = 0;
  let parenDepth = 0;
  for (let index = 1; index < objectEnd; index += 1) {
    const token = objectTokens[index];
    const atTopLevel = braceDepth === 1 && bracketDepth === 0 && parenDepth === 0;
    if (atTopLevel
      && token.value === '.'
      && objectTokens[index + 1]?.value === '.'
      && objectTokens[index + 2]?.value === '.') spreads.push(index);
    if (atTopLevel
      && (token.type === 'identifier' || token.type === 'string')
      && objectTokens[index + 1]?.value === ':') {
      const valueStart = index + 2;
      let nestedBrace = 0;
      let nestedBracket = 0;
      let nestedParen = 0;
      let valueEnd = valueStart;
      while (valueEnd < objectEnd) {
        const value = objectTokens[valueEnd].value;
        if (value === '{') nestedBrace += 1;
        else if (value === '}') {
          if (nestedBrace === 0 && nestedBracket === 0 && nestedParen === 0) break;
          nestedBrace -= 1;
        } else if (value === '[') nestedBracket += 1;
        else if (value === ']') nestedBracket -= 1;
        else if (value === '(') nestedParen += 1;
        else if (value === ')') nestedParen -= 1;
        else if (value === ',' && nestedBrace === 0 && nestedBracket === 0 && nestedParen === 0) break;
        valueEnd += 1;
      }
      const occurrence = {
        index,
        value: objectTokens.slice(valueStart, valueEnd),
      };
      const existing = properties.get(token.value);
      if (existing) existing.push(occurrence);
      else properties.set(token.value, [occurrence]);
    }
    if (token.value === '{') braceDepth += 1;
    else if (token.value === '}') braceDepth -= 1;
    else if (token.value === '[') bracketDepth += 1;
    else if (token.value === ']') bracketDepth -= 1;
    else if (token.value === '(') parenDepth += 1;
    else if (token.value === ')') parenDepth -= 1;
  }
  return { properties, spreads };
}

function topLevelPropertyOccurrences(objectTokens, key) {
  return topLevelObjectStructure(objectTokens)?.properties.get(key) || [];
}

function topLevelPropertyValue(objectTokens, key) {
  const occurrences = topLevelPropertyOccurrences(objectTokens, key);
  return occurrences.length === 1 ? occurrences[0].value : null;
}

function returnedObjectTokens(tokens, functionName, payloadPath) {
  let current = functionTokens(tokens, functionName);
  if (!current) return null;
  const returnIndexes = current.flatMap((token, index) => (
    token.value === 'return' ? [index] : []
  ));
  if (returnIndexes.length !== 1) return null;
  const [returnIndex] = returnIndexes;
  if (current[returnIndex + 1]?.value !== '{') return null;
  const objectEnd = matchingToken(current, returnIndex + 1, '{', '}');
  if (objectEnd === -1) return null;
  current = current.slice(returnIndex + 1, objectEnd + 1);
  for (const property of payloadPath || []) {
    const structure = topLevelObjectStructure(current);
    const occurrences = structure?.properties.get(property) || [];
    if (occurrences.length !== 1
      || structure.spreads.some((spreadIndex) => spreadIndex > occurrences[0].index)) return null;
    const value = occurrences[0].value;
    if (!value || value[0]?.value !== '{') return null;
    const nestedEnd = matchingToken(value, 0, '{', '}');
    if (nestedEnd === -1 || nestedEnd !== value.length - 1) return null;
    current = value;
  }
  return current;
}

function exactAccessPath(tokens) {
  const path = accessPathAt(tokens, 0);
  return path && path.end === tokens.length ? path.segments : null;
}

function samePath(left, right) {
  return Array.isArray(left)
    && Array.isArray(right)
    && left.length === right.length
    && left.every((segment, index) => segment === right[index]);
}

function enclosingFunctionRanges(tokens, targetIndex) {
  const ranges = [];
  for (let index = 0; index < targetIndex; index += 1) {
    let bodyStart = -1;
    if (tokens[index]?.value === 'function') {
      bodyStart = index + 1;
      while (bodyStart < tokens.length && tokens[bodyStart]?.value !== '{') bodyStart += 1;
    } else if (tokens[index]?.value === '=>' && tokens[index + 1]?.value === '{') {
      bodyStart = index + 1;
    }
    if (bodyStart === -1 || bodyStart >= tokens.length) continue;
    const bodyEnd = matchingToken(tokens, bodyStart, '{', '}');
    if (bodyEnd > targetIndex) ranges.push(`${bodyStart}:${bodyEnd}`);
  }
  return ranges;
}

function bindingSharesFunctionScope(tokens, bindingIndex, callIndex) {
  const bindingRanges = enclosingFunctionRanges(tokens, bindingIndex);
  const callRanges = enclosingFunctionRanges(tokens, callIndex);
  if (bindingRanges.length === 0 && callRanges.length === 0) return true;
  const bindingSet = new Set(bindingRanges);
  return callRanges.some((range) => bindingSet.has(range));
}

function bindingBlockContainsCall(tokens, bindingIndex, callIndex) {
  let nearest = null;
  for (let index = 0; index < bindingIndex; index += 1) {
    if (tokens[index]?.value !== '{') continue;
    const end = matchingToken(tokens, index, '{', '}');
    if (end > bindingIndex && (!nearest || index > nearest.start)) {
      nearest = { start: index, end };
    }
  }
  return !nearest || nearest.end > callIndex;
}

function bindingUsesFactory(call, evidence) {
  const argumentPath = exactAccessPath(call.argumentTokens);
  if (!samePath(argumentPath, evidence.argumentPath)) return false;
  const binding = evidence.argumentPath[0];
  let latestAssignment = null;
  for (let index = 0; index < call.callTokenIndex; index += 1) {
    if (call.sourceTokens[index]?.value === binding
      && call.sourceTokens[index + 1]?.value === '=') latestAssignment = index;
  }
  if (latestAssignment === null
    || !['const', 'let', 'var'].includes(call.sourceTokens[latestAssignment - 1]?.value)
    || !bindingSharesFunctionScope(call.sourceTokens, latestAssignment, call.callTokenIndex)
    || !bindingBlockContainsCall(call.sourceTokens, latestAssignment, call.callTokenIndex)
    || call.sourceTokens[latestAssignment + 2]?.value !== evidence.name
    || call.sourceTokens[latestAssignment + 3]?.value !== '(') return false;
  const factoryCallEnd = matchingToken(call.sourceTokens, latestAssignment + 3, '(', ')');
  if (factoryCallEnd === -1 || call.sourceTokens[factoryCallEnd + 1]?.value !== ';') return false;

  for (let index = factoryCallEnd + 2; index < call.callTokenIndex; index += 1) {
    if (call.sourceTokens[index]?.value !== binding || !accessPathStartsAt(call.sourceTokens, index)) {
      continue;
    }
    const path = accessPathAt(call.sourceTokens, index);
    if (!path || !pathsOverlapMutation(path.segments, evidence.argumentPath)) continue;
    const next = call.sourceTokens[path.end]?.value;
    const nextNext = call.sourceTokens[path.end + 1]?.value;
    const nextThird = call.sourceTokens[path.end + 2]?.value;
    if (next === '='
      || (['+', '-', '*', '/', '%', '&', '|', '^', '?'].includes(next) && nextNext === '=')
      || (['&', '|', '?', '*'].includes(next) && nextNext === next && nextThird === '=')
      || (['+', '-'].includes(next) && nextNext === next)
      || call.sourceTokens[index - 1]?.value === 'delete'
      || (path.segments.length > evidence.argumentPath.length && next === '(')) return false;
  }
  return true;
}

function pathsOverlapMutation(candidate, argumentPath) {
  if (candidate[0] !== argumentPath[0]) return false;
  const common = Math.min(candidate.length, argumentPath.length);
  return candidate.slice(0, common).every((segment, index) => segment === argumentPath[index]);
}

function objectHasTopLevelProperty(tokens, key) {
  return topLevelPropertyOccurrences(tokens, key).length === 1;
}

function objectHasTopLevelLiteral(tokens, key, type, value) {
  const propertyValue = topLevelPropertyValue(tokens, key);
  return propertyValue?.length === 1
    && propertyValue[0].type === type
    && propertyValue[0].value === value;
}

const REQUIRED_V1_AUTHORITY_KEYS = Object.freeze([
  'agency_id',
  'recipient_user_id',
  'recipient_membership_id',
  'recipient_membership_version',
  'user_email',
]);

export function verifyAuthorityV1Evidence(call, expected) {
  if (expected.classification !== PRODUCER_CLASSIFICATIONS.AUTHORITY_V1) {
    return { ok: true, reason: null };
  }
  const evidence = expected.evidence;
  let tokens = null;
  if (evidence?.kind === 'call-argument') {
    if (call.argumentTokens[0]?.value !== '{'
      || matchingToken(call.argumentTokens, 0, '{', '}') !== call.argumentTokens.length - 1) {
      return { ok: false, reason: 'authority_call_argument_not_object' };
    }
    tokens = call.argumentTokens;
  } else if (evidence?.kind === 'factory-binding') {
    if (!bindingUsesFactory(call, evidence)) {
      return { ok: false, reason: 'authority_factory_not_bound_to_call' };
    }
    tokens = returnedObjectTokens(call.sourceTokens, evidence.name, evidence.payloadPath);
  }
  if (!tokens) return { ok: false, reason: 'authority_evidence_not_found' };
  const structure = topLevelObjectStructure(tokens);
  if (!structure) return { ok: false, reason: 'authority_evidence_not_object' };
  if (structure.spreads.length > 0) {
    return { ok: false, reason: 'authority_object_spread' };
  }
  const authorityKeys = [
    ...REQUIRED_V1_AUTHORITY_KEYS,
    'authority_version',
    'authority_state',
    'version',
  ];
  if (authorityKeys.some((key) => (structure.properties.get(key) || []).length > 1)) {
    return { ok: false, reason: 'authority_fields_ambiguous' };
  }
  if (REQUIRED_V1_AUTHORITY_KEYS.some((key) => !objectHasTopLevelProperty(tokens, key))) {
    return { ok: false, reason: 'authority_fields_incomplete' };
  }
  if (!objectHasTopLevelLiteral(tokens, 'authority_version', 'number', '1')
    || !objectHasTopLevelLiteral(tokens, 'authority_state', 'string', 'active')
    || !objectHasTopLevelLiteral(tokens, 'version', 'number', '1')) {
    return { ok: false, reason: 'authority_literals_invalid' };
  }
  return { ok: true, reason: null };
}

export async function inventoryNotificationProducers(
  root,
  expectations = EXPECTED_NOTIFICATION_PRODUCERS,
) {
  const files = await discoverNotificationSourceFiles(root);
  const calls = [];
  for (const path of files) {
    const file = portableRelative(root, path);
    const source = await readFile(path, 'utf8');
    const found = findNotificationProducerCalls(source, file);
    for (const call of found) {
      const expected = expectations[file]?.[call.ordinal - 1] || null;
      const methodMatches = expected?.method === call.method;
      const evidence = methodMatches
        ? verifyAuthorityV1Evidence(call, expected)
        : { ok: false, reason: expected ? 'producer_method_changed' : 'producer_not_classified' };
      calls.push({
        file: call.file,
        line: call.line,
        column: call.column,
        ordinal: call.ordinal,
        method: call.method,
        authority: methodMatches ? expected.authority : null,
        execution: methodMatches ? expected.execution : null,
        workflow_schedule: methodMatches ? expected.workflow_schedule ?? null : null,
        browser_reachable: methodMatches ? expected.browser_reachable === true : false,
        classification: methodMatches
          ? expected.classification
          : PRODUCER_CLASSIFICATIONS.UNCLASSIFIED,
        evidence_ok: evidence.ok,
        evidence_reason: evidence.reason,
      });
    }
  }

  const missingExpected = [];
  for (const [file, entries] of Object.entries(expectations)) {
    const actual = calls.filter((call) => call.file === file);
    for (let index = actual.length; index < entries.length; index += 1) {
      missingExpected.push({ file, ordinal: index + 1, method: entries[index].method });
    }
  }

  const summary = {
    files_scanned: files.length,
    producer_files: new Set(calls.map((call) => call.file)).size,
    call_sites: calls.length,
    authority_v1: calls.filter((call) => (
      call.authority === PRODUCER_AUTHORITY_STATES.AUTHORITY_V1
    )).length,
    legacy_unmigrated: calls.filter((call) => (
      call.authority === PRODUCER_AUTHORITY_STATES.LEGACY_UNMIGRATED
    )).length,
    explicitly_quarantined: calls.filter((call) => (
      call.classification === PRODUCER_CLASSIFICATIONS.EXPLICITLY_QUARANTINED
    )).length,
    workflow_schedule_quarantined: calls.filter((call) => (
      call.workflow_schedule === 'quarantined'
    )).length,
    browser_reachable_legacy_unmigrated: calls.filter((call) => (
      call.authority === PRODUCER_AUTHORITY_STATES.LEGACY_UNMIGRATED
      && call.browser_reachable
    )).length,
    source_disabled: calls.filter((call) => (
      call.classification === PRODUCER_CLASSIFICATIONS.SOURCE_DISABLED
    )).length,
    runtime_gated: calls.filter((call) => (
      call.execution === PRODUCER_EXECUTION_STATES.RUNTIME_GATED
    )).length,
    runtime_gated_authority_v1: calls.filter((call) => (
      call.authority === PRODUCER_AUTHORITY_STATES.AUTHORITY_V1
      && call.execution === PRODUCER_EXECUTION_STATES.RUNTIME_GATED
    )).length,
    runtime_gated_legacy_unmigrated: calls.filter((call) => (
      call.authority === PRODUCER_AUTHORITY_STATES.LEGACY_UNMIGRATED
      && call.execution === PRODUCER_EXECUTION_STATES.RUNTIME_GATED
    )).length,
    reachable_legacy_unmigrated: calls.filter((call) => (
      call.authority === PRODUCER_AUTHORITY_STATES.LEGACY_UNMIGRATED
      && call.execution === PRODUCER_EXECUTION_STATES.REACHABLE_OR_UNKNOWN
    )).length,
    unclassified: calls.filter((call) => (
      call.classification === PRODUCER_CLASSIFICATIONS.UNCLASSIFIED
    )).length,
    invalid_authority_evidence: calls.filter((call) => !call.evidence_ok).length,
    missing_expected: missingExpected.length,
  };
  return { mode: 'read-only-source-inventory', summary, calls, missing_expected: missingExpected };
}

function publicInventoryResult(result) {
  return {
    mode: result.mode,
    summary: result.summary,
    call_sites: result.calls.map((call) => ({
      file: call.file,
      line: call.line,
      ordinal: call.ordinal,
      method: call.method,
      authority: call.authority,
      execution: call.execution,
      workflow_schedule: call.workflow_schedule,
      browser_reachable: call.browser_reachable,
      classification: call.classification,
      evidence_ok: call.evidence_ok,
      ...(call.evidence_reason ? { evidence_reason: call.evidence_reason } : {}),
    })),
    missing_expected: result.missing_expected,
  };
}

async function main() {
  const rawArgs = process.argv.slice(2);
  const args = rawArgs[0] === '--' ? rawArgs.slice(1) : rawArgs;
  if (args.length > 1 || (args[0] && args[0] !== '--summary')) {
    process.stderr.write('Usage: node tools-notification-producer-inventory.mjs [--summary]\n');
    process.exitCode = 64;
    return;
  }
  const repositoryRoot = fileURLToPath(new URL('.', import.meta.url));
  const result = await inventoryNotificationProducers(resolve(repositoryRoot, 'base44/functions'));
  const output = args[0] === '--summary' ? { mode: result.mode, summary: result.summary } : publicInventoryResult(result);
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  if (result.summary.unclassified
    || result.summary.invalid_authority_evidence
    || result.summary.missing_expected) process.exitCode = 1;
}

if (resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) {
  await main();
}
