/** Utility helpers for realtime fax tracker filtering and presentation. */
export const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

export const filterRecentFaxLogs = (logs = [], now = Date.now(), rangeMs = TWENTY_FOUR_HOURS_MS) => {
  const cutoff = now - rangeMs;
  return logs.filter((log) => new Date(log.created_date).getTime() > cutoff);
};

// Equivalent statuses collapse into the same summary bucket: a successfully
// transmitted fax ('sent') counts as delivered, and an in-progress 'sending' fax
// counts as queued — otherwise both would fall through to 'pending'. A fax
// mid-retry ('retrying') is in flight, so it counts as queued; a 'retried' fax
// is a failed attempt that was superseded by a new FaxLog row, so it counts as
// failed (the retry row reports its own outcome).
const STATUS_GROUP = { sent: 'delivered', sending: 'queued', retrying: 'queued', retried: 'failed' };

// Normalize a raw fax status to its canonical bucket so the row/detail display
// and the summary counts agree (a 'sent' fax reads/counts as delivered, a
// 'sending' fax as queued) instead of falling through to 'Pending'/'Unknown'.
export const normalizeStatus = (raw) => {
  const s = String(raw || '').toLowerCase() || 'pending';
  return STATUS_GROUP[s] || s;
};

export const getStatusCounts = (logs = []) => {
  const counts = { delivered: 0, failed: 0, pending: 0, queued: 0 };

  logs.forEach((log) => {
    const status = normalizeStatus(log.status);
    if (status in counts) {
      counts[status] += 1;
    } else {
      counts.pending += 1;
    }
  });

  return counts;
};

export const getRelativeTimeLabel = (createdDate, now = Date.now()) => {
  const diffMinutes = Math.floor((now - new Date(createdDate).getTime()) / 60000);

  if (diffMinutes < 1) return 'Just now';
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  if (diffMinutes < 1440) return `${Math.floor(diffMinutes / 60)}h ago`;
  return `${Math.floor(diffMinutes / 1440)}d ago`;
};
