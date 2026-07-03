// Centralize the Base44 SDK deep import in one adapter. The SDK currently does
// not expose this axios-client helper from its public root API, but auth needs
// a raw client so incorrect-password responses can be handled inline without
// the SDK login helper forcing a logout redirect. Keeping the private import in
// one file makes future SDK path changes easy to audit.
export { createAxiosClient } from '@base44/sdk/dist/utils/axios-client';
