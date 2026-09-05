import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import JSON5 from 'json5';
import { describe, expect, it } from 'vitest';

const REPO_DIR = process.cwd();
const ADMIN = { user_condition: { role: 'admin' } };
const SERVICE_ROLE = { user_condition: { role: '__service_role_only__' } };
const ownerOrAdmin = (field) => ({
  $or: [
    { [`data.${field}`]: '{{user.email}}' },
    ADMIN,
  ],
});

const read = (relativePath) => readFileSync(join(REPO_DIR, relativePath), 'utf8');
const entity = (name) => JSON5.parse(read(`base44/entities/${name}.jsonc`));

function productionSources(root = 'src') {
  const files = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (/\.(?:js|jsx|ts|tsx|mjs)$/.test(entry.name) && !/\.(?:test|spec)\.[^.]+$/.test(entry.name)) {
        files.push(path);
      }
    }
  };
  visit(join(REPO_DIR, root));
  return files;
}

function directConsumers(name, operations = '(?:filter|list|get|create|update|delete)') {
  const pattern = new RegExp(`\\bentities\\.${name}\\s*\\.\\s*${operations}\\s*\\(`);
  return productionSources()
    .filter((path) => pattern.test(readFileSync(path, 'utf8')))
    .map((path) => path.slice(REPO_DIR.length + 1))
    .sort();
}

function sourcesContaining(fragment, excluded = []) {
  const exclusions = new Set(excluded);
  return productionSources()
    .map((path) => path.slice(REPO_DIR.length + 1))
    .filter((path) => !exclusions.has(path) && read(path).includes(fragment))
    .sort();
}

