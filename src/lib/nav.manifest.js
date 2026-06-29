/**
 * nav.manifest.js — Single source of truth for app navigation.
 *
 * Each entry drives three consumers:
 *  1. Sidebar / mobile nav  (Layout.jsx  → navCategories / adminItems)
 *  2. Breadcrumb trails     (Breadcrumbs.jsx)
 *  3. Command palette       (CommandPalette.jsx  — Ctrl/Cmd+K)
 *
 * Schema:
 *  page             – matches a page file in src/pages, routed via src/routes.jsx
 *  label            – human-readable name used in breadcrumbs & palette
 *  navLabel         – shorter sidebar label (falls back to label when omitted)
 *  icon             – Lucide icon component
 *  category         – sidebar section heading; null = not in sidebar
 *  adminOnly        – hide from nurses (visible to facility admins + super admin)
 *  superAdminOnly   – platform-level page: hide from facility admins too
 *                     (visible to the super admin only). Implies adminOnly.
 *  breadcrumbParent – page key of the logical parent (builds the crumb chain)
 *  keywords         – extra search terms for the command palette
 *  badge            – runtime badge key resolved in Layout: "messages" | "sms" | "notifications" | "timeOffApprovals"
 *  action           – runtime action key resolved in Layout: "openNotifications"
 *
 * Adding a new page: add ONE entry here — sidebar, breadcrumbs and palette all update.
 */

import {
  Home, Users, FileText, ClipboardList, Shield, GraduationCap,
  BarChart3, Settings, Brain, Target, Bell, BookOpen, WifiOff,
  Mail, BookUser, Video, HelpCircle, AlertTriangle,
  Phone, Send, Heart, Database, Lock, Award,
  Clipboard, Filter, Globe,
  Monitor, PieChart, Radio, Search, TrendingUp, Upload, UserCheck, Zap, Pen, CalendarDays, ShieldAlert, ShieldCheck
} from "lucide-react";

import { PAGE_NAMES, REDIRECTS } from "@/routes";

/**
 * The manifest.  Order within the same category determines sidebar order.
 * Non-sidebar pages (category: null) still provide breadcrumb + palette data.
 */
