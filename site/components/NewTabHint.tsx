import { isExternal } from '../lib/ui';

export default function NewTabHint({ href }: { href: string }) {
  return isExternal(href) ? (
    <span className="sr-only"> (opens in a new tab)</span>
  ) : null;
}
