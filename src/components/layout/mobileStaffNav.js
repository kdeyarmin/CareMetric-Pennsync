import { canViewPatients, isClinicalUser, isReferralIntakeRole } from '@/lib/roles';

/**
 * The two middle mobile tabs. Referral intake replaces the less important
 * slot, but a clinician keeps Notes — unshifting and slicing would drop the
 * charting shortcut for a manager whose staff role is nurse.
 */
export function staffMiddleNav(currentUser) {
  const middle = [];
  if (canViewPatients(currentUser)) middle.push('Patients');
  if (isClinicalUser(currentUser)) middle.push('SmartNoteAssistant');
  if (middle.length < 2) middle.push('LearningCenter');
  if (middle.length < 2) middle.push('TimeOff');
  if (!isReferralIntakeRole(currentUser)) return middle.slice(0, 2);
  const withoutNotes = middle.filter((page) => page !== 'SmartNoteAssistant');
  const chosen = middle.includes('SmartNoteAssistant')
    ? ['ReferralIntake', 'SmartNoteAssistant']
    : ['ReferralIntake', ...withoutNotes];
  return chosen.slice(0, 2);
}
