import { loadEnv } from 'vite'

// Base44's hosted Publish build does not run base44/config.jsonc's
// site.buildCommand, and the editor preview runs the dev server rather than a
// build, so the owner email assigned there never reached either one and the
// Super Admin navigation stayed hidden from the platform owner. Supply that
// same committed value for the owner's CareMetric apps when the environment
// leaves it unset.
//
// The app id is read from process.env AND from the project's .env files,
// because a builder can deliver it through a .env file that only Vite's own
// loadEnv sees — checking process.env alone silently skipped the owner email
// on exactly the builds this exists for.
//
// This is UI gating only: backend functions independently require Base44's
// protected admin role plus the backend SUPER_ADMIN_EMAIL setting, and any
// other app id still gets the fail-closed empty default in src/lib/superAdmin.js.
export const OWNER_SUPER_ADMIN_EMAIL = 'kdeyarmin@comcast.net'
export const OWNER_SUPER_ADMIN_APP_IDS = new Set([
  '694ec16e72e01b60d22f7cbf', // CareMetric AI (production)
  '6a9881683dc68a0bd54f1ef7', // caremetric-pennsync-staging-2026-09-02
])

const configured = (value) => typeof value === 'string' && value.trim() !== ''

/**
 * Decide the owner email for this Vite invocation. Returns the email to assign
 * to VITE_SUPER_ADMIN_EMAIL, or null to leave the environment alone.
 */
export function ownerSuperAdminEmailFor({ processEnv, fileEnv }) {
  if (configured(processEnv.VITE_SUPER_ADMIN_EMAIL)) return null
  if (configured(fileEnv.VITE_SUPER_ADMIN_EMAIL)) return null
  const appId = String(processEnv.VITE_BASE44_APP_ID || fileEnv.VITE_BASE44_APP_ID || '').trim()
  return OWNER_SUPER_ADMIN_APP_IDS.has(appId) ? OWNER_SUPER_ADMIN_EMAIL : null
}

export function withOwnerSuperAdminEmail(configFn, { root = process.cwd(), env = process.env } = {}) {
  return (configEnv) => {
    const fileEnv = loadEnv(configEnv.mode ?? 'development', root, 'VITE_')
    const email = ownerSuperAdminEmailFor({ processEnv: env, fileEnv })
    if (email) env.VITE_SUPER_ADMIN_EMAIL = email
    return configFn(configEnv)
  }
}
