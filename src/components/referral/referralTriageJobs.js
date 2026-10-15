import { base44 } from '@/api/base44Client';
import uploadClinicalFile from '@/components/utils/uploadClinicalFile';
import { readUploadErrorDetail } from '@/lib/uploadError';

/**
 * The browser side of background referral-packet triage.
 *
 * A packet is uploaded to private storage, then the referralTriageJobs
 * function plans it into page ranges and reads them a few at a time. Each
 * `process` call is one bounded run on the server; while the page is open it
 * drives the job with back-to-back runs, and when the page closes the
 * scheduler's sweep carries on, and the uploader is notified when it is done.
 *
 * Every call goes through `callJobs`, the one invocation of the function in
 * the browser, so the function surface counts it once.
 */

export const PACKET_MAX_BYTES = 25 * 1024 * 1024;

const callJobs = (params) => base44.functions.invoke('referralTriageJobs', params);

const OPEN_STATUSES = new Set(['queued', 'processing']);
export const isOpenJob = (job) => OPEN_STATUSES.has(job?.status);

export function isPdfFile(file) {
  const name = String(file?.name || '').toLowerCase();
  return file?.type === 'application/pdf' || name.endsWith('.pdf');
}

/** The server's own sentence for a failed call, or `fallback`. */
export function jobErrorMessage(error, fallback) {
  return readUploadErrorDetail(error) || fallback;
}

async function send(params) {
  const response = await callJobs(params);
  const data = response?.data;
  if (!data || data.success !== true) {
    const error = new Error(data?.error || 'The referral packet request failed.');
    error.data = data;
    throw error;
  }
  return data;
}

function requestId() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** Upload `file` privately and start its job. Resolves the job's summary. */
export async function startPacketTriage({ agencyId, file, upload = uploadClinicalFile }) {
  const { file_uri: fileUri } = await upload({ file });
  if (!fileUri) throw new Error('The packet could not be uploaded.');
  const data = await send({
    action: 'start',
    agency_id: agencyId,
    client_request_id: requestId(),
    file_uri: fileUri,
    file_name: String(file?.name || 'Referral packet.pdf').slice(0, 200),
  });
  return data.job;
}

/** One server run on the job. Resolves `{ job, busy }`. */
export async function processPacketTriage({ agencyId, jobId }) {
  const data = await send({ action: 'process', agency_id: agencyId, job_id: jobId });
  return { job: data.job, busy: data.busy === true };
}

export async function getPacketTriage({ agencyId, jobId }) {
  return (await send({ action: 'get', agency_id: agencyId, job_id: jobId })).job;
}

export async function listPacketTriage({ agencyId }) {
  return (await send({ action: 'list', agency_id: agencyId })).jobs || [];
}

/** A one-line description of where a job stands. */
export function describeJobProgress(job) {
  if (!job) return '';
  if (job.status === 'ready') return 'Triage ready';
  if (job.status === 'failed') return job.error_message || 'Could not be analyzed';
  if (job.summarizing) return 'Writing the triage summary…';
  const parts = Number(job.part_count) || 0;
  if (job.status === 'queued' || !parts) return 'Waiting to start…';
  return `Reading pages — part ${Math.min(parts, (Number(job.parts_done) || 0) + 1)} of ${parts}`;
}
