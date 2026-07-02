/** Utility helpers for realtime fax tracker filtering and presentation. */
export const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

export const filterRecentFaxLogs = (logs = [], now = Date.now(), rangeMs = TWENTY_FOUR_HOURS_MS) => {
  const cutoff = now - rangeMs;
  return logs.filter((log) => new Date(log.created_date).getTime() > cutoff);
};

// Equivalent statuses collapse into the same summary bucket: a successfully
// transmitted fax ('sent') counts as delivered, and an in-progress 'sending' fax
// counts as queued — otherwise both would fall through to 'pending'.
const STATUS_GROUP = { sent: 'delivered', sending: 'queued' };

export const getStatusCounts = (logs = []) => {
  const counts = { delivered: 0, failed: 0, pending: 0, queued: 0 };

  logs.forEach((log) => {
    const raw = log.status?.toLowerCase() || 'pending';
    const status = STATUS_GROUP[raw] || raw;
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
