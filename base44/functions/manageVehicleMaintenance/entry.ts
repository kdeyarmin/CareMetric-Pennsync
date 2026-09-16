import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// Vehicles and service records are closed to direct client CRUD. This broker
// authorizes every request against protected User identity + AgencyMembership.
// Custom User agency/account_type/is_manager fields are never authority inputs.
const PAGE_SIZE = 50;
const FLEET_TIME_ZONE = 'America/New_York';
export function fleetToday(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: FLEET_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now).map(part => [part.type, part.value]));
  return [parts.year, parts.month, parts.day].join('-');
}

const ROLES = new Set(['agency_admin', 'manager', 'clinician', 'office_staff', 'social_worker', 'spiritual_care']);
const TYPES = new Set(['oil_change', 'tires', 'brakes', 'inspection', 'scheduled_maintenance', 'repair', 'other']);
const STATUSES = new Set(['active', 'out_of_service', 'retired']);
const VEHICLE_FIELDS = ['id', 'agency_id', 'unit_name', 'year', 'make', 'model', 'vin', 'license_plate', 'baseline_odometer', 'status', 'assigned_user_id', 'assigned_user_name', 'assigned_user_email', 'notes', 'version', 'updated_at'];
const ENTRY_FIELDS = ['id', 'agency_id', 'vehicle_id', 'service_date', 'odometer', 'service_type', 'description', 'service_provider', 'cost_cents', 'invoice_reference', 'next_due_date', 'next_due_odometer', 'recorded_at', 'submitted_by_user_id', 'submitted_by_name', 'submitted_by_email', 'entry_source', 'review_status', 'review_history'];

