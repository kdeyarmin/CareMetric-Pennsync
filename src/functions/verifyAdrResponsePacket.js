import protectedAiRequest from '@/functions/protectedAiRequest';
export const verifyAdrResponsePacket = payload => protectedAiRequest('verifyAdrResponsePacket', payload);