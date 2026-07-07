/* Small presentational kit pieces: Card, Tag, ProBadge, Banner, EmptyState. */

export function Card({ children, flush, sub, className = "", style, ...rest }) {
  const cls = ["card", flush && "card--flush", sub && "card--sub", className]
    .filter(Boolean)
    .join(" ");
  return (
    <div className={cls} style={style} {...rest}>
      {children}
    </div>
  );
}

export function Tag({ children, tone, className = "" }) {
  const cls = ["tag", tone && `tag--${tone}`, className].filter(Boolean).join(" ");
  return <span className={cls}>{children}</span>;
}

export function ProBadge({ className = "" }) {
  return <span className={`pro-badge ${className}`}>Pro</span>;
}

export function Banner({ tone = "info", title, children, action, className = "" }) {
  return (
    <div className={`banner banner--${tone} ${className}`}>
      <div style={{ flex: 1, minWidth: 0 }}>
        {title && <div className="banner__title">{title}</div>}
        {children}
      </div>
      {action}
    </div>
  );
}

export function EmptyState({ icon, title, description, action }) {
  return (
    <div className="empty">
      {icon && <div className="empty__icon">{icon}</div>}
      <div className="empty__title">{title}</div>
      {description && <div className="empty__desc">{description}</div>}
      {action}
    </div>
  );
}
