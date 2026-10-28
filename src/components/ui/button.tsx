'use client';
import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { LoaderCircle } from 'lucide-react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';
const variants = cva('button', {
  variants: {
    variant: {
      default: 'button-primary',
      secondary: 'button-secondary',
      ghost: 'button-ghost',
      danger: 'button-danger',
    },
    size: { default: '', sm: 'button-sm', icon: 'button-icon' },
  },
  defaultVariants: { variant: 'default', size: 'default' },
});
export function Button({
  className,
  variant,
  size,
  asChild = false,
  loading = false,
  onClick,
  disabled,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof variants> & { asChild?: boolean; loading?: boolean }) {
  const [pending, setPending] = React.useState(false);
  const lock = React.useRef(false),
    mounted = React.useRef(true);
  React.useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const busy = loading || pending;
  const click: React.MouseEventHandler<HTMLButtonElement> = (e) => {
    if (lock.current || busy || disabled) {
      e.preventDefault();
      return;
    }
    const report = (error: unknown) =>
      window.dispatchEvent(
        new CustomEvent('star-study:operation-error', {
          detail: error instanceof Error ? error.message : '操作失败，请重试',
        }),
      );
    let result: unknown;
    try {
      result = onClick?.(e);
    } catch (error) {
      report(error);
      return;
    }
    if (result && typeof (result as Promise<unknown>).then === 'function') {
      lock.current = true;
      setPending(true);
      void Promise.resolve(result)
        .finally(() => {
          lock.current = false;
          if (mounted.current) setPending(false);
        })
        .catch(report);
    }
  };
  const classes = cn(variants({ variant, size, className }), busy && 'is-loading');
  if (asChild)
    return (
      <Slot className={classes} {...props} onClick={click}>
        {children}
      </Slot>
    );
  return (
    <button
      className={classes}
      {...props}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      onClick={click}
    >
      {busy && <LoaderCircle size={15} className="button-spinner" aria-hidden="true" />}
      <span className="button-label">{children}</span>
    </button>
  );
}
