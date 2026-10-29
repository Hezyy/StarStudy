/** A single safe path segment; never interpolate arbitrary config into JS or proxy rules. */
export function normalizeBasePath(value = '') {
  if (value === '') return '';
  if (typeof value !== 'string' || !/^\/[A-Za-z0-9_-]{1,128}$/.test(value))
    throw new Error('APP_BASE_PATH须为空或单段安全路径，不带末尾斜杠');
  return value;
}

/** Build-time values must agree. Error messages deliberately omit configured paths.
 * @param {Record<string, string | undefined>} [env]
 */
export function buildBasePath(env = process.env) {
  const configured = normalizeBasePath(env.APP_BASE_PATH ?? env.NEXT_PUBLIC_BASE_PATH ?? '');
  const client = normalizeBasePath(env.NEXT_PUBLIC_BASE_PATH ?? configured);
  if (configured !== client)
    throw new Error('APP_BASE_PATH与NEXT_PUBLIC_BASE_PATH不一致，请重新构建');
  return configured;
}

/** Returns canonical app pathname; boundary checks prevent sibling-prefix matching. */
export function stripBasePath(pathname, basePath) {
  if (!basePath) return pathname;
  if (pathname === basePath) return '/';
  return pathname.startsWith(`${basePath}/`) ? pathname.slice(basePath.length) : null;
}

export function prefixedPath(pathname, basePath) {
  if (!pathname.startsWith('/') || pathname.startsWith('//'))
    throw new Error('应用路径须为站内绝对路径');
  return `${basePath}${pathname}`;
}

export function checkBuildBasePath(metadata, runtimeBasePath) {
  if (
    !metadata ||
    metadata.app !== '星研' ||
    metadata.version !== 1 ||
    metadata.basePath !== runtimeBasePath
  )
    throw new Error('运行路径与前端构建不一致，请使用相同APP_BASE_PATH重新构建');
}
