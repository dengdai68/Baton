export function redirectSystemPath({ path }: { path: string; initial: boolean }) {
  return /^(baton:\/\/)?\/?pair(?:[?#]|$)/i.test(path) ? '/connect' : path;
}
