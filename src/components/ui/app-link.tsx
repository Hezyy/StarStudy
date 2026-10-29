'use client';
import Link from 'next/link';
import type { ComponentProps } from 'react';
import { appUrl } from '@/lib/app-path';

// The production PWA already precaches every route. Avoid redundant RSC
// prefetches during navigation, including WebKit's aborted-fetch errors.
export default function AppLink(props: ComponentProps<typeof Link>) {
  return (
    <Link
      {...props}
      prefetch={false}
      onClick={(e) => {
        const href = typeof props.href === 'string' ? props.href : '';
        if (
          !e.metaKey &&
          !e.ctrlKey &&
          !e.shiftKey &&
          !e.altKey &&
          href.startsWith('/') &&
          !href.startsWith('//') &&
          appUrl(href.split(/[?#]/)[0]) !== location.pathname
        ) {
          if (
            !window.dispatchEvent(new Event('star-study:before-navigate', { cancelable: true }))
          ) {
            e.preventDefault();
            return;
          }
        }
        props.onClick?.(e);
      }}
    />
  );
}
