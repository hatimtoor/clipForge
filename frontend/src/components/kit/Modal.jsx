import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/* Kit Modal: portals to <body>, standard header/body/footer, Escape +
   backdrop-click close (both suppressed when dismissable={false}, e.g. while
   an upload is in flight). */
export function Modal({
  open = true,
  title,
  icon,
  onClose,
  footer,
  size,
  dismissable = true,
  children,
  bodyStyle,
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === "Escape" && dismissable) onClose?.();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, dismissable, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && dismissable) onClose?.();
      }}
    >
      <div className={`modal ${size ? `modal--${size}` : ""}`} role="dialog" aria-modal="true">
        {(title || onClose) && (
          <div className="modal__head">
            {icon && <span style={{ display: "inline-flex", fontSize: 18 }}>{icon}</span>}
            <div className="modal__title">{title}</div>
            {onClose && (
              <button type="button" className="modal__close" onClick={onClose} aria-label="Close">
                ✕
              </button>
            )}
          </div>
        )}
        <div className="modal__body" style={bodyStyle}>
          {children}
        </div>
        {footer && <div className="modal__foot">{footer}</div>}
      </div>
    </div>,
    document.body
  );
}

/* Popover menu anchored to its trigger. items: [{label, icon, onClick,
   disabled, pro}]. Closes on outside click / Escape / item click. */
export function MenuButton({ trigger, items, align = "right" }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => {
      if (!rootRef.current?.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <span ref={rootRef} style={{ position: "relative", display: "inline-flex" }}>
      {trigger(() => setOpen((o) => !o), open)}
      {open && (
        <div
          className="popover"
          style={{ top: "calc(100% + 6px)", [align]: 0 }}
        >
          {items.map((it, i) => (
            <button
              key={i}
              type="button"
              className="menu__item"
              disabled={it.disabled}
              onClick={() => {
                setOpen(false);
                it.onClick?.();
              }}
            >
              {it.icon && <span style={{ display: "inline-flex" }}>{it.icon}</span>}
              <span style={{ flex: 1 }}>{it.label}</span>
              {it.pro && <span className="pro-badge">Pro</span>}
            </button>
          ))}
        </div>
      )}
    </span>
  );
}
