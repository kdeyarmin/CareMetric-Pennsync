import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// <<<BEGIN SHARED HELPER: schedulerAuth — generated, edit base44/_shared/backendHelpers.mjs>>>
const SCHEDULER_SECRET_HEADER = 'x-internal-secret';
function isSchedulerAdmin(user) {
  return !!user && (
    user.role === 'admin' || user.account_type === 'agency_admin' ||
    user.account_type === 'super_admin'
  );
}
// Constant-time string compare for the shared-secret check (mirrors
// createTelehealthToken's timingSafeEqual). A plain === short-circuits on the
// first differing character, so response timing could leak how much of the
// secret matched. Dependency-free char-code XOR so the identical source runs
// under Deno (consumers) and Node (tests).
function timingSafeEqualStr(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}
function getSchedulerAuthError(req, user) {
  if (isSchedulerAdmin(user)) return null;
  const expectedSecret = String(Deno.env.get('INTERNAL_FN_SECRET') || '').trim();
  if (!expectedSecret) {
    return Response.json(
      { error: 'Server misconfigured: INTERNAL_FN_SECRET is required for scheduled/internal functions' },
      { status: 500 },
    );
  }
  const providedSecret = String(req.headers.get(SCHEDULER_SECRET_HEADER) || '').trim();
  if (timingSafeEqualStr(providedSecret, expectedSecret)) return null;
  return Response.json(
    { error: user ? 'Forbidden: admin or scheduler secret required' : 'Unauthorized: scheduler secret required' },
    { status: user ? 403 : 401 },
  );
}
// <<<END SHARED HELPER: schedulerAuth>>>

// <<<BEGIN SHARED HELPER: requireActiveUser — generated, edit base44/_shared/backendHelpers.mjs>>>
const isDeactivatedUser = (u) => !!u && u.is_active === false;
const DEACTIVATED_USER_RESPONSE = () => Response.json(
  { error: 'Unauthorized - account is deactivated' },
  { status: 403 },
);
// <<<END SHARED HELPER: requireActiveUser>>>


// processInboundFaxes — scheduled job: OCR newly received inbound faxes and
// auto-match provider fax-backs to open referral follow-up requests.
//
// Pipeline: handleTelnyxStatusWebhook ingests `fax.received` into IncomingFax
// (processing_status 'pending') → this job OCRs the document and matches it
// against referrals whose follow_up_requests.status === 'sent'. A CONFIDENT
// match (patient name + corroborating signal) attaches the fax to the request
// (status 'received') and notifies the requester; anything weaker only files a
// suggestion for manual review — attaching a provider's response to the wrong
// patient's referral is worse than asking a human.
//
// Plain Deno.serve endpoint like the other scheduled jobs (no in-repo cron:
// register a scheduled trigger on the Base44 dashboard; recommended cadence:
// every 10-15 minutes when fax receiving is enabled). Auth requires either an
// admin session or the configured `x-internal-secret` scheduler header.

// ---- matcher helpers (mirror src/components/referral/followUpFaxMatcher.js;
// keep the two in sync) ----

const FORM_MARKER = 'additional information request';
// Bounded OCR retries for an inbound fax before it is marked terminally failed
// (a transient provider error otherwise dropped the fax on its first attempt).
const MAX_OCR_ATTEMPTS = 5;

function normalizeFaxNumber(num: unknown) {
  const digits = String(num || '').replace(/\D/g, '');
  return digits.length > 10 ? digits.slice(-10) : digits;
}

const normText = (s: unknown) => String(s || '').toLowerCase().replace(/\s+/g, ' ');
const normName = (s: unknown) =>
  String(s || '').toLowerCase().replace(/\bdr\.?\b/g, '').replace(/[^a-z ]/g, '').trim();

// WHOLE-WORD comparison — raw substring matching auto-attached the wrong
// patient ("John Smith" matched a fax about "Robert Johnson" from "Smithfield
// Family Clinic"), which mis-files PHI and silences the stale-request escalation.
function nameInText(name: unknown, text: string) {
  const words = normName(name).split(' ').filter((w) => w.length > 1);
  if (words.length < 2) return false;
  const tokens = new Set(normName(text).split(' ').filter(Boolean));
  return words.every((w) => tokens.has(w));
}

// OCR often spaces out date separators ("01 / 05 / 1950") — tighten them first.
function dobInText(dob: unknown, text: string) {
  const raw = String(dob || '').trim();
  const t = String(text || '').replace(/\s*([/-])\s*/g, '$1');
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return raw.length >= 8 && t.includes(raw);
  const [, y, mo, d] = m;
  const variants = [`${y}-${mo}-${d}`, `${mo}/${d}/${y}`, `${Number(mo)}/${Number(d)}/${y}`, `${mo}-${d}-${y}`];
  return variants.some((v) => t.includes(v));
}

