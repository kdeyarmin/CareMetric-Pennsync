import base44 from "@base44/vite-plugin"
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { existsSync, readFileSync } from 'node:fs'

// The Base44 runtime delivers app secrets (VITE_BASE44_APP_ID,
// VITE_BASE44_BACKEND_URL, ...) to /run/base44/app.env — an out-of-repo file the
// dev server's launcher does not source. Load it into process.env here so Vite
// exposes the VITE_* values to the client via import.meta.env; without this the
// app renders its "Base44 app settings are missing" screen. Existing process.env
// values always win, so environments that inject these directly are unaffected,
// and the file is absent in production builds.
const base44EnvPath = '/run/base44/app.env'
if (existsSync(base44EnvPath)) {
  for (const line of readFileSync(base44EnvPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/)
    if (!m || m[1] in process.env) continue
    let v = m[2]
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    process.env[m[1]] = v
  }
}

// https://vite.dev/config/
export default defineConfig(({ command }) => ({
  logLevel: 'error', // Suppress warnings, only show errors
  // Production bundles must be relocatable: Base44/App Store installs can mount
  // the same build under arbitrary subpaths, so emitted JS/CSS/icon/manifest
  // URLs need to be relative instead of rooted at `/`. Dev stays root-based so
  // Vite's local server and HMR keep their normal behavior.
  base: command === 'build' ? './' : '/',
  // HIPAA: strip all console.* and debugger statements from PRODUCTION builds.
  // The app logs entities/responses/transcripts in many places, and anything left
  // in the shipped bundle executes in the clinician/patient browser (devtools,
  // extensions, error collectors) and leaks PHI. Dev (`command === 'serve'`)
  // keeps logs so local debugging is unaffected.
  esbuild: command === 'build' ? { drop: ['console', 'debugger'] } : {},
  build: {
    // Raise the warning threshold slightly — large lazy page chunks are
    // expected in this app — while we split the heaviest vendor libs below.
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        // Pull the heaviest leaf dependencies into their own cacheable chunks
        // so they are downloaded once and shared across the routes that use
        // them, instead of being duplicated into multiple lazy page bundles.
        // Everything else keeps Vite's default per-dynamic-import splitting.
        manualChunks(id) {
          if (!id.includes('node_modules')) return;
          if (id.includes('pdfjs-dist')) return 'vendor-pdfjs';
          if (id.includes('jspdf') || id.includes('html2canvas')) return 'vendor-pdf-export';
          if (id.includes('@telnyx/video')) return 'vendor-telnyx';
          if (id.includes('recharts') || id.includes('/d3-') || id.includes('victory-vendor')) return 'vendor-charts';
          if (id.includes('framer-motion')) return 'vendor-motion';
        },
      },
    },
  },
  server: {
    host: true,
    allowedHosts: true,
  },
  plugins: [
    base44({
      // Support for legacy code that imports the base44 SDK with @/integrations, @/entities, etc.
      // can be removed if the code has been updated to use the new SDK imports from @base44/sdk
      legacySDKImports: process.env.BASE44_LEGACY_SDK_IMPORTS === 'true'
    }),
    react(),
  ]
}));