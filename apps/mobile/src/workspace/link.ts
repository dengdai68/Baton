export function loginOrigin(input: string): string {
  const value = input.trim();
  const invalid = () => new Error('请输入有效的工作空间地址');
  if (!value) throw invalid();
  const url = new URL(value.includes('://') ? value : 'https://' + value);
  if (!['https:', 'http:'].includes(url.protocol) || !url.hostname || url.hostname.includes('..') || url.username || url.password || url.pathname !== '/' || url.search || url.hash || url.port === '0') throw invalid();
  return url.origin;
}
