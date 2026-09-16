import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// Vehicles and service records are closed to direct client CRUD. This broker
// authorizes every request against protected User identity + AgencyMembership.
// Custom User agency/account_type/is_manager fields are never authority inputs.
const PAGE_SIZE = 50;
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
  if (!enabled(user) || member.membership_key !== `${auth.agencyId}:${userId}` || member.user_email_normalized !== email(user.email) || !ROLES.has(member.tenant_role)) fail(403, 'Employee assignment is unavailable.');
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
  if (serviceDate > new Date().toISOString().slice(0, 10)) fail(400, 'Log completed work, not a future service date.');
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
async function createOnce(entity: any, scope: Record<string, any>, facts: Record<string, any>, payload: Record<string, any>) {
  const found = rows(await entity.filter(scope, undefined, 2), scope);
  if (found.length > 1) fail(409, 'Duplicate request requires administrator review. Do not submit again.');
  if (found.length) {
    if (Object.keys(facts).some(key => !same(found[0][key], facts[key]))) fail(409, 'This request was already saved with different information. Refresh the log.');
    return found[0];
  }
  await entity.create({ ...payload, ...facts, ...scope });
  return exact(entity, scope, 'Save outcome is uncertain. Refresh the log before retrying.');
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
      context: [], vehicles: ['offset', 'include_retired'], staff: ['offset'], history: ['vehicle_id', 'offset'],
      create_vehicle: ['request_id', 'vehicle'], update_vehicle: ['vehicle_id', 'expected_version', 'vehicle'],
      add_entry: ['vehicle_id', 'request_id', 'entry'], review_entry: ['vehicle_id', 'entry_id', 'expected_review_count', 'status', 'note'],
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
    const offset = body.offset === undefined ? 0 : integer(body.offset, 'Page offset', 1000000);
    if (action === 'staff') {
      admin(auth);
      const scope = { agency_id: auth.agencyId, status: 'active' };
      const members = rows(await auth.entities.AgencyMembership.filter(scope, 'user_email_normalized', PAGE_SIZE + 1, offset), scope);
      const staff = [];
      for (const member of members.slice(0, PAGE_SIZE)) {
        const employee = await assignee(auth, member.user_id);
        staff.push({ id: employee.assigned_user_id, name: employee.assigned_user_name, email: employee.assigned_user_email });
      }
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
        { version: 1, created_by_user_id: auth.userId, updated_by_user_id: auth.userId, updated_at: new Date().toISOString() });
      await recheck(client, ownerEmail, auth);
      return json({ success: true, vehicle: pick(saved, VEHICLE_FIELDS) });
    }
    const current = await vehicle(auth, id(body.vehicle_id, 'vehicle'));
    if (action === 'history') {
      const scope = { agency_id: auth.agencyId, vehicle_id: current.id };
      const found = rows(await auth.entities.FleetServiceEntry.filter(scope, '-service_date', PAGE_SIZE + 1, offset), scope);
      await recheck(client, ownerEmail, auth);
      if (!same(await vehicle(auth, current.id), current)) fail(409, 'Vehicle assignment changed. Refresh.');
      return json({ success: true, vehicle: pick(current, VEHICLE_FIELDS), entries: found.slice(0, PAGE_SIZE).map(row => pick(row, ENTRY_FIELDS)), next_offset: found.length > PAGE_SIZE ? offset + PAGE_SIZE : null });
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
      if (!same(await vehicle(auth, current.id), current)) fail(409, 'Vehicle assignment changed. Refresh.');
      const saved = await createOnce(auth.entities.FleetServiceEntry,
        { agency_id: auth.agencyId, vehicle_id: current.id, request_key: `${auth.agencyId}:${auth.userId}:${id(body.request_id, 'request')}` }, facts,
        { recorded_at: new Date().toISOString(), submitted_by_user_id: auth.userId,
          submitted_by_name: text(auth.user.full_name || auth.user.email, 'Name', 320), submitted_by_email: auth.userEmail,
          entry_source: auth.canManage ? 'admin' : 'employee', review_status: 'pending', review_history: [] });
      await recheck(client, ownerEmail, auth);
      await vehicle(auth, current.id);
      return json({ success: true, entry: pick(saved, ENTRY_FIELDS) });
    }
    if (action === 'review_entry') {
      admin(auth);
      const scope = { id: id(body.entry_id, 'entry'), agency_id: auth.agencyId, vehicle_id: current.id };
      const entry = await exact(auth.entities.FleetServiceEntry, scope);
      const history = Array.isArray(entry.review_history) ? entry.review_history : [];
      if (integer(body.expected_review_count, 'Review count', 100) !== history.length) fail(409, 'Review changed. Reload before reviewing again.');
      if (history.length >= 100) fail(409, 'Review history is full. Contact your administrator; no history was deleted.');
      if (!['reviewed', 'needs_follow_up'].includes(body.status)) fail(400, 'Choose a review status.');
      const next = [...history, { status: body.status, note: text(body.note, 'Review note', 2000, body.status === 'needs_follow_up'),
        reviewer_id: auth.userId, reviewer_name: text(auth.user.full_name || auth.user.email, 'Reviewer', 320), reviewed_at: new Date().toISOString() }];
      await recheck(client, ownerEmail, auth);
      // Conditional update of the entire prior review array avoids replacing a
      // review made since this page loaded. Original service facts never change.
      const result = await auth.entities.FleetServiceEntry.updateMany({ ...scope, review_history: history }, { $set: { review_status: body.status, review_history: next } });
      if (result?.success !== true || result.updated !== 1 || result.has_more) fail(409, 'Review changed or save was not confirmed. Reload.');
      const saved = await exact(auth.entities.FleetServiceEntry, scope);
      if (!same(saved.review_history, next)) fail(409, 'Review save requires reconciliation. Reload.');
      await recheck(client, ownerEmail, auth);
      return json({ success: true, entry: pick(saved, ENTRY_FIELDS) });
    }
    return json({ success: false, error: 'Unsupported operation.' }, 400);
  } catch (error) {
    if (error instanceof FleetError) return json({ success: false, error: error.message }, error.status);
    return json({ success: false, error: 'Vehicle service is unavailable or the save outcome is uncertain. Refresh the log before retrying.' }, 503);
  }
}

Deno.serve(req => handleVehicleMaintenance(req, createClientFromRequest(req), Deno.env.get('SUPER_ADMIN_EMAIL') || ''));