class FleetError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
const fail = (status: number, message: string): never => { throw new FleetError(status, message); };
const email = (value: unknown) => typeof value === 'string' ? value.trim().toLowerCase() : '';
const pick = (row: Record<string, any>, fields: string[]) => Object.fromEntries(fields.filter(key => row[key] !== undefined).map(key => [key, row[key]]));
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
function id(value: unknown, label = 'identifier') {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,200}$/.test(value)) fail(400, `Invalid ${label}.`);
  return value as string;
}
function object(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(400, 'An object is required.');
  return value as Record<string, any>;
}
function keys(value: Record<string, any>, allowed: string[]) {
  if (Object.keys(value).some(key => !allowed.includes(key))) fail(400, 'Unsupported fields in request.');
}
function text(value: unknown, label: string, max: number, required = false) {
  if (value == null && !required) return '';
  if (typeof value !== 'string') fail(400, `${label} must be text.`);
  const out = (value as string).trim();
  if (out.length > max || (required && !out) || /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(out)) fail(400, `Check ${label}.`);
  return out;
}
function integer(value: unknown, label: string, maximum = 2000000) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > maximum) fail(400, `Check ${label}.`);
  return value as number;
}
function date(value: unknown, label: string) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) fail(400, `Check ${label}.`);
  const parsed = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) fail(400, `Check ${label}.`);
  return value as string;
}
function rows(value: unknown, scope: Record<string, any>) {
  if (!Array.isArray(value) || value.some(row => !row || Object.entries(scope).some(([key, val]) => row[key] !== val))) {
    fail(409, 'Record scope could not be verified. Refresh and try again.');
  }
  return value as Array<Record<string, any>>;
}
async function exact(entity: any, query: Record<string, any>, missing = 'Record unavailable.') {
  const found = rows(await entity.filter(query, undefined, 2), query);
  if (found.length !== 1) fail(found.length ? 409 : 404, missing);
  return found[0];
}
function enabled(user: Record<string, any>) {
  return user && user.is_active !== false && user.disabled !== true && user.is_service !== true && user.is_verified !== false;
}
async function identity(client: any, ownerEmail: string) {
  const user = await client.auth.me().catch(() => null);
  if (!user) fail(401, 'Sign in to use Vehicle Maintenance.');
  if (!enabled(user)) fail(403, 'This account cannot access Vehicle Maintenance.');
  const userId = id(user.id, 'user identity');
  const userEmail = email(user.email);
  if (!userEmail || !userEmail.includes('@')) fail(403, 'Account identity is unavailable.');
  const owner = !!email(ownerEmail) && user.role === 'admin' && userEmail === email(ownerEmail);
  if (!owner && user.role !== 'user') fail(403, 'Unsupported account role.');
  const entities = client.asServiceRole.entities;
  const memberships = rows(await entities.AgencyMembership.filter({ user_id: userId }, '-updated_date', 101), { user_id: userId });
  if (memberships.length > 100 || (owner && memberships.length)) fail(409, 'Tenant membership requires administrator review.');
  const agencyIds = new Set();
  for (const member of memberships) {
    if (agencyIds.has(member.agency_id) || member.membership_key !== `${member.agency_id}:${userId}`
      || member.user_email_normalized !== userEmail || !ROLES.has(member.tenant_role)
      || !['pending', 'active', 'suspended', 'revoked'].includes(member.status)
      || !Number.isSafeInteger(member.version) || member.version < 1) fail(409, 'Tenant membership is ambiguous.');
    id(member.agency_id, 'agency');
    agencyIds.add(member.agency_id);
  }
  return { user, userId, userEmail, owner, memberships, entities };
}
async function authority(client: any, ownerEmail: string, agencyId: string) {
  const caller = await identity(client, ownerEmail);
  const member = caller.memberships.find(row => row.agency_id === agencyId && row.status === 'active');
  if (!caller.owner && !member) fail(403, 'No active membership for this agency.');
  const agency = await exact(caller.entities.Agency, { id: agencyId }, 'Agency unavailable.');
  if (!['active', 'trial'].includes(agency.status)) fail(403, 'Agency is not active.');
  return { ...caller, agencyId, canManage: caller.owner || member.tenant_role === 'agency_admin',
    snapshot: [caller.userId, caller.userEmail, caller.owner, agencyId, agency.status, member?.id || null, member?.version || null, member?.tenant_role || null] };
}
async function recheck(client: any, ownerEmail: string, auth: any) {
  const fresh = await authority(client, ownerEmail, auth.agencyId);
  if (!same(fresh.snapshot, auth.snapshot)) fail(409, 'Access changed. Refresh before continuing.');
}
function admin(auth: any) { if (!auth.canManage) fail(403, 'Agency administrator access is required.'); }
async function vehicle(auth: any, vehicleId: string) {
  const record = await exact(auth.entities.FleetVehicle, { id: vehicleId, agency_id: auth.agencyId }, 'Vehicle unavailable.');
  if (!auth.canManage && (record.assigned_user_id !== auth.userId || record.status === 'retired')) fail(403, 'This vehicle is not assigned to you.');
  return record;
}
async function assignee(auth: any, userId: string) {
  if (!userId) return { assigned_user_id: '', assigned_user_name: '', assigned_user_email: '' };
  const member = await exact(auth.entities.AgencyMembership, { agency_id: auth.agencyId, user_id: id(userId), status: 'active' }, 'Choose an active employee in this agency.');
  const user = await exact(auth.entities.User, { id: userId }, 'Employee unavailable.');
  if (!enabled(user) || user.role !== 'user' || member.membership_key !== `${auth.agencyId}:${userId}` || member.user_email_normalized !== email(user.email) || !ROLES.has(member.tenant_role)) fail(403, 'Employee assignment is unavailable.');
  return { assigned_user_id: userId, assigned_user_name: text(user.full_name || user.email, 'Employee name', 320), assigned_user_email: email(user.email) };
}
function vehicleData(raw: unknown) {
  const value = object(raw);
  keys(value, ['unit_name', 'year', 'make', 'model', 'vin', 'license_plate', 'baseline_odometer', 'status', 'assigned_user_id', 'notes']);
  const year = integer(value.year, 'model year', new Date().getUTCFullYear() + 2);
  if (year < 1900) fail(400, 'Check model year.');
  const vin = text(value.vin, 'VIN', 17).toUpperCase();
  if (vin && !/^[A-HJ-NPR-Z0-9]{17}$/.test(vin)) fail(400, 'VIN must be 17 characters, without I, O, or Q, or left blank.');
  if (!STATUSES.has(value.status)) fail(400, 'Check vehicle status.');
  return { unit_name: text(value.unit_name, 'Vehicle/unit name', 100, true), year,
    make: text(value.make, 'Make', 60, true), model: text(value.model, 'Model', 80, true), vin,
    license_plate: text(value.license_plate, 'License plate', 30).toUpperCase(),
    baseline_odometer: integer(value.baseline_odometer, 'Odometer'), status: value.status,
    notes: text(value.notes, 'Vehicle notes', 2000) };
}
function serviceData(raw: unknown) {
  const value = object(raw);
  keys(value, ['service_date', 'odometer', 'service_type', 'description', 'service_provider', 'cost_cents', 'invoice_reference', 'next_due_date', 'next_due_odometer']);
  const serviceDate = date(value.service_date, 'Service date');
  if (serviceDate > fleetToday()) fail(400, 'Log completed work, not a future service date.');
  const odometer = integer(value.odometer, 'Odometer');
  if (!TYPES.has(value.service_type)) fail(400, 'Choose a service type.');
  const nextDate = value.next_due_date ? date(value.next_due_date, 'Next service date') : '';
  if (nextDate && nextDate < serviceDate) fail(400, 'Next service date cannot precede this service.');
  const out: Record<string, any> = { service_date: serviceDate, odometer, service_type: value.service_type,
    description: text(value.description, 'Work performed', 4000, true), service_provider: text(value.service_provider, 'Shop/provider', 200),
    invoice_reference: text(value.invoice_reference, 'Invoice/reference', 100), next_due_date: nextDate };
  if (value.cost_cents != null) out.cost_cents = integer(value.cost_cents, 'Cost', 100000000);
  if (value.next_due_odometer != null) {
    out.next_due_odometer = integer(value.next_due_odometer, 'Next service mileage');
    if (out.next_due_odometer < odometer) fail(400, 'Next service mileage cannot be lower than this reading.');
  }
  return out;
}
function validReview(item: any) {
  return !!item && typeof item === 'object' && !Array.isArray(item)
    && ['reviewed', 'needs_follow_up'].includes(item.status)
    && typeof item.note === 'string' && item.note.length <= 2000
    && (item.status !== 'needs_follow_up' || !!item.note.trim())
    && typeof item.reviewer_id === 'string' && /^[a-zA-Z0-9_-]{1,200}$/.test(item.reviewer_id)
    && typeof item.reviewer_name === 'string' && !!item.reviewer_name.trim() && item.reviewer_name.length <= 320
    && typeof item.reviewed_at === 'string' && Number.isFinite(Date.parse(item.reviewed_at));
}
function legacyReviewHistory(entry: Record<string, any>) {
  if (!Object.hasOwn(entry, 'review_history')) return [];
  if (!Array.isArray(entry.review_history) || entry.review_history.length > 100 || entry.review_history.some(item => !validReview(item))) {
    fail(409, 'Stored review history is invalid. No review information was replaced.');
  }
  return entry.review_history;
}
async function loadReviewEvents(auth: any, entries: Array<Record<string, any>>) {
  if (!entries.length) return [];
  const ids = entries.map(row => row.id);
  const scope = { agency_id: auth.agencyId };
  const events = rows(await auth.entities.FleetServiceReview.filter({ ...scope, entry_id: { $in: ids } }, 'reviewed_at', 5000), scope);
  if (events.length >= 5000 || events.some(event => !ids.includes(event.entry_id) || !validReview(event)
    || event.vehicle_id !== entries.find(entry => entry.id === event.entry_id)?.vehicle_id)) {
    fail(409, 'Review history requires reconciliation. No annotations were discarded.');
  }
  return events;
}
function withReviewEvents(entry: Record<string, any>, events: Array<Record<string, any>>) {
  const legacy = legacyReviewHistory(entry);
  const appended = events.filter(event => event.entry_id === entry.id).sort((a, b) =>
    a.reviewed_at === b.reviewed_at ? a.id.localeCompare(b.id) : a.reviewed_at.localeCompare(b.reviewed_at));
  const history = [...legacy, ...appended.map(event => pick(event, ['status', 'note', 'reviewer_id', 'reviewer_name', 'reviewed_at']))];
  return { ...entry, review_history: history, review_status: history.length ? history[history.length - 1].status : entry.review_status };
}

