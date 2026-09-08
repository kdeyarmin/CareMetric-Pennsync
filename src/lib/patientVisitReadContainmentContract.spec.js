import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import JSON5 from 'json5';
import { describe, expect, it } from 'vitest';
import { lexNotificationSource as lexSource } from '../../tools-notification-producer-inventory.mjs';

const ROOT = process.cwd();
const SRC = path.join(ROOT, 'src');
const HOSTED_FUNCTIONS = path.join(ROOT, 'base44/functions');
const MODULE_EXTENSION = /\.(?:cjs|cts|js|jsx|mjs|mts|ts|tsx)$/;
const TEST_MODULE = /\.(?:spec|test)\.(?:cjs|cts|js|jsx|mjs|mts|ts|tsx)$/;
const READ_METHODS = new Set(['filter', 'get', 'list', 'subscribe']);
const SENSITIVE_ENTITIES = new Set(['Patient', 'Visit']);

function productionModules(directory, output = []) {
  for (const entry of readdirSync(directory)) {
    const absolute = path.join(directory, entry);
    if (statSync(absolute).isDirectory()) {
      productionModules(absolute, output);
    } else if (MODULE_EXTENSION.test(entry) && !TEST_MODULE.test(entry)) {
      output.push(absolute);
    }
  }
  return output;
}

