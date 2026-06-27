/** 自适应缩短路径：从前面开始省略直到总字符数 ≤ maxLen，至少保留 minKeep 段 */
export function shortenPath(p: string, maxLen: number, minKeep: number): string {
  if (!p) return p;
  p = p.replace(/\\/g, '/').replace(/\/+/g, '/');
  const segments = p.split('/').filter(s => s !== '');
  if (segments.length <= minKeep) return segments.join('/');

  let result = segments.join('/');
  for (let kept = segments.length; kept >= minKeep; kept--) {
    result = segments.slice(-kept).join('/');
    if (result.length <= maxLen) return result;
    const withPrefix = '.../' + segments.slice(-kept + 1).join('/');
    if (withPrefix.length <= maxLen) return withPrefix;
  }
  return '.../' + segments.slice(-minKeep).join('/');
}

/** \ → / */
export function normPath(p?: string): string {
  if (!p) return '';
  return p.replace(/\\/g, '/');
}