export const NAV_MANIFEST = [
  // ─── Overview ───────────────────────────────────────────────────────────────
  {
    page: "Dashboard",
    label: "Dashboard",
    icon: Home,
    category: "Overview",
    adminOnly: false,
    breadcrumbParent: null,
    keywords: ["home", "main", "overview", "welcome"],
  },

  // ─── Patient Care ────────────────────────────────────────────────────────────
  {
    page: "Patients",
    label: "Patients",
    icon: Users,
    category: "Patient Care",
    adminOnly: false,
    breadcrumbParent: null,
    keywords: ["roster", "directory", "list", "census"],
  },
  {
    page: "PatientDetails",
    label: "Patient Details",
    icon: Users,
    category: null,
    adminOnly: false,
    breadcrumbParent: "Patients",
    keywords: ["record", "chart", "profile"],
  },
  {
    page: "PatientAlerts",
    label: "Patient Alerts",
    icon: AlertTriangle,
    category: null,
    adminOnly: false,
    breadcrumbParent: "Patients",
    keywords: ["alert", "warning", "notification"],
  },
  {
    page: "PatientRecordDashboard",
    label: "Patient Record Dashboard",
    icon: Clipboard,
    category: null,
    adminOnly: false,
    breadcrumbParent: "Patients",
    keywords: ["record", "patient dashboard"],
  },
  {
    page: "DuplicatePatients",
    label: "Duplicate Patients",
    icon: Users,
    category: null,
    adminOnly: true,
    breadcrumbParent: "Patients",
    keywords: ["duplicate", "merge", "deduplicate"],
  },
  {
    page: "CarePlanManagement",
    label: "Care Plans",
    icon: Target,
    category: "Patient Care",
    adminOnly: false,
    breadcrumbParent: null,
    keywords: ["care plan", "goals", "treatment plan"],
  },
  {
    page: "CarePlanBuilder",
    label: "Care Plan Builder",
    icon: Target,
    category: null,
    adminOnly: false,
    breadcrumbParent: "CarePlanManagement",
    keywords: ["care plan", "builder", "create"],
  },
  {
    page: "AutomaticCarePlans",
    label: "Automatic Care Plans",
    icon: Zap,
    category: null,
    adminOnly: false,
    breadcrumbParent: "CarePlanManagement",
    keywords: ["auto care plan", "ai care plan"],
  },
  {
    // Hub combining OASIS assessment entry (SmartOASISAssessment, the default
    // "Assessment" tab) with the former OASIS Analyzer / Review / Clinical /
    // Compliance / Documentation / Revenue / Analytics / Audit pages as tabs
    // (?tab=…). SmartOASISAssessment has no standalone manifest entry — it is the
    // Assessment tab here, and /SmartOASISAssessment redirects in (see routes.jsx).
    page: "OASISCenter",
    label: "OASIS Center",
    icon: ClipboardList,
    category: "Patient Care",
    adminOnly: false,
    breadcrumbParent: null,
    keywords: ["oasis", "assessment", "hha", "complete", "review", "analyze", "compliance", "documentation", "revenue", "audit", "analytics", "pdgm"],
  },
  {
    page: "Incidents",
    label: "Incidents",
    icon: AlertTriangle,
    category: "Patient Care",
    adminOnly: false,
    breadcrumbParent: null,
    keywords: ["incident", "report", "safety", "event"],
  },
  {
    page: "IncidentReportingModule",
    label: "Incident Module",
    icon: AlertTriangle,
    category: null,
    adminOnly: false,
    breadcrumbParent: "Incidents",
    keywords: ["incident", "module"],
  },
  {
    page: "PatientEducationHub",
    label: "Patient Education",
    icon: Heart,
    category: "Patient Care",
    adminOnly: false,
    breadcrumbParent: null,
    keywords: ["patient education", "handout", "teaching"],
  },
  // ─── Documentation ───────────────────────────────────────────────────────────
  // Sidebar order follows the visit lifecycle: intake → chart the visit →
  // note tools → document repository.
  {
    // Office is an admin/back-office section, deliberately hidden from nurses to
    // keep their view focused on clinical work.
    page: "ReferralIntake",
    label: "Referrals",
    icon: FileText,
    category: "Office",
    adminOnly: true,
    breadcrumbParent: null,
    keywords: ["referral", "intake", "admission", "office"],
  },
  {
    // Admin-only incident review queue — staff report on /Incidents, admins
    // triage and resolve here. Lives in the back-office Office section.
    page: "IncidentReview",
    label: "Incident Review",
    icon: ShieldAlert,
    category: "Office",
    adminOnly: true,
    breadcrumbParent: "Incidents",
    keywords: ["incident", "review", "queue", "approve", "acknowledge", "resolve", "office", "state reportable"],
  },
  {
    page: "ClinicalDocumentation",
    label: "Clinical Notes",
    icon: Brain,
    category: "Documentation",
    adminOnly: false,
    breadcrumbParent: null,
    // Documenting a visit is a two-choice flow here: Smart Note or Visit Scribe
    // (record/upload or live dictation). Keep the audio/scribe keywords so search
    // still surfaces this hub for "scribe", "voice", "record audio", etc.
    keywords: ["clinical", "documentation", "notes", "charting", "smart note", "visit scribe", "dictation", "scribe", "voice", "visit", "record", "audio", "upload"],
  },
  {
    // Smart Notes is the default tab *inside* the Clinical Notes hub
    // (ClinicalDocumentation), so it is not a separate sidebar entry — but it
    // stays routed + searchable and remains the mobile bottom-nav "Notes" shortcut.
    page: "SmartNoteAssistant",
    label: "Smart Notes",
    icon: Brain,
    category: null,
    adminOnly: false,
    breadcrumbParent: "ClinicalDocumentation",
    keywords: ["smart note", "ai note", "documentation", "ai"],
  },
  // NOTE: Visit Scribe was folded into the Clinical Notes hub as the "Visit Scribe"
  // choice (Record / Upload + Live Dictation sub-modes), so /VisitScribe redirects
  // to /ClinicalDocumentation?tab=visit-scribe (see REDIRECTS in src/routes.jsx).
  {
    // Documents is an admin back-office workspace (e-signing, scan & mark
    // signature fields, multi-document packets, audit logs) — lives in the Office
    // section and is hidden from the nurse view.
    page: "DocumentHub",
    label: "Documents & E-Signing",
    navLabel: "Documents",
    icon: Pen,
    category: "Office",
    adminOnly: true,
    breadcrumbParent: null,
    keywords: ["documents", "files", "hub", "e-sign", "esign", "signature", "sign", "scan", "packet", "package", "office"],
  },
  {
    page: "EventReport",
    label: "Event Report",
    icon: FileText,
    category: null,
    adminOnly: false,
    breadcrumbParent: "Incidents",
    keywords: ["event", "report", "incident report"],
  },
  {
    page: "ReferralTriage",
    label: "Referral Triage",
    icon: Filter,
    category: null,
    adminOnly: false,
    breadcrumbParent: "ReferralIntake",
    keywords: ["referral", "triage", "priority"],
  },
  {
    page: "SignDocument",
    label: "Sign Document",
    icon: Pen,
    category: null,
    adminOnly: false,
    breadcrumbParent: "DocumentHub",
    keywords: ["sign", "signature"],
  },

  // ─── Communication ───────────────────────────────────────────────────────────
  {
    page: "Messages",
    label: "Messages",
    icon: Mail,
    category: "Communication",
    adminOnly: false,
    breadcrumbParent: null,
    keywords: ["messages", "inbox", "chat", "email"],
    badge: "messages",
  },
  {
    page: "PhoneCenter",
    label: "Phone Center",
    icon: Phone,
    category: "Communication",
    adminOnly: false,
    breadcrumbParent: null,
    keywords: ["phone", "call", "sms", "text"],
    badge: "sms",
  },
  {
    page: "SendFax",
    label: "Fax",
    icon: Send,
    category: "Communication",
    adminOnly: false,
    breadcrumbParent: null,
    keywords: ["fax", "send fax"],
  },
  {
    page: "PhysicianDirectory",
    label: "Providers",
    navLabel: "Providers",
    icon: BookUser,
    category: "Communication",
    adminOnly: false,
    breadcrumbParent: null,
    keywords: ["physician", "provider", "doctor", "directory"],
  },
  {
    page: "Telehealth",
    label: "Telehealth",
    icon: Video,
    category: "Communication",
    adminOnly: false,
    breadcrumbParent: null,
    keywords: ["telehealth", "video", "call", "virtual visit"],
  },

  // ─── PDF / Templates ─────────────────────────────────────────────────────────
  {
    page: "PDFTools",
    label: "PDF Tools",
    icon: FileText,
    category: null,
    adminOnly: false,
    breadcrumbParent: "DocumentHub",
    keywords: ["pdf", "tools"],
  },
  {
    page: "PDFSearch",
    label: "PDF Search",
    icon: Search,
    category: null,
    adminOnly: false,
    breadcrumbParent: "DocumentHub",
    keywords: ["pdf", "search"],
  },
  {
    page: "TemplateLibrary",
    label: "Template Library",
    icon: FileText,
    category: null,
    adminOnly: false,
    breadcrumbParent: "DocumentHub",
    keywords: ["template", "library"],
  },
  {
    page: "TemplateManagement",
    label: "Template Management",
    icon: FileText,
    category: null,
    // Route open to all; the document-template CRUD tab is admin-gated in-page
    // while the PDF Templates tab stays reachable to non-admins (the retired
    // /PDFTemplateLibrary route this absorbed was non-admin).
    adminOnly: false,
    breadcrumbParent: "DocumentHub",
    keywords: ["template", "management"],
  },

  // ─── Learning & Resources: reference library ─────────────────────────────────
  {
    page: "ResourceLibrary",
    label: "Library",
    icon: BookOpen,
    category: "Learning & Resources",
    adminOnly: false,
    breadcrumbParent: null,
    keywords: ["library", "resources", "guidelines", "reference"],
  },
  {
    page: "ClinicalLibrary",
    label: "Clinical Library",
    icon: BookOpen,
    category: null,
    adminOnly: false,
    breadcrumbParent: "ResourceLibrary",
    keywords: ["clinical library", "reference"],
  },
  {
    page: "MedicareGuidelinesLibrary",
    label: "Medicare Guidelines",
    icon: BookOpen,
    category: null,
    adminOnly: false,
    breadcrumbParent: "ResourceLibrary",
    keywords: ["medicare", "guidelines", "library"],
  },
  {
    page: "UserGuides",
    label: "User Guides",
    icon: BookOpen,
    category: null,
    adminOnly: false,
    breadcrumbParent: "Help",
    keywords: ["guide", "user guide", "help"],
  },

  // ─── Learning & Resources: training ──────────────────────────────────────────
  {
    page: "LearningCenter",
    label: "Learning Center",
    icon: GraduationCap,
    category: "Learning & Resources",
    adminOnly: false,
    breadcrumbParent: null,
    keywords: ["learning", "courses", "catalog", "browse", "education", "my courses", "in-services", "annual education", "transcripts", "training", "progress", "certificates", "competencies"],
  },
  {
    page: "TrainingCoursePlayer",
    label: "Course Player",
    icon: GraduationCap,
    category: null,
    adminOnly: false,
    breadcrumbParent: "LearningCenter",
    keywords: ["course", "player", "training", "video"],
  },
  {
    page: "LearningReports",
    label: "Learning Reports",
    icon: BarChart3,
    category: null,
    adminOnly: true,
    breadcrumbParent: "LearningCenter",
    keywords: ["learning", "reports", "training analytics"],
  },
  {
    page: "EducationLibrary",
    label: "Education Library",
    icon: BookOpen,
    category: null,
    adminOnly: false,
    breadcrumbParent: "LearningCenter",
    keywords: ["education", "library", "courses"],
  },
  {
    page: "NurseTrainingHub",
    label: "Nurse Training Hub",
    icon: GraduationCap,
    category: null,
    adminOnly: false,
    breadcrumbParent: "LearningCenter",
    keywords: ["nurse", "training", "hub"],
  },
  {
    page: "AITrainingGenerator",
    label: "AI Training Generator",
    icon: Brain,
    category: null,
    adminOnly: true,
    breadcrumbParent: "LearningCenter",
    keywords: ["ai", "training", "generator", "content"],
  },
  {
    page: "AIComplianceInServices",
    label: "AI Compliance In-Services",
    icon: Brain,
    category: null,
    adminOnly: true,
    breadcrumbParent: "LearningCenter",
    keywords: ["ai", "compliance", "in-service", "training"],
  },

  // ─── Compliance ───────────────────────────────────────────────────────────────
  // NOTE: MedicareComplianceDashboard is intentionally absent — its audit metrics
  // duplicate the Compliance Center, so /MedicareComplianceDashboard redirects
  // there (see REDIRECTS in src/routes.jsx).
  // NOTE: ComplianceRegulatory was a thin wrapper that merely composed
  // RealTimeComplianceDashboard + RegulatoryCompliance (both reachable from the
  // Compliance Center). Its name also collided with RegulatoryCompliance, so it
  // now redirects to /ComplianceCenter (see REDIRECTS in src/routes.jsx).

  // ─── Administration (single slim sidebar section) ────────────────────────────
  // The sidebar deliberately surfaces only the handful of daily-use admin
  // destinations (Admin Console, Users, Reports & Analytics, Compliance Center).
  // Every other admin tool is set category: null — it stays routed and is reached
  // through the Admin Console launchpad (AdminConsoleDirectory) and ⌘K palette,
  // rather than re-listing the whole admin surface in the sidebar.
  {
    page: "AdminOperations",
    label: "Admin Console",
    navLabel: "Admin Console",
    icon: BarChart3,
    category: "Administration",
    adminOnly: true,
    breadcrumbParent: null,
    keywords: ["admin", "console", "operations", "manage", "control", "command center", "tools"],
  },
  {
    page: "SuperAdminConfig",
    label: "Super Admin",
    navLabel: "Super Admin",
    icon: Lock,
    // Owner-only, rarely touched — reached via the Admin Console, not the sidebar.
    category: null,
    adminOnly: true,
    superAdminOnly: true,
    breadcrumbParent: "AdminOperations",
    keywords: ["super admin", "telnyx", "api secret", "integration", "provisioning", "phone setup", "owner"],
  },
  {
    page: "UserManagement",
    label: "Users",
    icon: Users,
    category: "Administration",
    adminOnly: true,
    breadcrumbParent: "AdminOperations",
    keywords: ["users", "accounts", "roles", "staff"],
  },
  {
    page: "AdminUserSetup",
    label: "User Setup",
    icon: UserCheck,
    category: null,
    adminOnly: true,
    breadcrumbParent: "UserManagement",
    keywords: ["user setup", "onboarding", "admin"],
  },
  {
    page: "AdminTraining",
    label: "Training Manager",
    icon: GraduationCap,
    // Reached via Admin Console → Training & Education.
    category: null,
    adminOnly: true,
    breadcrumbParent: "AdminOperations",
    keywords: ["training manager", "assign training", "admin training"],
  },
  // NOTE: TrainingManagement was a strict subset of AdminTraining (same Course /
  // Learning-Plan / In-Service managers), so /TrainingManagement redirects to
  // /AdminTraining (see REDIRECTS in src/routes.jsx).
  {
    page: "AdminTrainingAnalytics",
    label: "Training Analytics",
    icon: BarChart3,
    category: null,
    adminOnly: true,
    breadcrumbParent: "AdminTraining",
    keywords: ["training", "analytics", "reports"],
  },
  {
    page: "ManagerSkillGapDashboard",
    label: "Skill Gap Dashboard",
    icon: BarChart3,
    category: null,
    adminOnly: true,
    breadcrumbParent: "AdminTraining",
    keywords: ["skill gap", "training gap", "competency"],
  },
  {
    // Reached from the Admin Console directory ("Users & Staff") and the command
    // palette. category is null so it stays out of the sidebar (buildAdminItems
    // emits only the single Administration section).
    page: "NursePerformanceDashboard",
    label: "Nurse Performance",
    icon: TrendingUp,
    category: null,
    adminOnly: true,
    breadcrumbParent: "AdminOperations",
    keywords: ["nurse", "performance", "metrics"],
  },
  {
    page: "CredentialCompliance",
    label: "Credential Compliance",
    icon: Award,
    category: null,
    adminOnly: true,
    breadcrumbParent: "UserManagement",
    keywords: ["credential", "license", "compliance", "expiration", "staff", "personnel"],
  },
  {
    page: "ClinicalPathwayManager",
    label: "Clinical Pathways",
    icon: ClipboardList,
    // Reached via Admin Console → Clinical Oversight.
    category: null,
    adminOnly: true,
    breadcrumbParent: "AdminOperations",
    keywords: ["pathways", "clinical pathways", "protocols"],
  },
  {
    page: "CommsDashboard",
    label: "Communications",
    navLabel: "Comms",
    icon: Radio,
    // Platform telephony delivery (Telnyx) — super admin only.
    category: null,
    adminOnly: true,
    superAdminOnly: true,
    breadcrumbParent: "AdminOperations",
    keywords: ["sms", "calls", "fax", "telnyx", "phone", "delivery"],
  },
  {
    page: "PatientDataManagement",
    label: "Data Management",
    icon: Database,
    // Reached via Admin Console → Data & Documents.
    category: null,
    adminOnly: true,
    breadcrumbParent: "AdminOperations",
    keywords: ["data", "management", "import", "patients"],
  },
  // NOTE: DataQualityMonitor was a one-component wrapper around the same
  // DataQualityDashboard that is already the Admin Console "Data Quality" tab, so
  // /DataQualityMonitor redirects to /AdminOperations?tab=data-quality.
  {
    page: "BulkDischargeImport",
    label: "Bulk Discharge Import",
    icon: Upload,
    category: null,
    adminOnly: true,
    breadcrumbParent: "PatientDataManagement",
    keywords: ["discharge", "import", "bulk", "upload", "batch"],
  },
  {
    page: "UserActivityReport",
    label: "User Activity Report",
    icon: BarChart3,
    category: null,
    adminOnly: true,
    breadcrumbParent: "AdminOperations",
    keywords: ["activity", "report", "users"],
  },
  {
    page: "PersonnelFile",
    label: "Personnel File",
    icon: Users,
    category: null,
    adminOnly: true,
    breadcrumbParent: "UserManagement",
    keywords: ["personnel", "file", "employee", "hr"],
  },
  // ─── Analytics ────────────────────────────────────────────────────────────────
  {
    page: "ReportsAnalytics",
    label: "Reports & Analytics",
    icon: BarChart3,
    category: "Administration",
    adminOnly: true,
    breadcrumbParent: null,
    keywords: ["reports", "analytics", "metrics", "export", "data", "performance dashboard", "documentation time", "ai utilization", "quality score"],
  },
  {
    page: "AgencyAnalytics",
    label: "Agency Analytics",
    icon: BarChart3,
    category: null,
    adminOnly: true,
    breadcrumbParent: "ReportsAnalytics",
    keywords: ["agency", "analytics", "metrics"],
  },
  {
    page: "PredictiveAnalytics",
    label: "Predictive Analytics",
    icon: TrendingUp,
    category: null,
    adminOnly: true,
    breadcrumbParent: "ReportsAnalytics",
    keywords: ["predictive", "analytics", "ai", "forecast"],
  },

  // ─── Compliance Center (Admin Analytics) ─────────────────────────────────────
  {
    page: "ComplianceCenter",
    label: "Compliance Center",
    icon: Shield,
    category: "Administration",
    adminOnly: true,
    breadcrumbParent: null,
    keywords: ["compliance", "audit", "quality", "metrics"],
  },

  // ─── System / Admin Config ───────────────────────────────────────────────────
  // NOTE: The retired SystemMonitoring (a User Activity + Jobs wrapper) and
  // SystemHealthMonitor (a System Health panel duplicate) are consolidated — User
  // Activity and System Health are Admin Console tabs (see /AdminOperations?tab=…
  // in REDIRECTS), and the job monitor stays its own page below. SystemMonitoring
  // redirects here, to the job monitor.
  {
    page: "SystemJobMonitor",
    label: "Background Jobs",
    icon: Monitor,
    // Platform-level scheduled jobs — super admin only.
    category: null,
    adminOnly: true,
    superAdminOnly: true,
    breadcrumbParent: "AdminOperations",
    keywords: ["system", "jobs", "monitor", "background", "scheduled", "tasks", "system monitoring"],
  },
  {
    page: "AgencySettings",
    label: "Agency Settings",
    icon: Settings,
    // Reached via Admin Console → System & Configuration.
    category: null,
    adminOnly: true,
    breadcrumbParent: "AdminOperations",
    keywords: ["agency", "settings", "configuration"],
  },
  {
    page: "PDGMRateSettings",
    label: "PDGM Rate Settings",
    icon: PieChart,
    // Reached via Admin Console → System & Configuration.
    category: null,
    adminOnly: true,
    breadcrumbParent: "AdminOperations",
    keywords: ["pdgm", "case mix", "case-mix", "weights", "rates", "reimbursement", "billing", "cms"],
  },
  {
    page: "AIToolsCenter",
    label: "AI Tools",
    icon: Brain,
    // Platform AI / OCR configuration — super admin only.
    category: null,
    adminOnly: true,
    superAdminOnly: true,
    breadcrumbParent: "AdminOperations",
    keywords: ["ai", "tools", "auto-tag", "tagger", "ocr", "training", "feedback", "automation"],
  },

  // ─── Tools / Settings ────────────────────────────────────────────────────────
  {
    page: "UserSettings",
    label: "Settings",
    icon: Settings,
    category: "Tools",
    adminOnly: false,
    breadcrumbParent: null,
    keywords: ["settings", "preferences", "profile", "account"],
  },
  {
    page: "NotificationSettings",
    label: "Notification Settings",
    icon: Bell,
    category: null,
    adminOnly: false,
    breadcrumbParent: "UserSettings",
    keywords: ["notifications", "settings", "alerts"],
  },
  {
    page: "TimeOff",
    label: "Time Off",
    icon: CalendarDays,
    category: "Tools",
    adminOnly: false,
    breadcrumbParent: null,
    keywords: ["time off", "pto", "leave", "vacation", "request", "schedule"],
    badge: "timeOffApprovals",
  },
  {
    // All users can view the on-call schedule; only admins can enter/edit it
    // (enforced in-page and by OnCallShift RLS write rules).
    page: "OnCallSchedule",
    label: "On-Call Schedule",
    navLabel: "On-Call",
    icon: ShieldCheck,
    category: "Tools",
    adminOnly: false,
    breadcrumbParent: null,
    keywords: ["on call", "on-call", "call schedule", "coverage", "holiday", "overnight", "rotation"],
  },
  {
    page: "OfflineMode",
    label: "Offline Mode",
    icon: WifiOff,
    category: "Tools",
    adminOnly: false,
    breadcrumbParent: null,
    keywords: ["offline", "sync", "cache"],
  },
  {
    page: "Help",
    label: "Help",
    icon: HelpCircle,
    category: "Tools",
    adminOnly: false,
    breadcrumbParent: null,
    keywords: ["help", "support", "guide", "faq"],
  },
  {
    page: "Features",
    label: "Features",
    icon: Zap,
    category: null,
    adminOnly: false,
    breadcrumbParent: null,
    keywords: ["features", "what's new", "changelog"],
  },
  {
    page: "About",
    label: "About",
    icon: Globe,
    category: null,
    adminOnly: false,
    breadcrumbParent: null,
    keywords: ["about", "version", "info"],
  },
];

