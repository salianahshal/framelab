/** Shared design primitives, so the chrome on every page stays in step. */

export const focusRing =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember-light focus-visible:ring-offset-2 focus-visible:ring-offset-surface';

/* Hairline seam colour, repeated often enough to be worth a constant. */
export const seam = 'border-offgray-900';

export const REPO = 'https://github.com/salianahshal/framelab';

export const navLinks = [
  { label: 'Features', href: '/#features' },
  { label: 'Changelog', href: '/changelog' },
  { label: 'Install', href: '/#install' },
  { label: 'GitHub', href: REPO },
];

export function isExternal(href: string) {
  return /^https?:\/\//.test(href);
}

export function externalProps(href: string) {
  return isExternal(href)
    ? { target: '_blank', rel: 'noopener noreferrer' }
    : {};
}