async function requestDigest(scope: Record<string, any>) {
  const data = new TextEncoder().encode(JSON.stringify(Object.entries(scope).sort(([a], [b]) => a.localeCompare(b))));
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', data)), byte => byte.toString(16).padStart(2, '0')).join('');
}
function creationClaims(parent: Record<string, any>, field: string) {
  if (!Object.hasOwn(parent, field)) return [];
  const claims = parent[field];
  if (!Array.isArray(claims) || claims.some(claim => !claim || typeof claim !== 'object'
    || typeof claim.key !== 'string' || !/^[a-f0-9]{64}$/.test(claim.key)
    || typeof claim.token !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/.test(claim.token))) {
    fail(409, 'Creation reservations require administrator review.');
  }
  return claims;
}
async function createOnce(entity: any, scope: Record<string, any>, facts: Record<string, any>, payload: Record<string, any>,
  coordinator: { entity: any; scope: Record<string, any>; field: string; beforeCreate: () => Promise<void> }) {
  const key = await requestDigest(scope);
  const readExisting = async (token?: string) => {
    const found = rows(await entity.filter(scope, undefined, 2), scope);
    if (found.length > 1) fail(409, 'Duplicate request requires administrator review. Do not submit again.');
    if (!found.length) return null;
    const fields = new Set([...Object.keys(facts), 'cost_cents', 'next_due_odometer']);
    if ([...fields].some(field => !same(found[0][field] ?? undefined, facts[field] ?? undefined))) {
      fail(409, 'This request was already saved with different information. Refresh the log.');
    }
    if (token && found[0].creation_claim_token !== token) fail(409, 'Creation provenance requires reconciliation.');
    return found[0];
  };
  let parent = await exact(coordinator.entity, coordinator.scope);
  let claims = creationClaims(parent, coordinator.field);
  const existingClaim = claims.find(claim => claim.key === key);
  const existing = await readExisting(existingClaim?.token);
  if (existing) return existing;
  if (existingClaim) fail(409, 'This save is awaiting reconciliation. Refresh the log before retrying.');
  if (claims.length >= 5000) fail(409, 'Creation reservation capacity reached. Existing records were retained.');
  const token = crypto.randomUUID();
  // Native $push appends a candidate without replacing anyone else's claims.
  // The FIRST persisted candidate for the key is the only permitted creator.
  // This uses ordered append semantics, not the unverified filtered-update CAS
  // rejected in PLATFORM-CAS.md. Claims are permanent and never reordered.
  try {
    await coordinator.entity.updateMany(coordinator.scope, {
      $push: { [coordinator.field]: { key, token } },
    });
  } catch { /* Only exact readback can establish that our append was accepted. */ }
  parent = await exact(coordinator.entity, coordinator.scope);
  claims = creationClaims(parent, coordinator.field);
  const winner = claims.find(claim => claim.key === key);
  if (!winner || winner.token !== token) {
    const saved = await readExisting(winner?.token);
    if (saved) return saved;
    fail(409, 'Another request owns this save. Refresh the log to reconcile it.');
  }
  await coordinator.beforeCreate();
  // A create is attempted only once by this invocation. A lost response never
  // releases the durable claim or authorizes a replacement create on retry.
  try { await entity.create({ ...payload, ...facts, ...scope, creation_claim_token: token }); }
  catch { /* Read back an accepted-but-timed-out create, without retrying it. */ }
  const saved = await readExisting(token);
  if (!saved) fail(409, 'Save outcome is uncertain. The request is reserved; refresh the log before retrying.');
  return saved;
}

