import { setPairingLink } from '@/workspace/link';
export function redirectSystemPath({ path }: { path: string; initial: boolean }) {
  if (/^baton:\/\/pair(?:\?|$)/i.test(path)) {
    setPairingLink(path);
    return '/pair';
  }
  return path;
}
