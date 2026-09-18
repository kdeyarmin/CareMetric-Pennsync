// Finite existing-patient manual intake contract; no documents or admission writes.
const ID = /^[A-Za-z0-9_-]{1,128}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const HASH = /^[a-f0-9]{64}$/;
const object = value => !!value && typeof value === 'object' && !Array.isArray(value);
const exact = (value, keys) => object(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value,key));
const text = (value, pattern) => typeof value === 'string' && pattern.test(value);
const revision = value => Number.isSafeInteger(value) && value > 0;
const fields = ['patient_name','priority','document_type','status','requires_manual_review','manually_confirmed'];
const base = ['p_agency_id','p_patient_id','p_expected_actor_version','p_expected_patient_version'];
const timestamp = value => typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const name = value => typeof value === 'string' && value.startsWith('Synthetic ') && value.length <= 120 && value.slice(10).trim().length > 0;
export const isReferralMethod = method => ['s3_create','s3_confirm','s3_read'].includes(method);
export function validReferralParams(method,p) {
  const extra = method==='s3_create' ? ['p_request_id','p_fields'] : method==='s3_confirm'
    ? ['p_referral_id','p_expected_referral_version','p_request_id'] : ['p_referral_id'];
  if (!isReferralMethod(method) || !exact(p,[...base,...extra]) || !text(p.p_agency_id,ID) || !text(p.p_patient_id,ID)
    || !revision(p.p_expected_actor_version) || !revision(p.p_expected_patient_version)) return false;
  if (method!=='s3_read' && !text(p.p_request_id,UUID)) return false;
  if (method!=='s3_create' && !text(p.p_referral_id,UUID)) return false;
  if (method==='s3_confirm' && p.p_expected_referral_version!==1) return false;
  if (method!=='s3_create') return true;
  const f=p.p_fields;
  return exact(f,fields) && name(f.patient_name) && ['low','normal','high','urgent'].includes(f.priority)
    && f.document_type==='manual' && f.status==='new' && f.requires_manual_review===true && f.manually_confirmed===false;
}
export function validReferralResult(r,method,p,contextValid) {
  const action=method.slice(3), write=action!=='read';
  const keys=['contract','staging','synthetic','app_id','action','context','referral',
    ...(write ? ['request_id','replayed','receipt'] : ['referral_sha256'])];
  if (!exact(r,keys) || r.contract!=='cm.pennsync.s3-referral.staging.v1' || r.staging!==true || r.synthetic!==true
    || r.app_id!==p.p_app_id || r.action!==action || !contextValid(r.context,p.p_agency_id)
    || !['agency_admin','manager','office_staff'].includes(r.context.tenant_role)
    || r.context.membership_version!==p.p_expected_actor_version) return false;
  if (write && (r.request_id!==p.p_request_id || typeof r.replayed!=='boolean' || !exact(r.receipt,['payload_sha256','referral_sha256'])
    || !text(r.receipt.payload_sha256,HASH) || !text(r.receipt.referral_sha256,HASH))) return false;
  if (!write && !text(r.referral_sha256,HASH)) return false;
  const v=r.referral;
  if (!exact(v,[...fields,'id','agency_id','patient_id','version','created_by_user_id','created_by_user_email_normalized',
    'created_by','client_request_id','referral_creation_key','created_date','updated_date'])
    || !text(v.id,UUID) || v.agency_id!==p.p_agency_id || v.patient_id!==p.p_patient_id
    || ![1,2].includes(v.version) || !name(v.patient_name) || !['low','normal','high','urgent'].includes(v.priority)
    || v.document_type!=='manual' || !text(v.created_by_user_id,ID) || !text(v.client_request_id,UUID)
    || typeof v.created_by!=='string' || !/^[^\s@]+@[^\s@]+$/.test(v.created_by)
    || v.created_by!==v.created_by.trim().toLowerCase() || v.created_by_user_email_normalized!==v.created_by
    || v.referral_creation_key!==`${v.agency_id}:${v.created_by_user_id}:${v.client_request_id}`
    || !timestamp(v.created_date) || !timestamp(v.updated_date) || v.updated_date<v.created_date) return false;
  if (v.status!==(v.version===1 ? 'new':'ready_for_admission') || v.requires_manual_review!==(v.version===1)
    || v.manually_confirmed!==(v.version===2)) return false;
  if (action==='create') return v.version===1 && v.client_request_id===p.p_request_id
    && v.created_by_user_id===r.context.user_id && v.created_by===r.context.user_email
    && v.created_date===v.updated_date && fields.every(key=>v[key]===p.p_fields[key]);
  return v.id===p.p_referral_id && (action!=='confirm' || v.version===2);
}