function historyCursor(value: unknown, scope: Record<string, any>) {
  if (value == null || value === 0) return null;
  if (typeof value !== 'string' || value.length > 650) fail(409, 'History paging changed. Refresh the log.');
  const [version, agencyId, vehicleId, day, recordId, extra] = value.split(':');
  if (version !== 'v1' || agencyId !== scope.agency_id || vehicleId !== scope.vehicle_id || extra !== undefined) fail(400, 'History cursor does not match this vehicle.');
  return { day: date(day, 'history cursor date'), id: id(recordId, 'history cursor id') };
}
async function historyPage(entity: any, scope: Record<string, any>, cursorValue: unknown) {
  const cursor = historyCursor(cursorValue, scope);
  const limit = PAGE_SIZE + 1;
  const compare = (a, b) => a.service_date === b.service_date
    ? (a.id === b.id ? 0 : a.id > b.id ? -1 : 1)
    : a.service_date > b.service_date ? -1 : 1;
  const checked = (raw, predicate) => {
    const result = rows(raw, scope);
    if (result.length > limit || result.some(row => !id(row.id) || !date(row.service_date, 'stored service date') || !predicate(row))) fail(409, 'History page scope could not be verified.');
    if (new Set(result.map(row => row.id)).size !== result.length) fail(409, 'History contains duplicate identities.');
    return result;
  };
  let collected = [];
  if (cursor) {
    collected = checked(await entity.filter({ ...scope, service_date: cursor.day, id: { $lt: cursor.id } }, '-id', limit),
      row => row.service_date === cursor.day && row.id < cursor.id).sort(compare);
  }
  if (collected.length < limit) {
    const older = checked(await entity.filter({ ...scope, ...(cursor ? { service_date: { $lt: cursor.day } } : {}) }, '-service_date', limit - collected.length),
      row => !cursor || row.service_date < cursor.day);
    if (older.length) {
      older.sort(compare);
      const boundaryDay = older[older.length - 1].service_date;
      // The SDK supports one sort field. All newer date groups are complete;
      // re-read only the possibly truncated last group by immutable id. This
      // gives a (service_date, id) cursor without undocumented compound sorting.
      const completeDays = older.filter(row => row.service_date > boundaryDay);
      const boundary = checked(await entity.filter({ ...scope, service_date: boundaryDay }, '-id', limit - collected.length - completeDays.length),
        row => row.service_date === boundaryDay).sort(compare);
      collected.push(...completeDays, ...boundary);
    }
  }
  collected.sort(compare);
  if (new Set(collected.map(row => row.id)).size !== collected.length) fail(409, 'History cursor failed to advance.');
  const page = collected.slice(0, PAGE_SIZE);
  const last = page[page.length - 1];
  const next = collected.length > PAGE_SIZE ? `v1:${scope.agency_id}:${scope.vehicle_id}:${last.service_date}:${last.id}` : null;
  // Compatibility alias: already-published clients forward this opaque token
  // in their offset property. Stale numeric offsets are rejected, not skipped.
  return { entries: page, next_cursor: next, next_offset: next };
}

