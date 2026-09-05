import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path) => readFileSync(path, 'utf8');

const expectProtectedAdminEntityWrites = (entityName) => {
  const source = read(`base44/entities/${entityName}.jsonc`);
  for (const operation of ['create', 'update', 'delete']) {
    expect(source, `${entityName}.${operation}`).toMatch(
      new RegExp(`"${operation}"\\s*:\\s*\\{[\\s\\S]{0,160}?"role"\\s*:\\s*"admin"`),
    );
  }
};

describe('protected-admin frontend alignment', () => {
  it('keeps referral analytics available while protecting agency-wide rule changes', () => {
    const page = read('src/pages/ReferralFollowUp.jsx');
    const backend = read('base44/functions/saveFollowUpRuleConfig/entry.ts');

    expect(backend).toMatch(/const isAdmin = user\?\.role === 'admin'/);
    expect(page).toMatch(/const adminView = isAdminView\(currentUser\)/);
    expect(page).toMatch(/const canManageRuleSettings = isAdminLike\(currentUser\)/);
    expect(page).toMatch(/disabled=\{!canManageRuleSettings\}/);
    expect(page).toMatch(/\{canManageRuleSettings && showSettings && \(/);
    expect(page).toMatch(/adminView && selectedPlan/);
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
    expect(management.match(/enabled: canManageUsers/g)).toHaveLength(2);
    expect(management).toMatch(/enabled: canManageUsers && allUsers\.length > 0/);

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

  it('presents provenance-derived nurse conclusions as unavailable', () => {
    const dashboard = read('src/pages/NursePerformanceDashboard.jsx');
    const training = read('src/pages/NurseTrainingHub.jsx');

    expect(dashboard).toMatch(/<UserActivityUnavailable title="Nurse performance analysis unavailable" \/>/);
    expect(dashboard).not.toMatch(/analyzeNursePerformance|isAdminView|account_type/);
    expect(training).toMatch(/<UserActivityUnavailable title="Personalized skill-gap analysis unavailable" \/>/);
    expect(training).toMatch(/<StatCard label="Skill Gaps" value="Unavailable"/);
    expect(training).not.toMatch(/analyzeNursePerformance/);

    const features = read('src/pages/Features.jsx');
    expect(features).toMatch(/Nurse Performance Dashboard \(Paused\)/);
    expect(features).toMatch(/personalized skill-gap analysis is currently unavailable/);
    expect(features).not.toMatch(/Review individual nurse metrics|View your personalized learning path/);
  });
});
