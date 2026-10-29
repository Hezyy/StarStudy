/** Next handles AppLink/router basePath itself. Use this only for native URLs and fetch. */
export const appBasePath = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
export function appUrl(path: string) {
  if (!path.startsWith('/') || path.startsWith('//')) throw new Error('应用路径须为站内绝对路径');
  return `${appBasePath}${path}`;
}
/** Keep existing root-mode keys and learning databases unchanged. */
export function appStorageKey(key: string) {
  return appBasePath ? `star-study-scope:${appBasePath.slice(1)}:${key}` : key;
}
