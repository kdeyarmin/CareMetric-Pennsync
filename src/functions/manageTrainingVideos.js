import { base44 } from '@/api/base44Client';

// Admin tool for making / enhancing HeyGen presenter videos on course modules.
// action: 'status' (poll + list), 'start' / 'regenerate' (kick off jobs).
export const manageTrainingVideos = (payload = {}) =>
  base44.functions.invoke('manageTrainingVideos', payload);
