/**
 * Simple (patient) mode — `?simple` in the URL.
 * A calmer explorer for clinic websites: teeth and gums only at start, no auto tour,
 * no quiz / numbering / language switches, no layers panel, and a dock of a few
 * plain-word buttons. Everything else (search, tooth details, looking inside a tooth)
 * works as usual.
 */
import type { CategoryId } from '../anatomy/types';
import { CATEGORIES } from '../anatomy/categories';
import type { CategoryState } from '../anatomy/categories';
import { CLINIC_NAME } from './seo';

export const SIMPLE: boolean = (() => {
  try { return new URLSearchParams(location.search).has('simple'); } catch { return false; }
})();

const ON: CategoryId[] = ['permanent-teeth', 'enamel', 'dentin', 'cementum', 'dental-pulp', 'root-canals', 'gingiva', 'periodontal-ligament'];
const GHOST: CategoryId[] = ['alveolar-bone', 'maxilla', 'mandible'];

/** Starting layers for patients: the teeth and gums, the jaw bone faint behind them. */
export const PATIENT_CATEGORIES = Object.fromEntries(
  CATEGORIES.map((c) => [c.id, ON.includes(c.id) ? 'on' : GHOST.includes(c.id) ? 'ghost' : 'off']),
) as Record<CategoryId, CategoryState>;

/** Published under a clinic's name (or embedded on its site): no Dental Scope branding in the UI. */
export const CLINIC: boolean = SIMPLE || !!CLINIC_NAME;
export { CLINIC_NAME };
