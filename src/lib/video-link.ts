export function videoLink(value: string): {
  kind: 'empty' | 'invalid' | 'video' | 'search' | 'page';
  label: string;
  href: string;
  reason?: string;
} {
  if (!value) return { kind: 'empty', label: '链接待补充', href: '' };
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password)
      throw new Error('仅支持无账户信息的http/https链接');
    const host = url.hostname.toLowerCase();
    if (
      host === 'search.bilibili.com' ||
      (['www.bilibili.com', 'm.bilibili.com'].includes(host) && url.pathname.startsWith('/search'))
    )
      return { kind: 'search', label: '搜索对应视频', href: url.href };
    if (
      ['www.bilibili.com', 'bilibili.com', 'm.bilibili.com'].includes(host) &&
      url.pathname.startsWith('/video/')
    ) {
      if (!/^\/video\/(BV[A-Za-z0-9]{10}|av\d+)\/?$/.test(url.pathname))
        throw new Error('B站视频标识不正确，请粘贴具体视频页面链接');
      const page = url.searchParams.get('p');
      if (page && !/^[1-9]\d{0,2}$/.test(page)) throw new Error('B站选集参数p须为1—999的整数');
      return { kind: 'video', label: page ? `观看网课 · 第${page}集` : '观看网课', href: url.href };
    }
    return { kind: 'page', label: '打开网课', href: url.href };
  } catch (e) {
    return {
      kind: 'invalid',
      label: '链接无效',
      href: '',
      reason: e instanceof Error ? e.message : '链接格式无效',
    };
  }
}