function scanDirectPatientVisitReads(fileName, sourceText) {
  const tokens = lexSource(sourceText);
  const aliases = new Map();
  const clientAliases = new Set();
  const constants = new Map();
  const ambiguousConstants = new Set();
  const factoryNames = new Set();
  const sdkNamespaces = new Set();
  const importRanges = [];
  const localFunctions = new Set();

  function matching(openIndex, opening, closing) {
    let depth = 0;
    for (let index = openIndex; index < tokens.length; index += 1) {
      if (tokens[index].value === opening) depth += 1;
      else if (tokens[index].value === closing && --depth === 0) return index;
    }
    return -1;
  }

  function staticString(start, end) {
    let value = '';
    let expectValue = true;
    for (let index = start; index < end; index += 1) {
      const token = tokens[index];
      if (expectValue) {
        const part = token.type === 'string'
          ? decodeStaticStringToken(token)
          : token.type === 'identifier' ? constants.get(token.value) : null;
        if (part === null || part === undefined) return null;
        value += part;
      } else if (token.value !== '+') return null;
      expectValue = !expectValue;
    }
    return expectValue ? null : value;
  }

  function decodeStaticStringToken(token) {
    const raw = sourceText.slice(token.start, token.end);
    if (raw[0] === '"') {
      try { return JSON.parse(raw); } catch { return token.value; }
    }
    if (raw[0] !== "'") return token.value;
    return raw.slice(1, -1).replace(
      /\\u\{([0-9a-fA-F]+)\}|\\u([0-9a-fA-F]{4})|\\x([0-9a-fA-F]{2})|\\([\\'"bfnrtv0])/g,
      (_match, codePoint, unicode, hex, escaped) => {
        if (codePoint) return String.fromCodePoint(Number.parseInt(codePoint, 16));
        if (unicode) return String.fromCharCode(Number.parseInt(unicode, 16));
        if (hex) return String.fromCharCode(Number.parseInt(hex, 16));
        return ({ b: '\b', f: '\f', n: '\n', r: '\r', t: '\t', v: '\v', 0: '\0' })[escaped]
          ?? escaped;
      },
    );
  }

  function importLocal(importStart, fromIndex, imported) {
    for (let index = importStart + 1; index < fromIndex; index += 1) {
      if (tokens[index].value !== imported) continue;
      if (tokens[index + 1]?.value === 'as' && tokens[index + 2]?.type === 'identifier') {
        return tokens[index + 2].value;
      }
      return imported;
    }
    return null;
  }

  for (let index = 0; index < tokens.length; index += 1) {
    if (
      tokens[index]?.value === 'function'
      && tokens[index + 1]?.type === 'identifier'
      && tokens[index + 2]?.value === '('
    ) localFunctions.add(tokens[index + 1].value);
    if (
      tokens[index]?.type === 'identifier'
      && tokens[index + 1]?.value === '='
      && (tokens[index + 2]?.value === '(' || tokens[index + 2]?.type === 'identifier')
    ) {
      let cursor = index + 2;
      let depth = 0;
      while (cursor < tokens.length) {
        if (['(', '[', '{'].includes(tokens[cursor].value)) depth += 1;
        else if ([')', ']', '}'].includes(tokens[cursor].value)) depth -= 1;
        if (tokens[cursor].value === '=>') {
          localFunctions.add(tokens[index].value);
          break;
        }
        if (depth === 0 && tokens[cursor].value === ';') break;
        cursor += 1;
      }
    }
  }

  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index].value !== 'import') continue;
    let from = index + 1;
    while (from < tokens.length && tokens[from].value !== 'from' && tokens[from].value !== ';') from += 1;
    if (tokens[from]?.value !== 'from' || tokens[from + 1]?.type !== 'string') continue;
    importRanges.push([index, from + 1]);
    const moduleName = tokens[from + 1].value;
    if (/(?:^|\/)base44Client(?:\.[cm]?[jt]sx?)?$/.test(moduleName)) {
      const named = importLocal(index, from, 'base44');
      if (named) {
        aliases.set(named, ['base44']);
        clientAliases.add(named);
      }
      if (tokens[index + 1]?.value === '*' && tokens[index + 2]?.value === 'as') {
        aliases.set(tokens[index + 3].value, ['base44Module']);
      } else if (tokens[index + 1]?.type === 'identifier' && tokens[index + 2]?.value !== ',') {
        aliases.set(tokens[index + 1].value, ['base44']);
        clientAliases.add(tokens[index + 1].value);
      }
    }
    if (moduleName.includes('@base44/sdk')) {
      if (tokens[index + 1]?.value === '*' && tokens[index + 2]?.value === 'as') {
        sdkNamespaces.add(tokens[index + 3]?.value);
      }
      for (const imported of ['createClient', 'createClientFromRequest']) {
        const factory = importLocal(index, from, imported);
        if (factory) factoryNames.add(factory);
      }
    }
  }

  // CommonJS is uncommon in production here, but treating an SDK namespace
  // obtained via require() as opaque would create an avoidable bypass.
  for (let index = 0; index < tokens.length; index += 1) {
    if (
      tokens[index]?.type === 'identifier'
      && tokens[index + 1]?.value === '='
      && tokens[index + 2]?.value === 'require'
      && tokens[index + 3]?.value === '('
      && tokens[index + 4]?.type === 'string'
      && tokens[index + 4].value.includes('@base44/sdk')
      && tokens[index + 5]?.value === ')'
    ) sdkNamespaces.add(tokens[index].value);
    if (tokens[index]?.value === '{') {
      const close = matching(index, '{', '}');
      if (
        close !== -1
        && tokens[close + 1]?.value === '='
        && tokens[close + 2]?.value === 'require'
        && tokens[close + 3]?.value === '('
        && tokens[close + 4]?.type === 'string'
        && tokens[close + 4].value.includes('@base44/sdk')
        && tokens[close + 5]?.value === ')'
      ) {
        let cursor = index + 1;
        while (cursor < close) {
          const imported = tokens[cursor]?.value;
          if (['createClient', 'createClientFromRequest'].includes(imported)) {
            const local = tokens[cursor + 1]?.value === ':'
              ? tokens[cursor + 2]?.value
              : imported;
            if (typeof local === 'string') factoryNames.add(local);
          }
          cursor += 1;
        }
      }
    }
  }

  function pathAt(start) {
    const first = tokens[start];
    let segments = null;
    let cursor = start + 1;
    if (first?.value === '(') {
      const close = matching(start, '(', ')');
      if (close === -1) return null;
      const inner = pathAt(start + 1);
      let innerEnd = inner?.end ?? -1;
      while (tokens[innerEnd]?.value === '!') innerEnd += 1;
      if (!inner || innerEnd !== close) return null;
      segments = inner.segments;
      cursor = close + 1;
    } else if (
      first?.value === 'Reflect'
      && tokens[start + 1]?.value === '.'
      && tokens[start + 2]?.value === 'get'
      && tokens[start + 3]?.value === '('
    ) {
      const close = matching(start + 3, '(', ')');
      const owner = pathAt(start + 4);
      if (close === -1 || !owner || tokens[owner.end]?.value !== ',') return null;
      const property = staticString(owner.end + 1, close) ?? '*';
      segments = [...owner.segments, property];
      cursor = close + 1;
    } else if (
      first?.value === 'require'
      && tokens[start + 1]?.value === '('
      && tokens[start + 2]?.type === 'string'
      && tokens[start + 2].value.includes('@base44/sdk')
      && tokens[start + 3]?.value === ')'
    ) {
      segments = ['sdkNamespace'];
      cursor = start + 4;
    } else {
      if (first?.type !== 'identifier') return null;
      segments = aliases.get(first.value)
        ?? (clientAliases.has(first.value) ? ['clientDerived'] : null)
        ?? (sdkNamespaces.has(first.value) ? ['sdkNamespace'] : null);
      if (segments?.join('.') === 'base44Module.base44') segments = ['base44'];
    }
    if (
      ((first?.type === 'identifier' && sdkNamespaces.has(first.value))
        || segments?.[0] === 'sdkNamespace')
      && segments?.length === 2
      && ['createClient', 'createClientFromRequest'].includes(segments[1])
      && tokens[cursor]?.value === '('
    ) {
      const close = matching(cursor, '(', ')');
      if (close === -1) return null;
      segments = ['base44'];
      cursor = close + 1;
    } else if (
      ((first?.type === 'identifier' && sdkNamespaces.has(first.value))
        || segments?.[0] === 'sdkNamespace')
      && tokens[cursor]?.value === '.'
      && ['createClient', 'createClientFromRequest'].includes(tokens[cursor + 1]?.value)
      && tokens[cursor + 2]?.value === '('
    ) {
      const close = matching(cursor + 2, '(', ')');
      if (close === -1) return null;
      segments = ['base44'];
      cursor = close + 1;
    }
    if (first?.type === 'identifier' && factoryNames.has(first.value) && tokens[cursor]?.value === '(') {
      const close = matching(cursor, '(', ')');
      if (close === -1) return null;
      segments = ['base44'];
      cursor = close + 1;
    }
    if (!segments) return null;
    while (cursor < tokens.length) {
      while (tokens[cursor]?.value === '!') cursor += 1;
      if (tokens[cursor]?.value === '?') {
        cursor += 1;
        if (tokens[cursor]?.value === '.' && tokens[cursor + 1]?.value === '[') cursor += 1;
      }
      if (tokens[cursor]?.value === '.') {
        const property = tokens[cursor + 1];
        if (property?.type !== 'identifier') break;
        if (segments.length === 1 && segments[0] === 'base44Module' && property.value === 'base44') {
          segments = ['base44'];
        } else segments = [...segments, property.value];
        cursor += 2;
        continue;
      }
      if (tokens[cursor]?.value === '[') {
        const close = matching(cursor, '[', ']');
        if (close === -1) break;
        segments = [...segments, staticString(cursor + 1, close) ?? '*'];
        cursor = close + 1;
        continue;
      }
      break;
    }
    return { segments, end: cursor };
  }

  function bind(name, pathValue) {
    if (!name || !pathValue) return false;
    const existing = aliases.get(name);
    if (existing?.join('.') === pathValue.join('.')) return false;
    if (existing) {
      if (existing.join('.') === 'base44.entities.*.*') return false;
      // Multiple incompatible SDK provenance paths for one alias are not
      // resolved by last-write-wins. Collapse them to a fail-closed dynamic
      // Patient/Visit read candidate so the fixed point stays monotonic.
      aliases.set(name, ['base44', 'entities', '*', '*']);
      return true;
    }
    aliases.set(name, pathValue);
    return true;
  }

  function isUnknownCallArgument(index) {
    let depth = 0;
    for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
      const value = tokens[cursor]?.value;
      if ([')', ']', '}'].includes(value)) depth += 1;
      else if (['(', '[', '{'].includes(value)) {
        if (depth > 0) {
          depth -= 1;
          continue;
        }
        if (value !== '(') return false;
        const callee = tokens[cursor - 1];
        const close = matching(cursor, '(', ')');
        if (close !== -1 && tokens[close + 1]?.value === '=>') return false;
        if (
          callee?.type !== 'identifier'
          || localFunctions.has(callee.value)
          || ['if', 'for', 'while', 'switch', 'catch', 'with'].includes(callee.value)
          || /(?:wrap|lock|guard).*(?:client|sdk|base44)|(?:client|sdk|base44).*(?:wrap|lock|guard)/i.test(callee.value)
        ) return false;
        return true;
      } else if (depth === 0 && value === ';') return false;
    }
    return false;
  }

  function bindPattern(open, close, sourcePath) {
    let changedPattern = false;
    let index = open + 1;
    while (index < close) {
      if (
        tokens[index]?.value === '.'
        && tokens[index + 1]?.value === '.'
        && tokens[index + 2]?.value === '.'
        && tokens[index + 3]?.type === 'identifier'
      ) {
        changedPattern = bind(tokens[index + 3].value, sourcePath) || changedPattern;
        index += 4;
        continue;
      }
      let property = null;
      if (tokens[index]?.value === '[') {
        const propertyClose = matching(index, '[', ']');
        if (propertyClose === -1 || propertyClose >= close) break;
        property = staticString(index + 1, propertyClose) ?? '*';
        index = propertyClose + 1;
      } else if (tokens[index]?.type === 'identifier') {
        property = tokens[index].value;
        index += 1;
      } else {
        index += 1;
        continue;
      }
      if (tokens[index]?.value === ':') {
        if (tokens[index + 1]?.value === '{') {
          const nestedClose = matching(index + 1, '{', '}');
          if (nestedClose === -1 || nestedClose > close) break;
          changedPattern = bindPattern(
            index + 1,
            nestedClose,
            [...sourcePath, property],
          ) || changedPattern;
          index = nestedClose + 1;
        } else if (tokens[index + 1]?.type === 'identifier') {
          changedPattern = bind(
            tokens[index + 1].value,
            [...sourcePath, property],
          ) || changedPattern;
          index += 2;
        }
      } else if (typeof property === 'string') {
        // Shorthand destructuring: const { entities } = base44.
        changedPattern = bind(property, [...sourcePath, property]) || changedPattern;
      }
      let nestedDepth = 0;
      while (index < close) {
        if (['(', '[', '{'].includes(tokens[index]?.value)) nestedDepth += 1;
        else if ([')', ']', '}'].includes(tokens[index]?.value)) nestedDepth -= 1;
        if (tokens[index]?.value === ',' && nestedDepth === 0) break;
        index += 1;
      }
      index += 1;
    }
    return changedPattern;
  }

  // Resolve constants, aliases, factory clients, and both declaration and
  // later destructuring assignments to a fixed point.
  let changed = true;
  let iterations = 0;
  while (changed && iterations < 100) {
    iterations += 1;
    changed = false;
    for (let index = 0; index < tokens.length; index += 1) {
      const name = tokens[index];
      if (name?.type === 'identifier' && tokens[index + 1]?.value === '=') {
        let end = index + 2;
        let expressionDepth = 0;
        while (end < tokens.length) {
          if (['(', '[', '{'].includes(tokens[end].value)) expressionDepth += 1;
          else if ([')', ']', '}'].includes(tokens[end].value)) expressionDepth -= 1;
          if (expressionDepth === 0 && [';', ','].includes(tokens[end].value)) break;
          end += 1;
        }
        const literal = staticString(index + 2, end);
        if (literal !== null && !ambiguousConstants.has(name.value)) {
          if (!constants.has(name.value)) {
            constants.set(name.value, literal);
            changed = true;
          } else if (constants.get(name.value) !== literal) {
            constants.delete(name.value);
            ambiguousConstants.add(name.value);
            changed = true;
          }
        }
        let rhs = pathAt(index + 2);
        if (rhs && tokens[rhs.end]?.value === '(') {
          // A method call normally returns data, not the receiver. Only the
          // reviewed client factory/wrapper handling below may propagate client
          // provenance through a call result.
          rhs = null;
        }
        if (!rhs) {
          // Client constructors are commonly wrapped by reviewed helpers before
          // assignment (for example lockBase44FunctionRevision(createClient())).
          // Preserve the SDK provenance through any such expression so a later
          // raw entity access cannot evade the contract.
          for (let cursor = index + 2; cursor < end; cursor += 1) {
            const namedFactory = factoryNames.has(tokens[cursor]?.value)
              && tokens[cursor + 1]?.value === '(';
            const namespaceFactory = sdkNamespaces.has(tokens[cursor]?.value)
              && tokens[cursor + 1]?.value === '.'
              && ['createClient', 'createClientFromRequest'].includes(tokens[cursor + 2]?.value)
              && tokens[cursor + 3]?.value === '(';
            if (namedFactory || namespaceFactory) {
              rhs = { segments: ['base44'] };
              break;
            }
          }
          const wrapperStart = tokens[index + 2]?.value === 'await' ? index + 3 : index + 2;
          const wrapperName = tokens[wrapperStart]?.value;
          if (
            !rhs
            && tokens[wrapperStart]?.type === 'identifier'
            && /(?:wrap|lock|guard).*(?:client|sdk|base44)|(?:client|sdk|base44).*(?:wrap|lock|guard)/i.test(wrapperName)
            && tokens[wrapperStart + 1]?.value === '('
          ) {
            const close = matching(wrapperStart + 1, '(', ')');
            for (let cursor = wrapperStart + 2; cursor !== -1 && cursor < close; cursor += 1) {
              if (
                tokens[cursor]?.type === 'identifier'
                && (
                  clientAliases.has(tokens[cursor].value)
                  || ['base44', 'clientDerived'].includes(
                    aliases.get(tokens[cursor].value)?.join('.'),
                  )
                )
              ) {
                // Reviewed transport wrappers preserve the Base44 client.
                rhs = { segments: ['base44'] };
                break;
              }
            }
          }
        }
        if (
          rhs?.segments?.[0] === 'sdkNamespace'
          && ['createClient', 'createClientFromRequest'].includes(rhs.segments[1])
        ) {
          if (!factoryNames.has(name.value)) {
            factoryNames.add(name.value);
            changed = true;
          }
        } else if (
          rhs
          && ['base44', 'clientDerived'].includes(rhs.segments[0])
          && rhs.segments.length === 1
        ) {
          if (!clientAliases.has(name.value)) {
            clientAliases.add(name.value);
            changed = true;
          }
        } else if (rhs) changed = bind(name.value, rhs.segments) || changed;
      }
      if (tokens[index]?.value === '{') {
        const close = matching(index, '{', '}');
        if (close !== -1 && tokens[close + 1]?.value === '=') {
          const sourcePath = pathAt(close + 2);
          if (sourcePath) changed = bindPattern(index, close, sourcePath.segments) || changed;
        }
      }
    }
  }

  if (changed) {
    return [{ entity: 'DynamicPatientOrVisit', method: 'dynamicRead', line: 1 }];
  }

  const findings = new Map();
  for (let index = 0; index < tokens.length; index += 1) {
    const precededBySpread = tokens[index - 1]?.value === '.'
      && tokens[index - 2]?.value === '.'
      && tokens[index - 3]?.value === '.';
    const bracketProperty = tokens[index - 1]?.value === '['
      && ['identifier', 'string', 'number'].includes(tokens[index - 2]?.type);
    if ((['.', '?'].includes(tokens[index - 1]?.value) && !precededBySpread) || bracketProperty) continue;
    const pathValue = pathAt(index);
    if (!pathValue) continue;
    const [client, maybeService, maybeEntities] = pathValue.segments;
    if (!['base44', 'clientDerived'].includes(client) || maybeService === 'asServiceRole') continue;
    const insideImport = importRanges.some(([start, end]) => index >= start && index <= end);
    const escapedClientContainer = client === 'base44'
      && pathValue.segments.length === 1
      && !insideImport
      && (
        tokens[index - 1]?.value === ':'
        || tokens[index - 1]?.value === 'return'
        || tokens[index - 1]?.value === '['
        || precededBySpread
        || isUnknownCallArgument(index)
        || (
          ['{', ','].includes(tokens[index - 1]?.value)
          && [',', '}'].includes(tokens[index + 1]?.value)
        )
      );
    if (escapedClientContainer) {
      const line = tokens[index].line;
      findings.set(`DynamicPatientOrVisit.clientEscape:${line}`, {
        entity: 'DynamicPatientOrVisit', method: 'clientEscape', line,
      });
      continue;
    }
    const directDynamicRoot = maybeService === '*'
      && (
        aliases.get(tokens[index]?.value)?.join('.') === 'base44'
        || aliases.get(tokens[index]?.value)?.join('.') === 'base44.*'
        || tokens[index]?.value === 'Reflect'
      );
    if (directDynamicRoot) {
      const line = tokens[index].line;
      findings.set(`DynamicPatientOrVisit.dynamicRead:${line}`, {
        entity: 'DynamicPatientOrVisit', method: 'dynamicRead', line,
      });
      continue;
    }
    if (maybeService !== 'entities') continue;
    const entity = maybeEntities;
    const method = pathValue.segments[3];
    const sensitive = SENSITIVE_ENTITIES.has(entity) || entity === '*';
    const read = READ_METHODS.has(method) || method === '*';
    const escapedRegistry = pathValue.segments.length === 2;
    const escapedHandle = sensitive && pathValue.segments.length === 3;
    if (escapedRegistry || (sensitive && (read || escapedHandle))) {
      const line = tokens[index].line;
      const labelEntity = escapedRegistry
        ? 'DynamicPatientOrVisit'
        : entity === '*' ? 'DynamicPatientOrVisit' : entity;
      const labelMethod = escapedRegistry
        ? 'registryEscape'
        : escapedHandle ? 'handle' : method === '*' ? 'dynamicRead' : method;
      findings.set(`${labelEntity}.${labelMethod}:${line}`, {
        entity: labelEntity, method: labelMethod, line,
      });
    }
  }
  return [...findings.values()];
}

