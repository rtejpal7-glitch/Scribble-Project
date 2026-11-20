import type { ButtonHTMLAttributes, ReactNode } from 'react';

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  active?: boolean;
  children: ReactNode;
  tone?: 'default' | 'danger';
}

export function IconButton({ label, active, children, tone = 'default', className = '', ...rest }: IconButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active === undefined ? undefined : active}
      className={[
        'inline-flex h-9 min-w-9 shrink-0 items-center justify-center rounded-lg px-2 text-slate-600 transition-colors',
        'hover:bg-slate-100 hover:text-slate-900 disabled:pointer-events-none disabled:opacity-35',
        'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-blue-500',
        active ? 'bg-slate-900 text-white hover:bg-slate-800 hover:text-white' : '',
        tone === 'danger' ? 'hover:bg-red-50 hover:text-red-600' : '',
        className,
      ].join(' ')}
      {...rest}
    >
      {children}
    </button>
  );
}

export function ToolbarDivider() {
  return <div className="mx-1 h-6 w-px shrink-0 bg-slate-200" aria-hidden="true" />;
}
