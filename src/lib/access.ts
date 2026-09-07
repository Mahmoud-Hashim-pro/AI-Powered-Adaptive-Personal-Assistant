import { UserProfile, AccountPath } from '../types';

// The top-level "sections" a user is enrolled into at sign-up (the Login path
// selector). Access is scoped by this so nobody wanders into another section's
// experience without belonging to it.
export type AppView =
  | 'chat' | 'learning' | 'profile' | 'settings' | 'video' | 'disability'
  | 'admin' | 'goals' | 'gpa' | 'analytics' | 'planner' | 'support' | 'memory'
  | 'gym' | 'iq' | 'institution' | 'france';

/** A user counts as an accessibility user if they picked the Special Needs path
 *  OR have a real accessibility mode enabled. */
export function isAccessibilityUser(profile: UserProfile | null | undefined): boolean {
  if (!profile) return false;
  return profile.accountPath === 'Special Needs'
    || (!!profile.accessibilityMode && profile.accessibilityMode !== 'None');
}

/** The section label for a user (used by the admin directory). */
export function sectionOf(profile: Pick<UserProfile, 'accountPath'>): AccountPath {
  return profile.accountPath || 'Normal';
}

/** Views an accessibility (Special Needs) user is allowed to open — their world
 *  is the disability center plus personal/account screens and adaptive learning hub. */
const ACCESSIBILITY_ALLOWED: AppView[] = ['disability', 'learning', 'profile', 'settings', 'support', 'memory', 'gym', 'iq', 'france'];

/**
 * Can this profile open the given view?
 *  - Admins can open anything (incl. the admin dashboard).
 *  - The disability section is only for accessibility users.
 *  - Accessibility users are kept inside their simplified world and can't cross
 *    into the full "normal"/graduation experience.
 *  - Everyone else (Normal / Graduation Project) can open the standard views but
 *    NOT the disability section.
 */
export function canAccessView(
  profile: UserProfile | null | undefined,
  view: AppView,
  isAdmin: boolean,
): boolean {
  if (!profile) return false;
  if (view === 'admin') return isAdmin;
  if (view === 'institution') return isAdmin || profile.isOrgManager === true;
  if (isAdmin) return true; // admins/testers bypass section scoping

  const accessibility = isAccessibilityUser(profile);
  // Org managers (e.g. Care Center / NGO staff) can open the disability hub —
  // their org dashboard lives inside it — regardless of their own account path.
  if (view === 'disability') return accessibility || profile.isOrgManager === true;
  if (accessibility) return ACCESSIBILITY_ALLOWED.includes(view);
  return true;
}

/** Where to send a user who hit a view they can't access. */
export function homeViewFor(profile: UserProfile | null | undefined): AppView {
  return isAccessibilityUser(profile) ? 'disability' : 'chat';
}