function extractSignals(fax: { ocrText: string; senderNumber: string }, candidate: Record<string, unknown>) {
  const text = normText(fax.ocrText);
  const sender = normalizeFaxNumber(fax.senderNumber);
  const sentTo = normalizeFaxNumber(candidate.sentToNumber);
  return {
    form_marker: text.includes(FORM_MARKER),
    patient_name: nameInText(candidate.patientName, text),
    patient_dob: dobInText(candidate.patientDob, text),
    sender_number: !!sender && sender.length === 10 && sender === sentTo,
    provider_name: nameInText(candidate.providerName, text),
  };
}

const scoreSignals = (signals: Record<string, boolean>) => Object.values(signals).filter(Boolean).length;

// Merge AI-extracted fax answers onto follow-up items — mirrors
// applyFaxAnswersToItems in src/components/referral/followUpFaxMatcher.js
// (keep the two in sync). Only OPEN items can move to 'answered' (never
// downgrade a human-marked or portal-answered item), only non-empty response
// text counts, unknown ids are ignored; resolving stays a human action.
function applyFaxAnswersToItems(
  items: Array<Record<string, unknown>>,
  answers: Array<Record<string, unknown>>,
  answeredAt?: string,
  source = 'fax',
) {
  const byId = new Map<string, string>();
  for (const a of answers || []) {
    const text = String(a?.response_text ?? '').trim();
    if (a?.id && a?.answered === true && text) byId.set(a.id as string, text);
  }
  let answeredCount = 0;
  const out = (items || []).map((it) => {
    const text = byId.get(it?.id as string);
    if (!text || (it.item_status && it.item_status !== 'open')) return it;
    answeredCount += 1;
    return {
      ...it,
      item_status: 'answered',
      response: { text: text.slice(0, 4000), source },
      answered_at: answeredAt || new Date().toISOString(),
    };
  });
  return { items: out, answeredCount };
}

function bestFaxBackMatch(fax: { ocrText: string; senderNumber: string }, candidates: Array<Record<string, unknown>>) {
  let best: Record<string, unknown> | null = null;
  for (const candidate of candidates) {
    const signals = extractSignals(fax, candidate);
    const score = scoreSignals(signals);
    if (score === 0) continue;
    const identifying = signals.patient_name || signals.patient_dob || signals.sender_number;
    if (!identifying) continue;
    if (!best || score > (best.score as number)) {
      best = { candidate, signals, score, confident: signals.patient_name && score >= 2 };
    } else if (score === best.score) {
      best = { ...best, confident: false, tied: true };
    }
  }
  return best;
}

