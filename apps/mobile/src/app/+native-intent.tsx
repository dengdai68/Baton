// Pairing QR codes carry their parameters in the fragment
// (baton://pair#origin=…&pin=…&code=…); hand the whole link to the pair route.
export function redirectSystemPath({ path }: { path: string; initial: boolean }) {
  try {
    const hash = path.indexOf('#');
    if (/^(baton:\/\/)?\/?pair/i.test(path)) return hash >= 0 ? '/pair?link=' + encodeURIComponent('baton://pair' + path.slice(hash)) : '/pair';
    return path;
  } catch {
    return '/';
  }
}
