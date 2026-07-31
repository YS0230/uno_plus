/**
 * 泡泡糖玩具風 UI 元件庫。
 * 形狀語彙統一取自 素材圖.png：厚白描邊 + 大圓角 + 內漸層 + 底部硬陰影 + 白字深色描邊。
 */
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import type { AvatarId } from '@uno/shared';
import './ui.css';

// ------------------------------------------------------------------ Button

export type ButtonTone = 'gold' | 'green' | 'blue' | 'violet' | 'pink' | 'sky' | 'ghost';
export type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  tone?: ButtonTone;
  size?: ButtonSize;
  block?: boolean;
  /** 圓形圖示按鈕 */
  round?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { tone = 'blue', size = 'md', block, round, className = '', children, ...rest },
  ref,
) {
  const classes = [
    'btn',
    `btn--${tone}`,
    `btn--${size}`,
    block && 'btn--block',
    round && 'btn--round',
    className,
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <button ref={ref} type="button" className={classes} {...rest}>
      <span className="btn__label">{children}</span>
    </button>
  );
});

// ------------------------------------------------------------------- Panel

interface PanelProps {
  title?: ReactNode;
  tone?: 'default' | 'warm';
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}

export function Panel({ title, tone = 'default', children, footer, className = '' }: PanelProps) {
  return (
    <section className={`panel panel--${tone} ${className}`}>
      {title !== undefined && <h2 className="panel__title">{title}</h2>}
      <div className="panel__body">{children}</div>
      {footer && <div className="panel__footer">{footer}</div>}
    </section>
  );
}

// ------------------------------------------------------------------- Field

export function Field({ label, hint, children }: { label: ReactNode; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="field">
      <span className="field__label">{label}</span>
      <span className="field__control">{children}</span>
      {hint && <span className="field__hint">{hint}</span>}
    </label>
  );
}

// ------------------------------------------------------------------ Toggle

export function Toggle({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className={`toggle ${checked ? 'is-on' : ''}`}
      onClick={() => onChange(!checked)}
    >
      <span className="toggle__knob" />
    </button>
  );
}

// ------------------------------------------------------------------ Avatar

const AVATAR_SIZES = { xs: 28, sm: 40, md: 56, lg: 76, xl: 104 } as const;

export function Avatar({
  id,
  size = 'md',
  ring,
  dim,
  className = '',
}: {
  id: AvatarId;
  size?: keyof typeof AVATAR_SIZES;
  /** 描邊顏色，用於標示當前玩家 */
  ring?: string;
  dim?: boolean;
  className?: string;
}) {
  const px = AVATAR_SIZES[size];
  return (
    <img
      className={`avatar ${dim ? 'is-dim' : ''} ${className}`}
      src={`/assets/avatars/${id}.png`}
      width={px}
      height={px}
      alt=""
      draggable={false}
      style={ring ? ({ '--avatar-ring': ring } as React.CSSProperties) : undefined}
    />
  );
}

// -------------------------------------------------------------------- Icon

export type IconName =
  | 'trophy' | 'gear' | 'sound' | 'music' | 'mic' | 'help'
  | 'users' | 'chat' | 'alert' | 'clock' | 'wifi' | 'exit'
  | 'shield' | 'crown' | 'star' | 'gift' | 'shop' | 'store';

export function Icon({ name, size = 22, className = '' }: { name: IconName; size?: number; className?: string }) {
  return (
    <img
      className={`icon ${className}`}
      src={`/assets/icons/${name}.png`}
      width={size}
      height={size}
      alt=""
      draggable={false}
    />
  );
}

// ------------------------------------------------------------------- Modal

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  tone = 'default',
  wide,
}: {
  open: boolean;
  onClose?: () => void;
  title?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  tone?: 'default' | 'warm';
  wide?: boolean;
}) {
  if (!open) return null;
  return (
    <div
      className="modal-scrim"
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
    >
      <div className={`modal ${wide ? 'modal--wide' : ''}`}>
        <Panel title={title} tone={tone} footer={footer}>
          {children}
        </Panel>
        {onClose && (
          <button type="button" className="modal__close" onClick={onClose} aria-label="關閉">
            ✕
          </button>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------- Badge

export function Badge({ children, tone = 'blue' }: { children: ReactNode; tone?: ButtonTone }) {
  return <span className={`badge badge--${tone}`}>{children}</span>;
}

// ----------------------------------------------------------------- Spinner

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="spinner-wrap">
      <div className="spinner" />
      {label && <p className="muted">{label}</p>}
    </div>
  );
}
