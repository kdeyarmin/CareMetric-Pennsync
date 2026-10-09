import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path) => readFileSync(path, 'utf8');

// Which browser sources mention a name, excluding the specs themselves. Used to
// pin an endpoint as unreachable from `src/` rather than to describe one file.
const browserSourcesContaining = (needle, directory = 'src') => {
  const found = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) found.push(...browserSourcesContaining(needle, path));
    else if (/\.(?:js|jsx|ts|tsx)$/.test(entry.name) && !/\.(?:test|spec)\./.test(entry.name)
      && read(path).includes(needle)) {
      found.push(path);
    }
  }
  return found.sort();
};

const expectProtectedAdminEntityWrites = (entityName) => {
  const source = read(`base44/entities/${entityName}.jsonc`);
  for (const operation of ['create', 'update', 'delete']) {
    expect(source, `${entityName}.${operation}`).toMatch(
      new RegExp(`"${operation}"\\s*:\\s*\\{[\\s\\S]{0,160}?"role"\\s*:\\s*"admin"`),
    );
  }
};

describe('protected-admin frontend alignment', () => {
  // The follow-up page was restored on 2026-10-08 (owner decision), so this is
  // again an alignment of `src/pages/ReferralFollowUp.jsx` with the backend gate
  // on `saveFollowUpRuleConfig`: referral review is shown to any admin view
  // while the rule-settings form is gated on `isAdminLike`. The shared read
  // helper in `src/lib/agencySettings.js` reads the rules with `action: 'get'`,
  // which the backend answers before its built-in-admin save gate. The page's
  // payment-estimate panel was not restored, so nothing here asserts it.
  it('keeps referral review available while protecting agency-wide rule changes', () => {
    const page = read('src/pages/ReferralFollowUp.jsx');
    const backend = read('base44/functions/saveFollowUpRuleConfig/entry.ts');

    expect(backend).toMatch(/const isAdmin = user\?\.role === 'admin'/);
    expect(backend.indexOf("body.action === 'get'")).toBeLessThan(backend.indexOf('const isAdmin = user?.role'));
    expect(page).toMatch(/const adminView = isAdminView\(currentUser\)/);
    expect(page).toMatch(/const canManageRuleSettings = isAdminLike\(currentUser\)/);
    expect(page).toMatch(/disabled=\{!canManageRuleSettings\}/);
    expect(page).toMatch(/\{canManageRuleSettings && showSettings && \(/);
    expect(page).not.toMatch(/estimateFollowUpRevenueImpact|fmtUsd|PdgmRateConfig/);
    expect(browserSourcesContaining('saveFollowUpRuleConfig')).toEqual([
      'src/lib/agencySettings.js',
      'src/pages/ReferralFollowUp.jsx',
    ]);
  });

  it('keeps readable catalogs visible but gates their protected mutations', () => {
    const targets = [
      {
        entity: 'DocumentTemplate',
        file: 'src/pages/TemplateManagement.jsx',
        view: /const adminView = isAdminView\(currentUser\)/,
        capability: /const canManageTemplates = isAdminLike\(currentUser\)/,
        notice: /Document templates are read-only for facility administrators/,
      },
      {
        entity: 'OnCallShift',
        file: 'src/pages/OnCallSchedule.jsx',
        view: /const adminView = isAdminView\(currentUser\)/,
        capability: /const canManageSchedule = isAdminLike\(currentUser\)/,
        notice: /read-only facility-admin access to this schedule/,
      },
      {
        entity: 'MedicareGuideline',
        file: 'src/pages/MedicareGuidelinesLibrary.jsx',
        view: /const adminView = isAdminView\(currentUser\)/,
        capability: /const canManageGuidelines = isAdminLike\(currentUser\)/,
        notice: /catalog is read-only for facility administrators/,
      },
    ];

    for (const target of targets) {
      expectProtectedAdminEntityWrites(target.entity);
      expect(read(`base44/entities/${target.entity}.jsonc`)).toMatch(/"read"\s*:\s*true/);
      const page = read(target.file);
      expect(page, target.file).toMatch(target.view);
      expect(page, target.file).toMatch(target.capability);
      expect(page, target.file).toMatch(target.notice);
    }
  });

  it('does not start protected roster APIs for membership-only facility admins', () => {
    const setup = read('src/pages/AdminUserSetup.jsx');
    const management = read('src/pages/UserManagement.jsx');

    for (const [file, source] of [
      ['src/pages/AdminUserSetup.jsx', setup],
      ['src/pages/UserManagement.jsx', management],
    ]) {
      expect(source, file).toMatch(/const canManageUsers = isAdminLike\(currentUser\)/);
      expect(source, file).not.toMatch(/isAdminView/);
      expect(source, file).toMatch(/if \(!canManageUsers\)/);
      expect(source, file).toMatch(/immutable tenant-membership authorization/);
    }

    expect(setup).toMatch(/enabled: canManageUsers/);
    // The roster, the invitations and (owner decision, 2026-10-08) the scoped
    // activity summaries are the page's three protected reads.
    expect(management.match(/enabled: canManageUsers/g)).toHaveLength(3);
    expect(management).toMatch(/enabled: canManageUsers && allUsers\.length > 0/);
    expect(management).toMatch(/useActivityReport\(\{\s*enabled: canManageUsers,/);
    expect(management).not.toMatch(/entities\.UserActivity/);

    for (const backend of [
      'base44/functions/createUserWithTempPassword/entry.ts',
      'base44/functions/userManagement/entry.ts',
      'base44/functions/resetUserPassword/entry.ts',
      'base44/functions/resendInvitation/entry.ts',
    ]) {
      expect(read(backend), backend).toMatch(/role === 'admin'/);
    }
  });

  it('removes mutable account_type privilege from protected training workflows', () => {
    expectProtectedAdminEntityWrites('TrainingCourse');
    for (const file of [
      'src/components/training/AnnualMandatoryEducationHub.jsx',
      'src/components/training/PolicyAcknowledgmentManager.jsx',
      'src/components/training/SMEReviewQueue.jsx',
    ]) {
      const source = read(file);
      expect(source, file).toMatch(/isAdminLike\(currentUser\)/);
      expect(source, file).not.toMatch(/currentUser\?*\.account_type/);
      expect(source, file).toMatch(/protected administrator access/i);
    }
  });

  it('keeps compound pages useful while withholding protected child controls', () => {
    expectProtectedAdminEntityWrites('Announcement');
    expectProtectedAdminEntityWrites('PersonnelCredential');

    const notification = read('src/pages/NotificationSettings.jsx');
    expect(notification).toMatch(/const adminView = isAdminView\(currentUser\)/);
    expect(notification).toMatch(/const canManageAnnouncements = isAdminLike\(currentUser\)/);
    expect(notification.match(/\{canManageAnnouncements && \(/g)).toHaveLength(2);
    expect(notification).toMatch(/System-wide announcement management requires protected administrator access/);

    const documentHub = read('src/pages/DocumentHub.jsx');
    expect(read('base44/entities/DocumentPackageToken.jsonc')).toMatch(
      /"read"\s*:\s*false/,
    );
    expect(documentHub).toMatch(/const adminView = isAdminView\(currentUser\)/);
    expect(documentHub).toMatch(/const canReadDocumentAudit = isAdminLike\(currentUser\)/);
    expect(documentHub).toMatch(/validTabKeys = canReadDocumentAudit/);
    expect(documentHub.match(/\{canReadDocumentAudit && \(/g)).toHaveLength(2);

    const personnel = read('src/pages/PersonnelFile.jsx');
    expect(personnel).toMatch(/const adminView = isAdminView\(currentUser\)/);
    expect(personnel).toMatch(/const canReviewPersonnel = isAdminLike\(currentUser\)/);
    expect(personnel).toMatch(/\{canReviewPersonnel && <TabsTrigger value="approvals"/);
    expect(personnel).toMatch(/\{canReviewPersonnel && \([\s\S]*?<AdminCredentialApproval \/>/);
    expect(personnel).toMatch(/Agency-wide approvals and expiration tracking require protected administrator access/);

    for (const [file, source] of [
      ['src/pages/NotificationSettings.jsx', notification],
      ['src/pages/DocumentHub.jsx', documentHub],
      ['src/pages/PersonnelFile.jsx', personnel],
    ]) {
      expect(source, file).not.toMatch(/currentUser\?*\.account_type/);
    }
  });

  it('does not mount protected admin-console tools from the membership admin view', () => {
    const page = read('src/pages/AdminOperations.jsx');

    expect(page).toMatch(/const adminView = isAdminView\(currentUser\)/);
    expect(page).toMatch(/const canUseProtectedAdminTools = isAdminLike\(currentUser\)/);
    expect(page).toMatch(/visibleTabKeys = canUseProtectedAdminTools/);
    expect(page).toMatch(/\{canUseProtectedAdminTools && \([\s\S]*?<UserActivityDashboard \/>/);
    expect(page).toMatch(/\{canUseProtectedAdminTools && \([\s\S]*?<SystemHealthPanel \/>/);
    expect(page).toMatch(/Facility-admin access remains limited to the visible console sections/);
    expect(page).not.toMatch(/currentUser\?*\.account_type/);
  });

  it('leaves who-may-see-whom for nurse performance to the server', () => {
    // Restored 2026-10-08 (owner decision). The page holds no role logic: the
    // nurse picker exists only when analyzeNursePerformance's `roster` action
    // answers, which it does for the built-in admin and a service-owned agency
    // administrator alone, and the server re-checks every target. The burnout
    // prediction tab is not restored.
    const dashboard = read('src/pages/NursePerformanceDashboard.jsx');
    const training = read('src/pages/NurseTrainingHub.jsx');

    expect(dashboard).toMatch(/invoke\('analyzeNursePerformance', \{ action: 'roster' \}\)/);
    expect(dashboard).toMatch(/const canPickNurse = Array\.isArray\(roster\);/);
    expect(dashboard).not.toMatch(/isAdminView|account_type|entities\.User\b|burnout/i);
    // Skill-gap training is back in the Training Hub (owner decision,
    // 2026-10-08). The hub asks only about the caller (no nurse_email), uses the
    // model-free `skill_gaps` action, and reads nothing that predicts burnout or
    // clinical risk; a failed read is shown as unavailable, never as no gaps.
    expect(training).toMatch(/invoke\('analyzeNursePerformance', \{\s*action: 'skill_gaps',\s*date_range_days: 30,\s*\}\)/);
    const trainingCode = training.replace(/^\s*\/\/.*$/gm, '');
    expect(trainingCode).not.toMatch(/insights|risk_factors|burnout|isAdminView|account_type/i);
    expect(training).toMatch(/skillGapsQuery\.isError \? \(\s*<UserActivityUnavailable\s+title="Personalized skill-gap analysis unavailable"/);
    expect(training).toMatch(/invoke\('generatePersonalizedTraining', \{ skill_gap: skillGap \}\)/);
    const performance = read('base44/functions/analyzeNursePerformance/entry.ts');
    const gapsOnly = performance.indexOf("if (body?.action === 'skill_gaps')");
    expect(gapsOnly).toBeGreaterThan(-1);
    expect(gapsOnly).toBeLessThan(performance.indexOf('InvokeLLM'));

    const features = read('src/pages/Features.jsx');
    expect(features).toMatch(/10\.2 Nurse Performance Dashboard<\/h3>/);
    expect(features).not.toMatch(/Nurse Performance Dashboard \(Paused\)/);
    expect(features).not.toMatch(/personalized skill-gap analysis is currently unavailable/);
    expect(features).toMatch(/Nothing predicts burnout or clinical risk/);
    expect(features).not.toMatch(/View your personalized learning path/);
  });

  it('does not market hard-paused Clinical Pathways as active automation', () => {
    const features = read('src/pages/Features.jsx');
    const start = features.indexOf('category: "Clinical Pathways"');
    const end = features.indexOf('category: "Workflow & Notifications"', start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);

    const pathwayCatalog = features.slice(start, end);
    expect(pathwayCatalog.match(/paused:\s*true/g)).toHaveLength(4);
    expect(pathwayCatalog.match(/timeSaved:\s*"Unavailable"/g)).toHaveLength(4);
    expect(pathwayCatalog.match(/description:\s*"Paused:/g)).toHaveLength(4);
    expect(pathwayCatalog).not.toMatch(
      /Automatic pathway activation|Pathways trigger automatically|Click 'Create Tasks'|Navigate to Clinical Pathway Manager to create/,
    );
  });
});