// ---- job ----

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const me = await base44.auth.me().catch(() => null);
    const authError = getSchedulerAuthError(req, me);
    if (authError) return authError;
    if (isDeactivatedUser(me)) return DEACTIVATED_USER_RESPONSE();

    const pending = (await base44.asServiceRole.entities.IncomingFax.filter({ processing_status: 'pending' }, undefined, 5000).catch(() => []))
      .slice(0, 10);
    if (pending.length === 0) {
      return Response.json({ success: true, processed: 0 });
    }

    // Candidates: referrals with a SENT follow-up request, plus where we faxed it.
    const referrals = await base44.asServiceRole.entities.Referral.list('-created_date', 300).catch(() => []);
    const openRequests = (referrals || []).filter((r) => r.follow_up_requests?.status === 'sent');
    const candidates = [];
    for (const r of openRequests) {
      let sentToNumber = null;
      if (r.follow_up_requests.fax_log_id) {
        const logs = await base44.asServiceRole.entities.FaxLog.filter({ id: r.follow_up_requests.fax_log_id }, undefined, 5000).catch(() => []);
        sentToNumber = logs[0]?.to_number || null;
      }
      candidates.push({
        referral: r,
        id: r.id,
        patientName: r.patient_name || r.extracted_data?.demographics?.full_name || '',
        patientDob: r.patient_dob || '',
        providerName: r.extracted_data?.demographics?.referring_physician || '',
        sentToNumber,
      });
    }

    let processed = 0;
    let matched = 0;
    // Per-run claim token — mirrors dispatchScheduledSms / processScheduledFaxes.
    // Without claim+re-read, two overlapping crons both flip pending→processing
    // and both OCR + attach the same fax (duplicate PHI match notifications).
    const runId = `inbound-fax-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    for (const fax of pending) {
      try {
        await base44.asServiceRole.entities.IncomingFax.update(fax.id, {
          processing_status: 'processing',
          claimed_by: runId,
          claimed_at: new Date().toISOString(),
        });
      } catch (claimErr) {
        console.error('Could not claim inbound fax; skipping', claimErr?.message || claimErr);
        continue;
      }
      const claimCheck = await base44.asServiceRole.entities.IncomingFax
        .filter({ id: fax.id }, undefined, 1)
        .catch(() => []);
      if (!claimCheck[0] || claimCheck[0].claimed_by !== runId) {
        continue;
      }
      let ocr;
      try {
        ocr = await base44.asServiceRole.integrations.Core.InvokeLLM({
          model: 'automatic',
          prompt: `Transcribe this faxed document completely and accurately (typed and handwritten text). Then extract the fields. If the document is a completed "Additional Information Request" form, transcribe every response carefully.`,
          file_urls: [fax.document_url],
          response_json_schema: {
            type: 'object',
            properties: {
              full_text: { type: 'string' },
              patient_name: { type: 'string' },
              patient_dob: { type: 'string' },
              provider_name: { type: 'string' },
              summary: { type: 'string' },
            },
          },
        });
      } catch (error) {
        console.error('Inbound fax OCR failed:', error?.message);
        // A transient OCR failure (provider 5xx/timeout, platform blip) must not
        // terminally drop the fax: the cron only ever re-scans 'pending', so a
        // 'failed' inbound fax — e.g. a provider fax-back answering an open
        // referral follow-up — was never re-processed and silently vanished from
        // auto-matching. Return the row to 'pending' for a bounded number of
        // retries, only marking it terminally failed after the cap.
        const nextAttempts = (Number(fax.ocr_attempts) || 0) + 1;
        const exhausted = nextAttempts >= MAX_OCR_ATTEMPTS;
        await base44.asServiceRole.entities.IncomingFax.update(fax.id, {
          processing_status: exhausted ? 'failed' : 'pending',
          ocr_attempts: nextAttempts,
          claimed_by: null,
          claimed_at: null,
        }).catch(() => {});
        continue;
      }

      // Re-check claim after the slow OCR so a concurrent cron that overwrote
      // claimed_by mid-flight cannot both attach the same fax (best-effort;
      // Base44 updates are still last-write-wins — docs/PLATFORM-CAS.md).
      const preWriteClaim = await base44.asServiceRole.entities.IncomingFax
        .filter({ id: fax.id }, undefined, 1)
        .catch(() => []);
      if (!preWriteClaim[0] || preWriteClaim[0].claimed_by !== runId) {
        console.error('Lost inbound fax claim after OCR; skipping write', fax.id);
        continue;
      }

      const ocrText = ocr?.full_text || '';
      const updates: Record<string, unknown> = {
        processing_status: 'completed',
        claimed_by: null,
        claimed_at: null,
        ocr_text: ocrText.slice(0, 50000),
        ai_summary: ocr?.summary || null,
        extracted_info: {
          patient_name: ocr?.patient_name || null,
          patient_dob: ocr?.patient_dob || null,
          provider_name: ocr?.provider_name || null,
        },
      };

      const match = bestFaxBackMatch({ ocrText, senderNumber: fax.sender_fax_number || '' }, candidates);
      if (match) {
        const cand = match.candidate as Record<string, unknown>;
        const referral = cand.referral as Record<string, unknown>;
        const fu = referral.follow_up_requests as Record<string, unknown>;
        const signalNames = Object.entries(match.signals as Record<string, boolean>)
          .filter(([, v]) => v)
          .map(([k]) => k);

        if (match.confident) {
          // Auto-attach AND auto-ingest: extract the provider's per-item
          // answers from the completed form against the request's OPEN items.
          // Conservative: only clearly-answered items flip open → 'answered'
          // (with the response text and source 'fax'); RESOLVING each item —
          // verifying the answer suffices — remains a human action, and a
          // failed extraction still attaches the fax exactly as before.
          let mergedItems = fu.items as Array<Record<string, unknown>> | undefined;
          let autoAnswered = 0;
          const openItems = (Array.isArray(fu.items) ? (fu.items as Array<Record<string, unknown>>) : [])
            .filter((it) => it && it.id && (!it.item_status || it.item_status === 'open'))
            .map((it) => {
              // Coerce to strings so the prompt can never render
              // "Question: undefined" for an item missing either field.
              const q = (it.provider_request as Record<string, unknown> | undefined)?.question ?? it.needed;
              return {
                id: it.id,
                title: typeof it.title === 'string' ? it.title : '',
                question: typeof q === 'string' ? q : '',
              };
            });
          if (openItems.length > 0) {
            try {
              const extraction = await base44.asServiceRole.integrations.Core.InvokeLLM({
                model: 'automatic',
                prompt: `This is the transcribed text of a provider's completed "Additional Information Request" fax-back form. For each requested item below, determine whether the provider ANSWERED it on this form, and transcribe their response verbatim (typed or handwritten; include "document attached" checkbox marks as the response when checked). Do NOT invent answers: if an item's response area is blank or illegible, mark it unanswered.\n\nREQUESTED ITEMS:\n${openItems
                  .map((it, i) => `${i + 1}. id: ${it.id}\n   ${it.title || String(it.id)}${it.question ? `\n   Question: ${it.question}` : ''}`)
                  .join('\n')}\n\nFAX TEXT:\n${ocrText.slice(0, 30000)}`,
                response_json_schema: {
                  type: 'object',
                  properties: {
                    answers: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          id: { type: 'string' },
                          answered: { type: 'boolean' },
                          response_text: { type: 'string' },
                        },
                      },
                    },
                  },
                },
              });
              const merged = applyFaxAnswersToItems(
                fu.items as Array<Record<string, unknown>>,
                (extraction?.answers as Array<Record<string, unknown>>) || [],
              );
              mergedItems = merged.items;
              autoAnswered = merged.answeredCount;
            } catch (extractErr) {
              console.error('Fax-back item extraction failed (attaching without answers):', extractErr?.message);
            }
          }
          await base44.asServiceRole.entities.Referral.update(referral.id as string, {
            follow_up_requests: {
              ...fu,
              ...(mergedItems ? { items: mergedItems } : {}),
              status: 'received',
              received_at: new Date().toISOString(),
              fax_back: {
                incoming_fax_id: fax.id,
                document_url: fax.document_url,
                matched_signals: signalNames,
                auto_answered_count: autoAnswered,
              },
            },
          }).catch((err) => console.error('Fax-back attach failed:', err?.message));
          updates.status = 'routed';
          updates.routed_at = new Date().toISOString();
          updates.routed_to = `ReferralFollowUp:${referral.id}`;
          updates.suggested_patient_id = referral.patient_id || null;
          // ai_category is an ENUM (see IncomingFax.jsonc) — a fax-back is
          // referral correspondence; the specifics live in `notes` (free text).
          updates.ai_category = 'referral';
          updates.notes = `Auto-matched to the follow-up request for ${cand.patientName || 'unknown patient'} (referral ${referral.id}; signals: ${signalNames.join(', ')}).`;
          // confidence_score is documented 0-100; signals max out at 5.
          updates.confidence_score = Math.min(100, match.score * 20);
          matched += 1;
          if (referral.created_by) {
            await base44.asServiceRole.entities.Notification.create({
              user_email: referral.created_by,
              title: '📠 Provider faxed back a follow-up response',
              message: `An inbound fax was matched to the information request for ${cand.patientName || 'a referral'} (signals: ${signalNames.join(', ')}). ${autoAnswered > 0 ? `${autoAnswered} item(s) were auto-marked answered from the form — verify the responses and resolve them.` : 'Review the document and mark items resolved.'}`,
              type: 'info',
              priority: 'medium',
              metadata: { related_entity: 'Referral', related_entity_id: referral.id },
              is_read: false,
              action_url: `/ReferralFollowUp?id=${referral.id}`,
            }).catch(() => {});
          }
        } else {
          // Suggestion only — a human confirms before anything attaches.
          // suggested_routing is an ENUM queue value; the descriptive
          // suggestion goes in `notes` (free text) so review staff see it.
          updates.suggested_routing = 'admin';
          updates.notes = `Possible fax-back for ${cand.patientName || 'unknown patient'} (referral ${referral.id}; signals: ${signalNames.join(', ')}${match.tied ? '; AMBIGUOUS - multiple referrals matched' : ''}). Review and attach manually if correct.`;
          updates.confidence_score = Math.min(100, match.score * 20);
          if (referral.created_by) {
            await base44.asServiceRole.entities.Notification.create({
              user_email: referral.created_by,
              title: '📠 Inbound fax may answer a follow-up request',
              message: `An inbound fax loosely matches the information request for ${cand.patientName || 'a referral'} — please review and attach manually if correct.`,
              type: 'info',
              priority: 'medium',
              metadata: { related_entity: 'IncomingFax', related_entity_id: fax.id },
              is_read: false,
              action_url: `/ReferralFollowUp?id=${referral.id}`,
            }).catch(() => {});
          }
        }
      }

      await base44.asServiceRole.entities.IncomingFax.update(fax.id, updates).catch((err) =>
        console.error('IncomingFax update failed:', err?.message)
      );
      processed += 1;
    }

    return Response.json({ success: true, processed, matched });
  } catch (error) {
    console.error('processInboundFaxes error:', error);
    return Response.json({ error: 'Inbound fax processing failed' }, { status: 500 });
  }
});
