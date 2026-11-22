const cache = new Map();

// Tiny glob: "*" and "?" stay inside one path segment, "**" crosses segments,
// and a "**" followed by a slash also matches zero directories.
export function globToRegex(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') {
      i++;
      if (glob[i + 1] === '/') { i++; re += '(?:.*/)?'; } else re += '.*';
    } else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`, 'i');
}

const posix = (p) => p.replace(/\\/g, '/');

// Pattern forms, like .gitignore:
//   build              any file or folder with that name
//   **/out/*.mp4       relative to the configured folder
//   D:/videos/raw      absolute path
export function matches(pattern, { abs, rel, name }) {
  const p = posix(pattern);
  const re = cache.get(p) ?? cache.set(p, globToRegex(p.replace(/\/+$/, ''))).get(p);
  if (!p.includes('/')) return re.test(name);
  return re.test(/^([a-z]:)?\//i.test(p) ? posix(abs) : posix(rel));
}

export const matchesAny = (patterns, target) => patterns.some((p) => matches(p, target));
