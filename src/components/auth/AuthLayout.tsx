import type { ReactNode } from 'react';

interface Props {
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
}

/** The full-page shell every auth screen sits in — sign in, set up, accept an
 *  invite, reset a password. One centred card, sized for a phone first. */
export default function AuthLayout({ title, subtitle, children, footer }: Props) {
  return (
    <div className="auth-shell">
      <div className="auth-card">
        <div className="auth-brand">
          <img className="brand-mark" src="/logo.svg" alt="" width={22} height={22} />
          <span className="brand-name">T-Card Planner</span>
        </div>
        <h1 className="auth-title">{title}</h1>
        {subtitle && <p className="auth-subtitle">{subtitle}</p>}
        {children}
        {footer && <div className="auth-footer">{footer}</div>}
      </div>
    </div>
  );
}
