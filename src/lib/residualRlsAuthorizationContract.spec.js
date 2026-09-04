import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import JSON5 from 'json5';
import { describe, expect, it } from 'vitest';

const REPO_DIR = process.cwd();
const ADMIN = { user_condition: { role: 'admin' } };
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

  it('allows only protected admins to mutate shared fax and Medicare configuration', () => {
    for (const name of ['FaxRetryConfig', 'MedicareComplianceRule']) {
      const rls = entity(name).rls;
      expect(rls.read, `${name}.read remains an active shared-reader debt`).toBe(true);
      expect(rls.create, `${name}.create`).toEqual(ADMIN);
      expect(rls.update, `${name}.update`).toEqual(ADMIN);
      expect(rls.delete, `${name}.delete`).toBe(false);
    }

    expect(directConsumers('FaxRetryConfig', '(?:create|update)')).toEqual([
      'src/components/admin/FaxRetryConfigPanel.jsx',
    ]);
    expect(directConsumers('MedicareComplianceRule', '(?:create|update)')).toEqual([
      'src/components/compliance/MedicareRuleSeeder.jsx',
    ]);

    const adminOperations = read('src/pages/AdminOperations.jsx');
    const complianceCenter = read('src/pages/ComplianceCenter.jsx');
    expect(adminOperations).toMatch(/<SystemSettings\s*\/>/);
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

  it('stamps every browser-created education assignment with the actor email', () => {
    const carePlans = read('src/pages/CarePlanManagement.jsx');
    const recommender = read('src/components/carePlan/AIEducationRecommender.jsx');
    const sender = read('src/components/education/PersonalizedMaterialSender.jsx');
    const portal = read('src/components/hub-tabs/PatientEducationPortal.jsx');

    expect(carePlans).not.toMatch(/assigned_by:\s*["']AI(?: System| Care Plan System)["']/);
    expect(carePlans.match(/assigned_by:\s*currentUser\.email/g)).toHaveLength(2);
    expect(carePlans.match(/if \(!currentUser\?\.email\)/g)).toHaveLength(2);
    expect(recommender).toMatch(/const assignedBy = \(await base44\.auth\.me\(\)\)\?\.email/);
    expect(recommender).toMatch(/if \(!assignedBy\)/);
    expect(recommender).toMatch(/assigned_by:\s*assignedBy/);
    expect(sender).toMatch(/if \(!currentUser\?\.email\)/);
    expect(sender).toMatch(/sent_by:\s*currentUser\.email/);
    expect(portal).toMatch(/if \(!deliveredBy\)/);
    expect(portal).toMatch(/delivered_by:\s*deliveredBy/);
  });
});