describe('residual RLS source containment', () => {
  it('keeps admin-only referral and compliance records behind protected routes', () => {
    for (const name of ['FaceToFaceEncounter', 'ComplianceRule']) {
      const rls = entity(name).rls;
      for (const operation of ['read', 'create', 'update']) {
        expect(rls[operation], `${name}.${operation}`).toEqual(ADMIN);
      }
      expect(rls.delete, `${name}.delete`).toBe(false);
    }

    expect(directConsumers('FaceToFaceEncounter')).toEqual(['src/pages/ReferralIntake.jsx']);
    expect(directConsumers('ComplianceRule')).toEqual(['src/components/compliance/RegulatoryMonitor.jsx']);

    const manifest = read('src/lib/nav.manifest.js');
    expect(manifest).toMatch(/page:\s*["']ReferralIntake["'][\s\S]{0,300}?adminOnly:\s*true/);
    expect(manifest).toMatch(/page:\s*["']ComplianceCenter["'][\s\S]{0,300}?adminOnly:\s*true/);
  });

  it('protects fax retry policy reads and keeps clinician retry transmission paused', () => {
    const faxRls = entity('FaxRetryConfig').rls;
    expect(faxRls.read).toEqual(ADMIN);
    expect(faxRls.create).toEqual(ADMIN);
    expect(faxRls.update).toEqual(ADMIN);
    expect(faxRls.delete).toBe(false);

    expect(directConsumers('FaxRetryConfig', '(?:create|update)')).toEqual([
      'src/components/admin/FaxRetryConfigPanel.jsx',
    ]);
    expect(sourcesContaining('fetchCallerFaxRetryConfig', ['src/lib/agencySettings.js']))
      .toEqual(['src/components/admin/FaxRetryConfigPanel.jsx']);

    const panel = read('src/components/admin/FaxRetryConfigPanel.jsx');
    expect(panel).toMatch(/const protectedAdmin\s*=\s*isAdminLike\(currentUser\)/);
    expect(panel).toMatch(/enabled:\s*protectedAdmin/);
    expect(panel).toMatch(/if \(isLoading \|\| !protectedAdmin\) return null/);

    const history = read('src/components/fax/EnhancedFaxHistory.jsx');
    expect(history).not.toMatch(/fetchCallerFaxRetryConfig|faxRetryConfig|retryFailedFax|retryMutation/);

    const retryHandler = read('base44/functions/retryFailedFax/entry.ts');
    expect(retryHandler).toMatch(/const FAX_TRANSMISSION_MIGRATION_PAUSED\s*=\s*true\s*;/);
    expect(retryHandler.indexOf('if (FAX_TRANSMISSION_MIGRATION_PAUSED)'))
      .toBeLessThan(retryHandler.indexOf('createClientFromRequest(req)'));
  });

  it('allows only protected admins to mutate shared Medicare configuration', () => {
    const rls = entity('MedicareComplianceRule').rls;
    expect(rls.read, 'MedicareComplianceRule.read remains an active shared-reader debt').toBe(true);
    expect(rls.create).toEqual(ADMIN);
    expect(rls.update).toEqual(ADMIN);
    expect(rls.delete).toBe(false);

    expect(directConsumers('MedicareComplianceRule', '(?:create|update)')).toEqual([
      'src/components/compliance/MedicareRuleSeeder.jsx',
    ]);

    const complianceCenter = read('src/pages/ComplianceCenter.jsx');
    expect(complianceCenter).toMatch(/\{isAdmin\s*&&\s*<MedicareRuleSeeder\s*\/>\}/);
  });

  it('narrows education creation without breaking shared care-team updates', () => {
    const assignments = entity('PatientEducationAssignment').rls;
    expect(assignments.read).toBe(true);
    expect(assignments.create).toEqual(ownerOrAdmin('assigned_by'));
    expect(assignments.update).toBe(true);
    expect(assignments.delete).toBe(false);

    const deliveries = entity('PatientEducationDelivery').rls;
    expect(deliveries).toEqual({ read: true, create: false, update: true, delete: false });
    expect(directConsumers('PatientEducationDelivery', 'create')).toEqual([]);
    expect(read('base44/functions/generatePatientEducation/entry.ts'))
      .toMatch(/asServiceRole\.entities\.PatientEducationDelivery\.create\s*\(/);

    const sent = entity('SentEducationMaterial').rls;
    expect(sent.read).toBe(true);
    expect(sent.create).toEqual(ownerOrAdmin('sent_by'));
    expect(sent.update).toBe(false);
    expect(sent.delete).toBe(false);
    expect(directConsumers('SentEducationMaterial', 'update')).toEqual([]);
  });

  it('stamps every remaining browser-created education record with the actor email', () => {
    const recommender = read('src/components/carePlan/AIEducationRecommender.jsx');
    const sender = read('src/components/education/PersonalizedMaterialSender.jsx');
    const portal = read('src/components/hub-tabs/PatientEducationPortal.jsx');

    expect(recommender).toMatch(/const assignedBy = \(await base44\.auth\.me\(\)\)\?\.email/);
    expect(recommender).toMatch(/if \(!assignedBy\)/);
    expect(recommender).toMatch(/assigned_by:\s*assignedBy/);
    expect(sender).toMatch(/if \(!currentUser\?\.email\)/);
    expect(sender).toMatch(/sent_by:\s*currentUser\.email/);
    expect(portal).toMatch(/if \(!deliveredBy\)/);
    expect(portal).toMatch(/delivered_by:\s*deliveredBy/);
  });

  it('fails every ClinicalPathway operation closed while all direct hosts remain literally paused', () => {
    expect(entity('ClinicalPathway').rls).toEqual({
      read: false,
      create: false,
      update: false,
      delete: false,
    });
    expect(directConsumers('ClinicalPathway')).toEqual([
      'src/components/clinical/AIPathwayGenerator.jsx',
      'src/components/clinical/AIPathwayUpdater.jsx',
      'src/components/oasis/AIPathwayRecommender.jsx',
      'src/components/oasis/ClinicalPathwayTrigger.jsx',
      'src/pages/ClinicalPathwayManager.jsx',
    ]);

    expect(read('src/pages/ClinicalPathwayManager.jsx'))
      .toMatch(/const CLINICAL_PATHWAY_MANAGER_ENABLED\s*=\s*false\s*;/);
    expect(read('src/components/hub-tabs/OASISAnalyzer.jsx'))
      .toMatch(/const OASIS_ANALYZER_ENABLED\s*=\s*false\s*;/);
    expect(read('src/components/hub-tabs/OASISClinicalReview.jsx'))
      .toMatch(/const OASIS_CLINICAL_AI_ENABLED\s*=\s*false\s*;/);
  });

  it('keeps AutomaticCarePlanTrigger private while care plans are quarantined', () => {
    const rls = entity('AutomaticCarePlanTrigger').rls;
    for (const operation of ['read', 'create', 'update', 'delete']) {
      expect(rls[operation], `AutomaticCarePlanTrigger.${operation}`).toBe(false);
    }
    expect(directConsumers('AutomaticCarePlanTrigger')).toEqual([]);

    const page = read('src/pages/AutomaticCarePlans.jsx');
    expect(page).toMatch(/<CarePlanUnavailable/);
    expect(page).not.toMatch(/\bbase44\b|useQuery|useMutation|entities\./);
  });

  it('scopes every MicroLearningProgress operation to the learner or protected admins', () => {
    const rls = entity('MicroLearningProgress').rls;
    for (const operation of ['read', 'create', 'update', 'delete']) {
      expect(rls[operation], `MicroLearningProgress.${operation}`)
        .toEqual(ownerOrAdmin('nurse_email'));
    }
    expect(directConsumers('MicroLearningProgress')).toEqual([
      'src/components/hub-tabs/NurseTraining.jsx',
      'src/components/training/AIComplianceQuizGenerator.jsx',
      'src/components/training/InteractiveDocumentationScenarios.jsx',
      'src/components/training/LearnerMemoryBoosters.jsx',
      'src/hooks/useMyTrainingCompletions.js',
    ]);
  });

  it('exposes PhoneNumber inventory only to protected admins and keeps writes service-owned', () => {
    const rls = entity('PhoneNumber').rls;
    expect(rls.read).toEqual(ADMIN);
    for (const operation of ['create', 'update', 'delete']) {
      expect(rls[operation], `PhoneNumber.${operation}`).toEqual(SERVICE_ROLE);
    }
    expect(directConsumers('PhoneNumber')).toEqual([
      'src/components/admin/NumberPoolPanel.jsx',
    ]);

    const panel = read('src/components/admin/NumberPoolPanel.jsx');
    expect(panel).toMatch(/const isAdmin\s*=\s*isAdminLike\(currentUser\)/);
    expect(panel).toMatch(/queryFn:\s*\(\)\s*=>\s*base44\.entities\.PhoneNumber\.list[\s\S]{0,120}?enabled:\s*isAdmin/);
  });

  it('hard-pauses FollowUpRuleConfig reads and leaves callers on built-in rules', () => {
    expect(entity('FollowUpRuleConfig').rls).toEqual({
      read: false,
      create: SERVICE_ROLE,
      update: SERVICE_ROLE,
      delete: SERVICE_ROLE,
    });
    expect(directConsumers('FollowUpRuleConfig')).toEqual([]);
    expect(sourcesContaining('fetchCallerFollowUpRuleConfig', ['src/lib/agencySettings.js']))
      .toEqual([
        'src/components/referral/ProviderFaxRequestCard.jsx',
        'src/pages/ReferralFollowUp.jsx',
      ]);

    const settings = read('src/lib/agencySettings.js');
    const helper = settings.slice(
      settings.indexOf('export function fetchCallerFollowUpRuleConfig'),
      settings.indexOf('export function fetchCallerPayerRateConfig'),
    );
    expect(helper).toMatch(/return Promise\.resolve\(null\)/);
    expect(helper).not.toMatch(/fetchCallerScopedConfig|base44\.entities|base44\.functions/);
    for (const caller of [
      'src/components/referral/ProviderFaxRequestCard.jsx',
      'src/pages/ReferralFollowUp.jsx',
    ]) {
      expect(read(caller), caller).toMatch(/ruleConfig:\s*ruleConfig\s*\|\|\s*undefined/);
    }
  });

  it('allows only the generating clinician or a protected admin to create or update discharge summaries', () => {
    const rls = entity('DischargeSummary').rls;
    expect(rls.create).toEqual(ownerOrAdmin('generated_by'));
    expect(rls.update).toEqual(ownerOrAdmin('generated_by'));
    expect(rls.delete).toBe(false);
    expect(directConsumers('DischargeSummary')).toEqual([
      'src/components/discharge/DischargeSummaryWorkflow.jsx',
      'src/components/hub-tabs/DischargeSummaries.jsx',
    ]);
    expect(directConsumers('DischargeSummary', 'create')).toEqual([]);
    expect(directConsumers('DischargeSummary', 'update')).toEqual([
      'src/components/discharge/DischargeSummaryWorkflow.jsx',
    ]);
    expect(read('base44/functions/generateDischargeSummary/entry.ts'))
      .toMatch(/entities\.DischargeSummary\.create\([\s\S]{0,3000}?generated_by:\s*user\.email/);
  });

  it('matches ClinicalLibraryFolder authorization to templates and keeps foreign shared folders read-only', () => {
    expect(entity('ClinicalLibraryFolder').rls)
      .toEqual(entity('ClinicalLibraryTemplate').rls);
    expect(directConsumers('ClinicalLibraryFolder')).toEqual([
      'src/components/clinical/ClinicalLibraryManager.jsx',
    ]);

    const manager = read('src/components/clinical/ClinicalLibraryManager.jsx');
    expect(manager).toMatch(/const isProtectedAdmin\s*=\s*isAdminLike\(currentUser\)/);
    expect(manager).toMatch(/folder\.created_by === currentUser\.email/);
    expect(manager).toMatch(/canEditFolder=\{canManageFolder\}/);

    const tree = read('src/components/clinical/FolderTreeView.jsx');
    expect(tree).toMatch(/canEditFolder\s*=\s*\(_folder\)\s*=>\s*false/);
    expect(tree).toMatch(/const canEdit\s*=\s*canEditFolder\(folder\)\s*===\s*true/);
    expect(tree).toMatch(/\{canEdit && \(/);
  });

  it('protects NoteConversion creation by nurse identity and prohibits browser updates', () => {
    const noteConversion = entity('NoteConversion');
    const rls = noteConversion.rls;
    expect(noteConversion.properties.recovery_request_id).toMatchObject({ type: 'string' });
    expect(rls.create).toEqual(ownerOrAdmin('nurse_email'));
    expect(rls.update).toBe(false);
    expect(rls.delete).toBe(false);
    expect(directConsumers('NoteConversion', 'create')).toEqual([
      'src/components/smartNote/persistVisitNote.js',
      'src/lib/retiredOfflineQueue.js',
    ]);
    expect(directConsumers('NoteConversion', 'update')).toEqual([]);
    expect(directConsumers('NoteConversion', '(?:filter|list|get)')).toEqual([
      'src/components/admin/NoteConversionReport.jsx',
      'src/components/admin/QualityMetricsDashboard.jsx',
      'src/components/admin/ReportsCenter.jsx',
      'src/components/reports/NursePerformanceReport.jsx',
      'src/lib/retiredOfflineQueue.js',
      'src/pages/AgencyAnalytics.jsx',
      'src/pages/AnalyticsDashboard.jsx',
    ]);

    expect(read('src/components/smartNote/persistVisitNote.js'))
      .toMatch(/nurseEmail:\s*currentUser\.email/);
    const retired = read('src/lib/retiredOfflineQueue.js');
    const createCase = retired.slice(retired.indexOf("case 'CREATE_VISIT'"));
    const identityCheck = createCase.indexOf('await bindNoteConversionToCaller(');
    const visitCreate = createCase.indexOf('createAuthorizedVisit(fields, functions)');
    const visitAuthorityCheck = createCase.indexOf('requireAuthorizedVisit(');
    const conversionReconcile = createCase.indexOf('await reconcileNoteConversion(');
    expect(identityCheck).toBeGreaterThan(-1);
    expect(identityCheck).toBeLessThan(visitCreate);
    expect(visitAuthorityCheck).toBeGreaterThan(visitCreate);
    expect(conversionReconcile).toBeGreaterThan(visitAuthorityCheck);
    expect(createCase).not.toMatch(/if\s*\(\s*result\.created\s*\)/);
    expect(retired).toMatch(/nurse_email:\s*String\(user\.email\)\.trim\(\)/);
    expect(retired).toMatch(/'legacy-note-conversion-v1',[\s\S]{0,500}?authority\.sourceRecordId,[\s\S]{0,300}?authority\.visitRequestId/);
    expect(retired).toMatch(/entities\.NoteConversion\.filter\(\s*\{ recovery_request_id: recoveryRequestId \},\s*'-created_date',\s*EXACT_RECOVERY_ROW_LIMIT/);
    expect(retired).toMatch(/if \(rows\.length >= EXACT_RECOVERY_ROW_LIMIT\)/);
    expect(retired).toMatch(/if \(rows\.length === 1\)[\s\S]{0,200}?requireMatchingNoteConversion/);
  });
});