// ─── Derived helpers ───────────────────────────────────────────────────────────

/** Lookup map by page key */
export const NAV_MAP = Object.fromEntries(NAV_MANIFEST.map(e => [e.page, e]));

/**
 * Reachability set, derived from the real route table (src/routes.jsx).
 *
 * The manifest intentionally documents many pages (for breadcrumb labels and
 * search keywords) that aren't all routed. Surfacing an unrouted page as a
 * clickable destination sends the user to PageNotFound, so the sidebar and
 * command palette must only offer pages that actually render. Deriving this from
 * routes.jsx (instead of a hand-kept list) means the two can't drift: route a
 * page and it becomes navigable; unroute it and it drops out of nav automatically.
 */
/** True if navigating to this page renders something (direct route or redirect). */
export function isLinkablePage(page) {
  const routed = new Set(PAGE_NAMES);
  const redirected = new Set(REDIRECTS.map(r => r.from.replace(/^\//, "")));
  return routed.has(page) || redirected.has(page);
}

/**
 * Build sidebar navCategories array for non-admin users.
 * Dynamic badge values are injected by Layout after this call.
 */
export function buildNavCategories(manifest) {
  const categoryOrder = [
    "Overview", "Patient Care", "Documentation", "Communication",
    "Learning & Resources", "Tools",
  ];
  const map = {};
  const routed = new Set(PAGE_NAMES);
  for (const entry of manifest) {
    if (!entry.category || entry.adminOnly) continue;
    if (!routed.has(entry.page)) continue;  // never link to an unrouted page
    if (!map[entry.category]) map[entry.category] = [];
    map[entry.category].push({
      name: entry.navLabel ?? entry.label,
      icon: entry.icon,
      page: entry.page,
      badge: 0,          // placeholder; Layout fills in runtime values
      _badgeKey: entry.badge ?? null,
    });
  }
  return categoryOrder
    .filter(c => map[c])
    .map(c => ({ category: c, items: map[c] }));
}

/**
 * Build adminItems array (admin-only sidebar sections).
 * Dynamic badge/action values are injected by Layout after this call.
 *
 * `isSuperAdmin` controls whether superAdminOnly (platform-level) entries are
 * included — facility admins get the facility surface; the super admin gets all.
 */
export function buildAdminItems(manifest, isSuperAdmin = false) {
  // A single slim "Administration" section. The former Analytics / Configuration
  // sub-headings were folded in (and most of their items moved into the Admin
  // Console launchpad) to stop the sidebar from re-listing the whole admin
  // surface — see the Administration block in NAV_MANIFEST.
  const categoryOrder = ["Office", "Administration"];
  const map = {};
  const routed = new Set(PAGE_NAMES);
  for (const entry of manifest) {
    if (!entry.category || !entry.adminOnly) continue;
    if (entry.superAdminOnly && !isSuperAdmin) continue;  // platform-only pages
    if (!routed.has(entry.page)) continue;  // never link to an unrouted page
    if (!map[entry.category]) map[entry.category] = [];
    map[entry.category].push({
      name: entry.navLabel ?? entry.label,
      icon: entry.icon,
      page: entry.page,
      badge: 0,
      _badgeKey: entry.badge ?? null,
      _actionKey: entry.action ?? null,
    });
  }
  return categoryOrder
    .filter(c => map[c])
    .map(c => ({ category: c, items: map[c] }));
}

/**
 * Build the breadcrumb trail for a given page.
 * Returns an array of { label, page? } from outermost ancestor to the page itself.
 */
export function buildBreadcrumbs(pageName, navMap = NAV_MAP) {
  const trail = [];
  let current = navMap[pageName];
  if (!current) return trail;

  // Walk up the parent chain (cycle-safe, max 10 hops)
  const visited = new Set();
  let cursor = current;
  while (cursor && !visited.has(cursor.page)) {
    visited.add(cursor.page);
    trail.unshift(cursor);
    cursor = cursor.breadcrumbParent ? navMap[cursor.breadcrumbParent] : null;
  }

  // Build crumb objects — ancestors are links (but only when they actually
  // resolve to a page, so a crumb never dead-ends on PageNotFound); the last
  // crumb is always plain text.
  return trail.map((entry, i, arr) => ({
    label: entry.label,
    page: i < arr.length - 1 && isLinkablePage(entry.page) ? entry.page : undefined,
  }));
}

/**
 * Build the flat list used by CommandPalette, filtered by admin access and to
 * pages that are actually routed — so every palette result opens a real page
 * instead of dead-ending on PageNotFound. Redirect aliases are excluded to
 * avoid duplicate entries for the same destination.
 */
export function buildPaletteEntries(manifest, isAdmin, isSuperAdmin = false) {
  const routed = new Set(PAGE_NAMES);
  return manifest.filter(e => {
    if (!routed.has(e.page)) return false;
    if (e.superAdminOnly && !isSuperAdmin) return false;  // platform-only pages
    if (e.adminOnly && !isAdmin) return false;
    return true;
  });
}

/**
 * Whether a page should be REACHABLE for a given role view. Used by the route
 * guard so a facility admin (or nurse) can't open a higher-tier page by URL.
 * `roleView` is one of: 'super_admin' | 'facility_admin' | 'nurse'.
 */
export function isPageAllowedForRole(pageName, roleView) {
  const entry = NAV_MAP[pageName];
  if (!entry) return true; // unknown/derived pages aren't gated here
  if (entry.superAdminOnly) return roleView === "super_admin";
  if (entry.adminOnly) return roleView === "super_admin" || roleView === "facility_admin";
  return true;
}

/**
 * Group heading for a page in the command palette. Sub-pages have
 * `category: null` (so they stay out of the sidebar); rather than dump them all
 * under a generic "More", inherit the category of their nearest ancestor in the
 * breadcrumb chain — so e.g. "OASIS Audit" groups with "OASIS Assessment", and
 * "Fax Logs" groups under "Communication" with "Fax".
 */
export function paletteGroupFor(pageName, navMap = NAV_MAP) {
  let cursor = navMap[pageName];
  const visited = new Set();
  while (cursor && !visited.has(cursor.page)) {
    if (cursor.category) return cursor.category;
    visited.add(cursor.page);
    cursor = cursor.breadcrumbParent ? navMap[cursor.breadcrumbParent] : null;
  }
  return "More";
}