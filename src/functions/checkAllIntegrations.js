import { base44 } from "@/api/base44Client";

// Thin wrapper over the checkAllIntegrations backend function so pages/components
// can call it like any other imported function.
export async function checkAllIntegrations(payload = {}) {
  return base44.functions.invoke("checkAllIntegrations", payload);
}