// The 43 removed calls across these 38 modules are a reviewed migration
// inventory. Each entry records its original direct-read count and the broker
// token(s) that must remain present after the cutover.
const MIGRATED_CALLSITES = Object.freeze({
  'src/components/admin/AIAutoTagger.jsx': [1, /useAuthorizedVisits\s*\([\s\S]*?purpose:\s*'ai_tagging'/],
  'src/components/admin/AIKPIReportGenerator.jsx': [1, /useAuthorizedVisits\s*\([\s\S]*?purpose:\s*'reporting'/],
  'src/components/admin/DataQualityDashboard.jsx': [1, /useAuthorizedVisits\s*\([\s\S]*?purpose:\s*'data_quality'/],
  'src/components/admin/QualityMetricsDashboard.jsx': [1, /useAuthorizedVisits\s*\([\s\S]*?purpose:\s*'operations_analytics'/],
  'src/components/admin/SystemHealthMonitor.jsx': [2, /visitAggregatesAvailable\s*=\s*false/, /listAuthorizedVisits\s*\([\s\S]*?purpose:\s*'activity'[\s\S]*?pageSize:\s*1/],
  'src/components/alerts/PatientAlertAnalyzer.jsx': [1, /useAuthorizedVisits\s*\([\s\S]*?purpose:\s*'documentation'/],
  'src/components/clinical/VitalsChart.jsx': [1, /useAuthorizedVisits\s*\([\s\S]*?purpose:\s*'vitals_trend'/],
  'src/components/compliance/AIComplianceAuditor.jsx': [2, /useAuthorizedPatient\s*\([\s\S]*?purpose:\s*'oasis_analysis_context'/, /useAuthorizedVisits\s*\([\s\S]*?purpose:\s*'documentation'/],
  'src/components/dashboard/HospitalizationRiskWidget.jsx': [1, /useAuthorizedVisits\s*\([\s\S]*?purpose:\s*'hospitalization_risk'/],
  'src/components/documents/ProgressReportGenerator.jsx': [1, /useAuthorizedVisits\s*\([\s\S]*?purpose:\s*'documentation'/],
  'src/components/documents/ReferralLetterGenerator.jsx': [1, /useAuthorizedVisits\s*\([\s\S]*?purpose:\s*'documentation'/],
  'src/components/documents/SmartNotesContextPanel.jsx': [1, /useAuthorizedVisits\s*\([\s\S]*?purpose:\s*'documentation'/],
  'src/components/hub-tabs/AdminReportsCenter.jsx': [1, /useAuthorizedVisits\s*\([\s\S]*?purpose:\s*'reporting'/],
  'src/components/hub-tabs/ComplianceMonitoringDashboard.jsx': [1, /visitComplianceAvailable\s*=\s*false/],
  'src/components/hub-tabs/OASISAnalyzer.jsx': [1, /collectAuthorizedVisits\s*\([\s\S]*?purpose:\s*'activity'/],
  'src/components/hub-tabs/PatientEducationPortal.jsx': [1, /Patient education generation is temporarily unavailable[\s\S]*?tenant-safe storage/],
  'src/components/oasis/AIProactiveOASISAssistant.jsx': [1, /useAuthorizedVisits\s*\([\s\S]*?purpose:\s*'documentation'/],
  'src/components/oasis/PredictiveOutcomesAnalyzer.jsx': [1, /useAuthorizedVisits\s*\([\s\S]*?purpose:\s*'activity'/],
  'src/components/oasis/SmartNoteDataImport.jsx': [1, /useAuthorizedVisits\s*\([\s\S]*?purpose:\s*'documentation'/],
  'src/components/patient/ClinicalEventsTimeline.jsx': [1, /useAuthorizedVisits\s*\([\s\S]*?purpose:\s*'activity'/],
  'src/components/patient/PatientMergeDialog.jsx': [2, /purpose:\s*'activity'/],
  'src/components/patient/VitalSignsTrendDashboard.jsx': [1, /useAuthorizedVisits\s*\([\s\S]*?purpose:\s*'vitals_trend'/],
  'src/components/smartNote/VisitSummaryGenerator.jsx': [1, /useAuthorizedVisits\s*\([\s\S]*?purpose:\s*'documentation'/],
  'src/components/smartNote/VitalsTrendAnalysis.jsx': [1, /useAuthorizedVisits\s*\([\s\S]*?purpose:\s*'vitals_trend'/],
  'src/components/utils/patientHistoryAnalyzer.jsx': [2, /Authorized Patient and Visit context is required/],
  'src/components/visit/AudioVisitCapture.jsx': [1, /useAuthorizedVisit\s*\([\s\S]*?purpose:\s*'documentation'/],
  'src/components/voice/CallHistoryList.jsx': [1, /useScopedPatients\s*\([\s\S]*?purpose:\s*'contact'/],
  'src/components/voice/CallbackQueue.jsx': [1, /useScopedPatients\s*\([\s\S]*?purpose:\s*'contact'/],
  'src/hooks/useScopedPatients.js': [2, /listAuthorizedPatients\s*\(/],
  'src/pages/AgencyAnalytics.jsx': [1, /useAuthorizedVisits\s*\([\s\S]*?purpose:\s*'operations_analytics'/],
  'src/pages/ClinicalInsightsDashboard.jsx': [1, /useAuthorizedVisits\s*\([\s\S]*?purpose:\s*'clinical_insights'/],
  'src/pages/ComplianceCenter.jsx': [1, /useScopedPatients\s*\([\s\S]*?purpose:\s*'roster'/],
  'src/pages/DuplicatePatients.jsx': [1, /useAuthorizedVisits\s*\([\s\S]*?purpose:\s*'deduplication'/],
  'src/pages/PatientDataManagement.jsx': [1, /useAuthorizedVisits\s*\([\s\S]*?purpose:\s*'activity'/],
  'src/pages/PatientRecordDashboard.jsx': [1, /useAuthorizedVisits\s*\([\s\S]*?purpose:\s*'activity'/],
  'src/pages/Patients.jsx': [1, /useAuthorizedVisits\s*\([\s\S]*?purpose:\s*'activity'/],
  'src/pages/PredictiveAnalytics.jsx': [1, /useAuthorizedVisits\s*\([\s\S]*?purpose:\s*'hospitalization_risk'/],
  'src/pages/SmartNoteAssistant.jsx': [1, /useAuthorizedVisit\s*\([\s\S]*?purpose:\s*'documentation'/],
});

describe('Patient/Visit direct-read containment', () => {
  it('finds direct, optional, bracket, destructured, and aliased SDK reads', () => {
    const fixture = `
      import { base44 as sdk } from '@/api/base44Client';
      const entityName = 'Pat' + 'ient';
      const methodName = 'fi' + 'lter';
      const patient = sdk?.entities?.[entityName];
      const { [methodName]: readPatients } = patient;
      readPatients({ status: 'active' });
      const { Visit: VisitEntity } = sdk.entities;
      const readVisits = VisitEntity?.['list'];
      readVisits();
      let laterEntity;
      ({ Patient: laterEntity } = sdk.entities);
      const dynamicMethod = unknownAtRuntime;
      laterEntity[dynamicMethod]();
    `;
    const findings = scanDirectPatientVisitReads('fixture.tsx', fixture).map(
      ({ entity, method }) => `${entity}.${method}`,
    );
    expect(findings).toEqual(expect.arrayContaining([
      'Patient.filter', 'Visit.list', 'Patient.dynamicRead',
    ]));
  });

  it('finds extension imports, hosted factories, raw clients, and unresolved entity keys', () => {
    const fixture = `
      import { base44 as browser } from '@/api/base44Client.js';
      import { createClient, createClientFromRequest as makeClient } from 'npm:@base44/sdk@0.8.31';
      import * as sdk from '@base44/sdk';
      const hosted = makeClient(req);
      hosted.entities.Visit.get('v1');
      makeClient(req).entities.Patient.list();
      const raw = lockBase44FunctionRevision(createClient({ appId: 'x' }));
      raw.entities.Patient.subscribe(() => {});
      const wrapped = wrapTenantSdkClient(raw);
      wrapped.entities.Visit.get('v2');
      const preserved = preserve(raw);
      preserved.entities.Patient.list();
      sdk.createClient({ appId: 'x' }).entities.Visit.list();
      const commonJsSdk = require('@base44/sdk');
      commonJsSdk.createClient({ appId: 'x' }).entities.Patient.get('p2');
      const { createClientFromRequest: makeCommonJs } = require('@base44/sdk');
      makeCommonJs(req).entities.Visit.get('v3');
      browser.entities[entityName].filter({});
      browser.entities['Pat\\u0069ent'].list();
    `;
    const findings = scanDirectPatientVisitReads('entry.ts', fixture).map(
      ({ entity, method }) => `${entity}.${method}`,
    );
    expect(findings).toEqual(expect.arrayContaining([
      'Visit.get', 'Patient.list', 'Patient.subscribe', 'Visit.list', 'Patient.get',
      'DynamicPatientOrVisit.filter',
    ]));
  });

  it('fails closed when a sensitive handle or entity registry escapes', () => {
    const fixture = `
      import { base44 } from '@/api/base44Client';
      function read(entity) { return entity.list(); }
      const patientEntity = (base44!.entities.Patient);
      read(patientEntity);
      const reflectedVisit = Reflect.get(base44.entities, 'Visit');
      read(reflectedVisit);
      const { entities } = base44;
      entities.Visit.get('v1');
      const { entities: { Patient } } = base44;
      Patient.filter({});
      const copiedPatient = { ...base44.entities.Patient };
      const copiedRegistry = { ...base44.entities };
      Object.values(base44.entities);
      const box = { client: base44 };
    `;
    const findings = scanDirectPatientVisitReads('escape.tsx', fixture).map(
      ({ entity, method }) => `${entity}.${method}`,
    );
    expect(findings).toEqual(expect.arrayContaining([
      'Patient.handle',
      'Visit.handle',
      'DynamicPatientOrVisit.registryEscape',
      'DynamicPatientOrVisit.clientEscape',
    ]));
  });

  it('fails each full-client container and unknown-call escape independently', () => {
    for (const expression of [
      'const box = { client: base44 };',
      'const box = { base44 };',
      'const list = [base44];',
      'const box = { ...base44 };',
      'function leak() { return base44; }',
      'consume(base44);',
    ]) {
      const findings = scanDirectPatientVisitReads('client-escape.jsx', `
        import { base44 } from '@/api/base44Client';
        ${expression}
      `).filter(({ method }) => method === 'clientEscape');
      expect(findings, expression).toHaveLength(1);
    }
  });

  it('tracks reviewed client wrappers across multiple hops', () => {
    const findings = scanDirectPatientVisitReads('wrapped-client.js', `
      import { createClient } from '@base44/sdk';
      const raw = createClient({ appId: 'x' });
      const once = wrapTenantSdkClient(raw);
      const twice = guardSdkClient(once);
      twice.entities.Visit.list();
    `).map(({ entity, method }) => `${entity}.${method}`);
    expect(findings).toContain('Visit.list');
  });

  it('tracks a factory destructured from an ESM SDK namespace', () => {
    const findings = scanDirectPatientVisitReads('namespace-factory.ts', `
      import * as sdk from '@base44/sdk';
      const { createClientFromRequest: make } = sdk;
      make(req).entities.Visit.list();
    `).map(({ entity, method }) => `${entity}.${method}`);
    expect(findings).toEqual(['Visit.list']);
  });

  it('fails closed on unresolved client roots and SDK factory aliases', () => {
    const findings = scanDirectPatientVisitReads('dynamic-root.cjs', `
      import { base44 } from '@/api/base44Client';
      base44[unknown].Patient.list();
      Reflect.get(base44, unknown).Visit.get('v1');
      const { [unknown]: registry } = base44;
      registry.Patient.filter({});
      const { ...rest } = base44;
      rest.entities.Visit.list();
      const make = require('@base44/sdk').createClientFromRequest;
      make(req).entities.Patient.get('p1');
    `).map(({ entity, method }) => `${entity}.${method}`);
    expect(findings.filter((value) => value === 'DynamicPatientOrVisit.dynamicRead')).toHaveLength(4);
    expect(findings).toEqual(expect.arrayContaining(['Visit.list', 'Patient.get']));
  });

  it('does not confuse similarly named entities or reviewed broker wrappers with direct reads', () => {
    const fixture = `
      import { base44 } from '@/api/base44Client';
      base44.entities.PatientAlert.filter({ patient_id: 'p1' });
      listAuthorizedPatients({ purpose: 'roster' });
      collectAuthorizedVisits({ purpose: 'activity' });
      base44.asServiceRole.entities.Patient.filter({ id: 'p1' });
    `;
    expect(scanDirectPatientVisitReads('negative.jsx', fixture)).toEqual([]);
  });

  it('keeps generic configuration lookup on an exact non-PHI runtime allowlist', () => {
    const source = readFileSync(path.join(SRC, 'lib/agencySettings.js'), 'utf8');
    expect(source).toMatch(/const CONFIG_ENTITIES = Object\.freeze\(\{[\s\S]*?PayerRateConfig:[\s\S]*?FaxRetryConfig:/);
    expect(source).toMatch(/if \(!Object\.hasOwn\(CONFIG_ENTITIES, entityName\)\) return null/);
    expect(source).not.toMatch(/base44\.entities\s*\[/);
    expect(source).not.toMatch(/\b(?:Patient|Visit)\s*:/);
  });

  it('blocks direct Patient/Visit PHI reads in frontend and non-service hosted code', () => {
    const failures = [];
    for (const absolute of [
      ...productionModules(SRC),
      ...productionModules(HOSTED_FUNCTIONS),
    ]) {
      const source = readFileSync(absolute, 'utf8');
      const relative = path.relative(ROOT, absolute).replaceAll(path.sep, '/');
      for (const finding of scanDirectPatientVisitReads(relative, source)) {
        failures.push(`${relative}:${finding.line} ${finding.entity}.${finding.method}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it('keeps the complete 43-read/38-module migration inventory on reviewed brokers', () => {
    expect(Object.keys(MIGRATED_CALLSITES)).toHaveLength(38);
    expect(Object.values(MIGRATED_CALLSITES).reduce((sum, [count]) => sum + count, 0)).toBe(43);
    for (const [relative, [, ...requirements]] of Object.entries(MIGRATED_CALLSITES)) {
      const source = readFileSync(path.join(ROOT, relative), 'utf8');
      for (const requirement of requirements) expect(source, relative).toMatch(requirement);
    }
  });

  it('keeps direct Patient and Visit reads disabled at the entity boundary', () => {
    for (const entity of ['Patient', 'Visit']) {
      const schema = JSON5.parse(readFileSync(path.join(ROOT, `base44/entities/${entity}.jsonc`), 'utf8'));
      expect(schema.rls.read, `${entity}.rls.read`).toBe(false);
    }
  });

  it('keeps the incomplete AI compliance full-chart path statically unreachable', () => {
    const auditorPath = path.join(SRC, 'components/compliance/AIComplianceAuditor.jsx');
    const references = [];
    for (const absolute of productionModules(SRC)) {
      if (absolute === auditorPath) continue;
      const text = readFileSync(absolute, 'utf8');
      const tokens = lexSource(text);
      for (let index = 0; index < tokens.length; index += 1) {
        const token = tokens[index];
        const importedModule = token.type === 'string'
          && token.value.includes('AIComplianceAuditor')
          && (tokens[index - 1]?.value === 'from' || tokens[index - 1]?.value === '(');
        const jsxMount = token.value === 'AIComplianceAuditor'
          && (tokens[index - 1]?.value === '<' || (
            tokens[index - 1]?.value === '.' && tokens[index - 2]?.value === '<'
          ));
        if (importedModule || jsxMount) references.push(path.relative(ROOT, absolute));
      }
    }
    expect([...new Set(references)]).toEqual([]);

    const auditor = readFileSync(auditorPath, 'utf8');
    expect(auditor).toMatch(/const AI_COMPLIANCE_AUDITOR_ENABLED\s*=\s*false\s*;/);
    expect(auditor).toMatch(/if \(!AI_COMPLIANCE_AUDITOR_ENABLED\)[\s\S]*?AI Compliance Audit Paused[\s\S]*?return <EnabledAIComplianceAuditor/);
  });
});

export { scanDirectPatientVisitReads };
