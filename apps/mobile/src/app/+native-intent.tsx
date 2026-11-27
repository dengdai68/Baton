import { setPairingLink } from '@/workspace/link';
export function redirectSystemPath({ path }: { path: string; initial: boolean }) {
  const link = /^\/?pair\?/.test(path) ? 'baton://'+path.replace(/^\//,'') : path;
  if (/^baton:\/\/pair(?:\?|$)/i.test(link)) {
    setPairingLink(link);
    return '/pair';
  }
  return path;
}
