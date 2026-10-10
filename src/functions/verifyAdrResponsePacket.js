import { base44 } from '@/api/base44Client';
import protectedAiRequest from '@/lib/protectedAiRequest';

// The server loads the case's packet and checklist and owns the prompt.
export const verifyAdrResponsePacket = payload =>
  protectedAiRequest(() => base44.functions.invoke('verifyAdrResponsePacket', payload));
