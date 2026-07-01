# PennSync Manuals

Professionally branded, print-ready reference manuals for **PennSync by CareMetric**.
These are static files served from `/manuals/…` at runtime and linked from the in-app
**Help** and **User Guides** pages (the administrator manual is shown to administrators only).

| File | Audience | Contents |
|------|----------|----------|
| `PennSync-User-Manual.html` / `.pdf` | Clinical staff (nurses, social workers, spiritual care, therapists, aides) | Every feature clinical users work with, and how to use it. |
| `PennSync-Facility-Admin-Manual.html` / `.pdf` | Facility administrators | **Part I** is the complete User Manual; **Part II** adds the facility-administration tools. Super-admin (platform) tools are intentionally out of scope. |

- The **HTML** files are self-contained (brand font and logo are embedded) and print cleanly.
- The **PDF** files are rendered from the HTML and are the shareable/printable artifacts
  (running header/footer with page numbers, full-bleed navy cover).
- `assets/pennsync-logo.png` is the original app-icon logo; `assets/pennsync-logo-cropped.png`
  is the cover version (white margin removed, transparent rounded corners).

## Regenerating

The manuals are generated from the shared theme + content modules under `scripts/manuals/`.

```bash
# 1. (only if the source logo changed) re-crop the cover logo + refresh its data module
node scripts/manuals/crop-logo.mjs

# 2. build both manuals — writes the .html files and renders the .pdf files
node scripts/build-manuals.mjs          # HTML + PDF
node scripts/build-manuals.mjs --html   # HTML only (skip Chromium/PDF)
```

Source of truth:

| File | Purpose |
|------|---------|
| `scripts/manuals/theme.mjs` | Brand design system: CSS (navy + gold, embedded Inter font) and HTML builder helpers. |
| `scripts/manuals/content-user.mjs` | End-user manual sections (also reused as Part I of the admin manual). |
| `scripts/manuals/content-admin.mjs` | Facility-administrator sections (Part II). |
| `scripts/manuals/font.data.mjs` / `logo.data.mjs` | Base64 data-URI modules (Inter font, cover logo). |
| `scripts/build-manuals.mjs` | Assembles the HTML and renders each to PDF. |

**PDF rendering requirement:** PDF generation drives the pre-installed headless Chromium over
the DevTools protocol. It looks for the browser at `$CHROME_BIN`, then under
`$PLAYWRIGHT_BROWSERS_PATH` (default `/opt/pw-browsers`). If no Chromium is available, run with
`--html` to produce the HTML only. Editing the `.html` and using your browser's **Print → Save
as PDF** is always a fallback.
