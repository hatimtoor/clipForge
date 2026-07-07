import { useState } from "react";
import { ProBadge } from "./primitives";

/* SettingsChip — the HelloPage fast path: shows the current value of a
   settings group and opens its modal. */
export function SettingsChip({ icon, label, value, onClick, pro, id }) {
  return (
    <button type="button" className="chip" onClick={onClick} id={id}>
      {icon && <span className="chip__icon">{icon}</span>}
      {label && <span className="chip__label">{label}</span>}
      <span className="chip__value">{value}</span>
      {pro && <ProBadge />}
      <span className="chip__caret">▾</span>
    </button>
  );
}

export function CollapsibleSection({
  title,
  hint,
  badge,
  defaultOpen = false,
  open: openProp, // controlled mode (optional)
  onToggle,
  children,
  id,
}) {
  const [openState, setOpenState] = useState(defaultOpen);
  const open = openProp ?? openState;
  const toggle = () => (onToggle ? onToggle(!open) : setOpenState((o) => !o));
  return (
    <div className={`collapse ${open ? "collapse--open" : ""}`} id={id}>
      <button type="button" className="collapse__head" onClick={toggle}>
        <span className="collapse__title">{title}</span>
        {badge}
        <span className="collapse__hint">{!open ? hint : ""}</span>
        <svg
          className="collapse__chev"
          width="14"
          height="9"
          viewBox="0 0 14 9"
          fill="none"
          aria-hidden="true"
        >
          <path d="M1 1l6 6 6-6" stroke="currentColor" strokeWidth="2" />
        </svg>
      </button>
      {open && <div className="collapse__body">{children}</div>}
    </div>
  );
}
