'use client';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { Button } from './button';
import { useFeedback } from '../provider';
import { getFocusReturnTarget } from '@/lib/interaction';
export function Modal({
  title,
  children,
  onClose,
  wide = false,
  presentation,
  protectChanges = true,
  busy = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
  presentation?: 'sheet' | 'dialog';
  protectChanges?: boolean;
  busy?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null),
    previousFocus = useRef<HTMLElement | null>(
      typeof document === 'undefined'
        ? null
        : (getFocusReturnTarget() ?? (document.activeElement as HTMLElement)),
    ),
    timeout = useRef<ReturnType<typeof setTimeout> | null>(null),
    dirty = useRef(false);
  const [closing, setClosing] = useState(false);
  const feedbackError = useFeedback(),
    label = useId();
  useEffect(() => {
    const d = ref.current,
      focus = previousFocus.current,
      overflow = document.body.style.overflow;
    d?.showModal();
    d?.querySelector<HTMLElement>(
      'input:not([disabled]):not([type="file"]), textarea:not([disabled]), select:not([disabled])',
    )?.focus({ preventScroll: true });
    document.body.style.overflow = 'hidden';
    const viewport = window.visualViewport;
    const fit = () => {
      d?.style.setProperty('--visual-height', `${viewport?.height ?? window.innerHeight}px`);
      d?.style.setProperty(
        '--keyboard-offset',
        `${Math.max(0, window.innerHeight - (viewport?.height ?? window.innerHeight) - (viewport?.offsetTop ?? 0))}px`,
      );
    };
    fit();
    viewport?.addEventListener('resize', fit);
    viewport?.addEventListener('scroll', fit);
    return () => {
      viewport?.removeEventListener('resize', fit);
      viewport?.removeEventListener('scroll', fit);
      if (timeout.current) clearTimeout(timeout.current);
      d?.close();
      document.body.style.overflow = overflow;
      if (focus?.isConnected) focus.focus({ preventScroll: true });
    };
  }, []);
  const close = () => {
    if (closing || busy || ref.current?.querySelector('button[aria-busy="true"]')) return;
    if (protectChanges && dirty.current && !confirm('尚未保存的内容会丢失，确认关闭？')) return;
    setClosing(true);
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) onClose();
    else timeout.current = setTimeout(onClose, 160);
  };
  return (
    <dialog
      ref={ref}
      aria-labelledby={label}
      aria-modal="true"
      aria-busy={busy || undefined}
      className={`modal ${wide ? 'modal-wide' : ''} ${(presentation ?? (wide ? 'dialog' : 'sheet')) === 'sheet' ? 'modal-sheet' : ''} ${closing ? 'is-closing' : ''}`}
      onInputCapture={() => {
        dirty.current = true;
      }}
      onChangeCapture={() => {
        dirty.current = true;
      }}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      onClick={(e) => {
        if (e.target === ref.current) {
          const r = ref.current.getBoundingClientRect();
          if (
            e.clientX < r.left ||
            e.clientX > r.right ||
            e.clientY < r.top ||
            e.clientY > r.bottom
          )
            close();
        }
      }}
    >
      <div className="modal-grabber" aria-hidden="true" />
      <div className="modal-heading">
        <h2 id={label}>{title}</h2>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="关闭弹窗"
          disabled={busy}
          onClick={close}
        >
          <X size={20} />
        </Button>
      </div>
      {feedbackError && (
        <p role="alert" className="warning-box">
          {feedbackError}
        </p>
      )}
      {children}
    </dialog>
  );
}
