const ID = /^[A-Za-z0-9_-]{1,128}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const exact = (value, keys) => object(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const id = value => typeof value === 'string' && ID.test(value);
const uuid = value => typeof value === 'string' && UUID.test(value);
const version = value => Number.isSafeInteger(value) && value >= 1;
const SCOPE = ['agency_id','membership_id','membership_version','tenant_role','patient_id','access_basis','assignment_id','assignment_version'];
const CURSOR = [...SCOPE,'version','after_id','purpose','status','sort','page_size','subject_user_id'];
const PARAMS = ['p_agency_id','p_patient_id','p_status','p_page_size','p_cursor'];
function access(scope) {
  return scope.tenant_role === 'agency_admin' ? scope.access_basis === 'agency_wide'
    && scope.assignment_id === null && scope.assignment_version === null
    : scope.tenant_role === 'clinician' && scope.access_basis === 'care_team_assignment'
      && uuid(scope.assignment_id) && version(scope.assignment_version);
}
export function validVisitScheduleParams(params) {
  if (!exact(params, PARAMS) || !id(params.p_agency_id) || !id(params.p_patient_id)
    || ![null,'completed'].includes(params.p_status) || !Number.isSafeInteger(params.p_page_size)
    || params.p_page_size < 1 || params.p_page_size > 50) return false;
  const cursor = params.p_cursor;
  return cursor === null || (exact(cursor, CURSOR) && cursor.version === 1 && uuid(cursor.after_id)
    && cursor.agency_id === params.p_agency_id && cursor.patient_id === params.p_patient_id
    && cursor.purpose === 'schedule' && cursor.status === params.p_status && cursor.sort === 'id_asc'
    && cursor.page_size === params.p_page_size && id(cursor.subject_user_id) && id(cursor.membership_id)
    && version(cursor.membership_version) && access(cursor));
}
function cursorOf(scope, context, params, after) {
  return { ...scope, version:1, after_id:after, purpose:'schedule', status:params.p_status,
    sort:'id_asc', page_size:params.p_page_size, subject_user_id:context.user_id };
}
const equal = (value, expected) => exact(value, Object.keys(expected)) && Object.keys(expected).every(key => value[key] === expected[key]);
const timestamp = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
export function validVisitSchedule(result, params) {
  const { scope, context, visits, page } = result;
  if (result.purpose !== 'schedule' || !exact(scope,SCOPE) || !access(scope)
    || scope.patient_id !== params.p_patient_id || scope.agency_id !== params.p_agency_id
    || !['agency_id','membership_id','membership_version','tenant_role'].every(key => scope[key] === context[key])
    || !Array.isArray(visits) || visits.length > params.p_page_size
    || !exact(page,['page_size','sort','after_id','has_more','next_cursor'])
    || page.page_size !== params.p_page_size || page.sort !== 'id_asc'
    || page.after_id !== (params.p_cursor?.after_id ?? null) || typeof page.has_more !== 'boolean') return false;
  if (params.p_cursor && !equal(params.p_cursor,cursorOf(scope,context,params,params.p_cursor.after_id))) return false;
  let prior = params.p_cursor?.after_id ?? '';
  for (const visit of visits) {
    if (!exact(visit,['id','patient_id','visit_date','visit_type','status','updated_date']) || !uuid(visit.id)
      || visit.id <= prior || visit.patient_id !== params.p_patient_id || visit.visit_type !== 'skilled_nursing'
      || visit.status !== 'completed' || typeof visit.visit_date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(visit.visit_date)
      || !timestamp(`${visit.visit_date}T00:00:00.000Z`) || !timestamp(visit.updated_date)) return false;
    prior = visit.id;
  }
  return page.has_more ? visits.length === params.p_page_size
    && equal(page.next_cursor,cursorOf(scope,context,params,visits.at(-1).id)) : page.next_cursor === null;
}