export async function handleVehicleMaintenance(req: Request, client: any, ownerEmail = '') {
  try {
    if (req.method !== 'POST') return json({ success: false, error: 'POST required.' }, 405);
    const raw = await req.text();
    if (new TextEncoder().encode(raw).length > 20000) fail(413, 'Request is too large.');
    let body: Record<string, any>;
    try { body = object(JSON.parse(raw)); } catch { fail(400, 'Invalid request body.'); }
    const action = body.action;
    const actionKeys: Record<string, string[]> = {
      context: [], vehicles: ['offset', 'include_retired'], staff: ['offset'], history: ['vehicle_id', 'offset', 'cursor'],
      create_vehicle: ['request_id', 'vehicle'], update_vehicle: ['vehicle_id', 'expected_version', 'vehicle'],
      add_entry: ['vehicle_id', 'request_id', 'entry'], review_entry: ['vehicle_id', 'entry_id', 'request_id', 'expected_review_count', 'status', 'note'],
    };
    if (!Object.hasOwn(actionKeys, action)) fail(400, 'Unknown vehicle-maintenance action.');
    keys(body, ['action', 'agency_id', ...actionKeys[action]]);
    if (action === 'context') {
      const caller = await identity(client, ownerEmail);
      let agencies;
      if (caller.owner) {
        const list = rows(await caller.entities.Agency.filter({}, 'agency_name', 201), {});
        if (list.length > 200) fail(409, 'Fleet agency picker needs pagination before use.');
        agencies = list.filter(row => ['active', 'trial'].includes(row.status)).map(row => ({ id: id(row.id), name: text(row.agency_name, 'Agency name', 200), can_manage: true }));
      } else {
        agencies = [];
        for (const member of caller.memberships.filter(row => row.status === 'active')) {
          const agency = await exact(caller.entities.Agency, { id: member.agency_id });
          if (['active', 'trial'].includes(agency.status)) agencies.push({ id: agency.id, name: text(agency.agency_name, 'Agency name', 200), can_manage: member.tenant_role === 'agency_admin' });
        }
      }
      const fresh = await identity(client, ownerEmail);
      if (fresh.userId !== caller.userId || !same(fresh.memberships, caller.memberships) || fresh.owner !== caller.owner) fail(409, 'Access changed. Refresh.');
      return json({ success: true, agencies, user_id: caller.userId });
    }
    const auth = await authority(client, ownerEmail, id(body.agency_id, 'agency'));
    const offset = action === 'history' || body.offset === undefined ? 0 : integer(body.offset, 'Page offset', 1000000);
    if (action === 'staff') {
      admin(auth);
      const scope = { agency_id: auth.agencyId, status: 'active' };
      const members = rows(await auth.entities.AgencyMembership.filter(scope, 'user_email_normalized', PAGE_SIZE + 1, offset), scope);
      const page = members.slice(0, PAGE_SIZE);
      const userIds = page.map(member => id(member.user_id));
      if (new Set(userIds).size !== userIds.length || page.some(member =>
        member.membership_key !== `${auth.agencyId}:${member.user_id}` || !ROLES.has(member.tenant_role)
      )) fail(409, 'Employee roster membership is ambiguous.');
      // One bounded User query rather than 100 sequential per-employee reads.
      const users = userIds.length ? rows(await auth.entities.User.filter({ id: { $in: userIds } }, undefined, PAGE_SIZE + 1), {}) : [];
      if (users.length > PAGE_SIZE || users.some(user => !userIds.includes(user.id))
        || new Set(users.map(user => user.id)).size !== users.length) fail(409, 'Employee roster identity scope is invalid.');
      const staff = page.flatMap(member => {
        const user = users.find(user => user.id === member.user_id);
        if (!user || !enabled(user) || user.role !== 'user') return [];
        if (member.user_email_normalized !== email(user.email)) fail(409, 'Employee roster identity changed.');
        return [{ id: user.id, name: text(user.full_name || user.email, 'Employee name', 320), email: email(user.email) }];
      });
      await recheck(client, ownerEmail, auth);
      return json({ success: true, staff, next_offset: members.length > PAGE_SIZE ? offset + PAGE_SIZE : null });
    }
    if (action === 'vehicles') {
      const scope: Record<string, any> = { agency_id: auth.agencyId };
      if (!auth.canManage) scope.assigned_user_id = auth.userId;
      const query = { ...scope, ...(!auth.canManage || !body.include_retired ? { status: { $ne: 'retired' } } : {}) };
      const found = rows(await auth.entities.FleetVehicle.filter(query, 'unit_name', PAGE_SIZE + 1, offset), scope);
      if ((!auth.canManage || !body.include_retired) && found.some(row => row.status === 'retired')) fail(409, 'Vehicle scope could not be verified.');
      await recheck(client, ownerEmail, auth);
      return json({ success: true, vehicles: found.slice(0, PAGE_SIZE).map(row => pick(row, VEHICLE_FIELDS)), can_manage: auth.canManage, next_offset: found.length > PAGE_SIZE ? offset + PAGE_SIZE : null });
    }
    if (action === 'create_vehicle') {
      admin(auth);
      const facts = { ...vehicleData(body.vehicle), ...await assignee(auth, body.vehicle.assigned_user_id || '') };
      await recheck(client, ownerEmail, auth);
      const saved = await createOnce(auth.entities.FleetVehicle,
        { agency_id: auth.agencyId, request_key: `${auth.agencyId}:${auth.userId}:${id(body.request_id, 'request')}` }, facts,
        { version: 1, created_by_user_id: auth.userId, updated_by_user_id: auth.userId, updated_at: new Date().toISOString() },
        { entity: auth.entities.Agency, scope: { id: auth.agencyId }, field: 'fleet_vehicle_creation_claims', beforeCreate: () => recheck(client, ownerEmail, auth) });
      await recheck(client, ownerEmail, auth);
      return json({ success: true, vehicle: pick(saved, VEHICLE_FIELDS) });
    }
    const current = await vehicle(auth, id(body.vehicle_id, 'vehicle'));
    if (action === 'history') {
      const scope = { agency_id: auth.agencyId, vehicle_id: current.id };
      if (body.cursor !== undefined && body.offset !== undefined) fail(400, 'Supply one history cursor.');
      const page = await historyPage(auth.entities.FleetServiceEntry, scope, body.cursor ?? body.offset);
      const reviews = await loadReviewEvents(auth, page.entries);
      await recheck(client, ownerEmail, auth);
      if (!same(pick(await vehicle(auth, current.id), VEHICLE_FIELDS), pick(current, VEHICLE_FIELDS))) fail(409, 'Vehicle assignment changed. Refresh.');
      return json({ success: true, vehicle: pick(current, VEHICLE_FIELDS), ...page, entries: page.entries.map(row => pick(withReviewEvents(row, reviews), ENTRY_FIELDS)) });
    }
    if (action === 'update_vehicle') {
      admin(auth);
      const expected = integer(body.expected_version, 'Vehicle version');
      if (current.version !== expected) fail(409, 'Vehicle was changed by another administrator. Reload before saving.');
      const facts = { ...vehicleData(body.vehicle), ...await assignee(auth, body.vehicle.assigned_user_id || '') };
      await recheck(client, ownerEmail, auth);
      const result = await auth.entities.FleetVehicle.updateMany(
        { id: current.id, agency_id: auth.agencyId, version: expected },
        { $set: { ...facts, version: expected + 1, updated_by_user_id: auth.userId, updated_at: new Date().toISOString() } },
      );
      if (result?.success !== true || result.updated !== 1 || result.has_more) fail(409, 'Vehicle changed or save could not be confirmed. Reload.');
      const saved = await vehicle(auth, current.id);
      if (saved.version !== expected + 1 || Object.keys(facts).some(key => !same(saved[key], facts[key]))) fail(409, 'Vehicle save requires reconciliation. Reload.');
      await recheck(client, ownerEmail, auth);
      return json({ success: true, vehicle: pick(saved, VEHICLE_FIELDS) });
    }
    if (action === 'add_entry') {
      if (current.status === 'retired') fail(409, 'Restore this vehicle before adding new service records. Its history remains available.');
      const facts = serviceData(body.entry);
      await recheck(client, ownerEmail, auth);
      if (!same(pick(await vehicle(auth, current.id), VEHICLE_FIELDS), pick(current, VEHICLE_FIELDS))) fail(409, 'Vehicle assignment changed. Refresh.');
      const saved = await createOnce(auth.entities.FleetServiceEntry,
        { agency_id: auth.agencyId, vehicle_id: current.id, request_key: `${auth.agencyId}:${auth.userId}:${id(body.request_id, 'request')}` }, facts,
        { recorded_at: new Date().toISOString(), submitted_by_user_id: auth.userId,
          submitted_by_name: text(auth.user.full_name || auth.user.email, 'Name', 320), submitted_by_email: auth.userEmail,
          entry_source: auth.canManage ? 'admin' : 'employee', review_status: 'pending', review_history: [] },
        { entity: auth.entities.FleetVehicle, scope: { id: current.id, agency_id: auth.agencyId }, field: 'service_creation_claims', beforeCreate: async () => {
          await recheck(client, ownerEmail, auth);
          if (!same(pick(await vehicle(auth, current.id), VEHICLE_FIELDS), pick(current, VEHICLE_FIELDS))) fail(409, 'Vehicle assignment changed. Refresh.');
        } });
      await recheck(client, ownerEmail, auth);
      await vehicle(auth, current.id);
      return json({ success: true, entry: pick(saved, ENTRY_FIELDS) });
    }
    if (action === 'review_entry') {
      admin(auth);
      const scope = { id: id(body.entry_id, 'entry'), agency_id: auth.agencyId, vehicle_id: current.id };
      const entry = await exact(auth.entities.FleetServiceEntry, scope);
      const projected = withReviewEvents(entry, await loadReviewEvents(auth, [entry]));
      const expected = integer(body.expected_review_count, 'Review count', 5000);
      if (expected > projected.review_history.length) fail(409, 'Review changed. Reload before reviewing again.');
      if (!['reviewed', 'needs_follow_up'].includes(body.status)) fail(400, 'Choose a review status.');
      const facts = { status: body.status, note: text(body.note, 'Review note', 2000, body.status === 'needs_follow_up'),
        reviewer_id: auth.userId, reviewer_name: text(auth.user.full_name || auth.user.email, 'Reviewer', 320) };
      const requestId = body.request_id === undefined
        ? await requestDigest({ entry: entry.id, reviewer: auth.userId, expected, status: facts.status, note: facts.note })
        : id(body.request_id, 'review request');
      // Reviews are independent immutable rows. Never replace the service
      // entry's review array: concurrent administrators cannot erase each other.
      await createOnce(auth.entities.FleetServiceReview,
        { agency_id: auth.agencyId, vehicle_id: current.id, entry_id: entry.id, request_key: `${auth.agencyId}:${entry.id}:${auth.userId}:${requestId}` },
        facts, { reviewed_at: new Date().toISOString() },
        { entity: auth.entities.FleetServiceEntry, scope, field: 'review_creation_claims', beforeCreate: async () => {
          await recheck(client, ownerEmail, auth);
          const fresh = await exact(auth.entities.FleetServiceEntry, scope);
          const review = withReviewEvents(fresh, await loadReviewEvents(auth, [fresh]));
          if (review.review_history.length >= 100) fail(409, 'Review history is full. Existing annotations are retained.');
        } });
      const saved = await exact(auth.entities.FleetServiceEntry, scope);
      const result = withReviewEvents(saved, await loadReviewEvents(auth, [saved]));
      await recheck(client, ownerEmail, auth);
      return json({ success: true, entry: pick(result, ENTRY_FIELDS) });
    }
    return json({ success: false, error: 'Unsupported operation.' }, 400);
  } catch (error) {
    if (error instanceof FleetError) return json({ success: false, error: error.message }, error.status);
    return json({ success: false, error: 'Vehicle service is unavailable or the save outcome is uncertain. Refresh the log before retrying.' }, 503);
  }
}

Deno.serve(req => handleVehicleMaintenance(req, createClientFromRequest(req), Deno.env.get('SUPER_ADMIN_EMAIL') || ''));
