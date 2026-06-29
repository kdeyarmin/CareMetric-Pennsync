import base44 from "@base44/vite-plugin"
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig(({ command }) => ({
  logLevel: 'error', // Suppress warnings, only show errors
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
          if (id.includes('twilio-video')) return 'vendor-twilio';
          if (id.includes('recharts') || id.includes('/d3-') || id.includes('victory-vendor')) return 'vendor-charts';
          if (id.includes('framer-motion')) return 'vendor-motion';
        },
      },
    },
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