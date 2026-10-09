import protectedAiRequest from '@/functions/protectedAiRequest';
export const analyzeAdrLetter = payload => protectedAiRequest('analyzeAdrLetter', payload, 120000);