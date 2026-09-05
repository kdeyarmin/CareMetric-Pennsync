import { readFileSync } from 'node:fs';
import process from 'node:process';
import { describe, expect, it } from 'vitest';

const readSource = (relativePath) => readFileSync(`${process.cwd()}/${relativePath}`, 'utf8');

describe('Layout tenant-authority containment', () => {
  it('does not issue platform-wide approval or clinical badge reads', () => {
    const layout = readSource('src/components/Layout.jsx');

    expect(layout).not.toContain('entities.TimeOffRequest');
    expect(layout).not.toContain('entities.Timesheet');
    expect(layout).not.toContain('entities.Visit');
    expect(layout).not.toContain('entities.Message');
    expect(layout).not.toContain('entities.Notification');
    expect(layout).not.toContain("invoke('getScopedPatientAlerts'");
    expect(layout).not.toContain('NotificationCenter');
  });

  it('does not automatically replay unbound retired work after tenant entry', () => {
    const layout = readSource('src/components/Layout.jsx');
    expect(layout).not.toContain('flushAndRetireOfflineQueue');
  });

  it('mounts confirmations only inside the keyed ready-authority boundary', () => {
    const app = readSource('src/App.jsx');
    const boundaryStart = app.indexOf('<TenantAuthorityBoundary');
    const providerStart = app.indexOf('<ConfirmDialogProvider>', boundaryStart);
    const readyApp = app.indexOf('<TenantReadyApp />', providerStart);
    const sonnerHost = app.indexOf('<SonnerToaster', readyApp);
    const shadcnHost = app.indexOf('<Toaster />', readyApp);
    const providerEnd = app.indexOf('</ConfirmDialogProvider>', readyApp);
    const boundaryEnd = app.indexOf('</TenantAuthorityBoundary>', providerEnd);

    expect(boundaryStart).toBeGreaterThan(-1);
    expect(providerStart).toBeGreaterThan(boundaryStart);
    expect(readyApp).toBeGreaterThan(providerStart);
    expect(sonnerHost).toBeGreaterThan(readyApp);
    expect(shadcnHost).toBeGreaterThan(readyApp);
    expect(sonnerHost).toBeLessThan(providerEnd);
    expect(shadcnHost).toBeLessThan(providerEnd);
    expect(providerEnd).toBeGreaterThan(readyApp);
    expect(boundaryEnd).toBeGreaterThan(providerEnd);
    expect(app.match(/<ConfirmDialogProvider>/g)).toHaveLength(1);
  });

  it('mounts protected DOM and navigation observers only inside the keyed authority boundary', () => {
    const app = readSource('src/App.jsx');
    const boundaryStart = app.indexOf('<TenantAuthorityBoundary');
    const boundaryEnd = app.indexOf('</TenantAuthorityBoundary>', boundaryStart);
    const navigationTracker = app.indexOf('<NavigationTracker />');
    const visualEditAgent = app.indexOf('<VisualEditAgent />');

    expect(navigationTracker).toBeGreaterThan(boundaryStart);
    expect(navigationTracker).toBeLessThan(boundaryEnd);
    expect(visualEditAgent).toBeGreaterThan(boundaryStart);
    expect(visualEditAgent).toBeLessThan(boundaryEnd);
    expect(app.match(/<NavigationTracker \/>/g)).toHaveLength(1);
    expect(app.match(/<VisualEditAgent \/>/g)).toHaveLength(1);
  });

  it('does not preload patient favorites or account-global messages', () => {
    const desktopSidebar = readSource('src/components/layout/DesktopSidebar.jsx');
    const dashboard = readSource('src/pages/Dashboard.jsx');
    const messages = readSource('src/pages/Messages.jsx');
    const careTeamMessages = readSource('src/components/messaging/CareTeamMessaging.jsx');
    const referralIntake = readSource('src/pages/ReferralIntake.jsx');
    const referralDocuments = readSource('src/components/documents/ReferralDocumentViewer.jsx');

    expect(desktopSidebar).not.toContain('entities.Patient');
    expect(desktopSidebar).not.toContain('sidebar-favorite-patients');
    expect(dashboard).not.toContain('entities.Message');
    expect(dashboard).not.toContain('unreadMessages');
    expect(dashboard).not.toContain('entities.NoteConversion');
    expect(dashboard).not.toContain('myNoteConversions');
    expect(messages).toContain('TENANT_MESSAGES_UNAVAILABLE_MESSAGE');
    expect(messages).not.toContain('base44.entities.Message');
    expect(messages).not.toContain('useQuery');
    expect(messages).not.toContain('useMutation');
    expect(careTeamMessages).toContain('CARE_TEAM_MESSAGES_UNAVAILABLE_MESSAGE');
    expect(careTeamMessages).not.toContain('base44.entities.Message');
    expect(careTeamMessages).not.toContain('useQuery');
    expect(careTeamMessages).not.toContain('useMutation');
    expect(referralIntake).toContain('REFERRAL_ASSIGNMENT_MESSAGE_UNAVAILABLE');
    expect(referralIntake).not.toContain('sendMessage');
    expect(referralDocuments).toContain('REFERRAL_DOCUMENT_SEND_UNAVAILABLE_MESSAGE');
    expect(referralDocuments).not.toContain('sendMessage');
  });

  it('does not present missing tenant-safe approval counts as zero badges', () => {
    const manifest = readSource('src/lib/nav.manifest.js');
    expect(manifest).not.toContain('timeOffApprovals');
    expect(manifest).not.toContain('timesheetApprovals');
    expect(manifest).not.toContain('badge: "messages"');
  });
});
