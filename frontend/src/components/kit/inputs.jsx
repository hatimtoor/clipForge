import { ProBadge } from "./primitives";

/* Form primitives: Field, TextInput, TextArea, Select, StepperInput,
   Switch, SwitchRow, SegmentedControl. All styling lives in kit.css. */

export function Field({ label, hint, children, id }) {
  return (
    <div className="field" id={id}>
      {label && <div className="field__label">{label}</div>}
      {children}
      {hint && <div className="field__hint">{hint}</div>}
    </div>
  );
}

export function TextInput({ valid, error, className = "", ...rest }) {
  const cls = ["input", valid && "input--valid", error && "input--error", className]
    .filter(Boolean)
    .join(" ");
  return <input className={cls} {...rest} />;
}

export function TextArea({ error, className = "", ...rest }) {
  const cls = ["input", error && "input--error", className].filter(Boolean).join(" ");
  return <textarea className={cls} {...rest} />;
}

export function Select({ children, className = "", ...rest }) {
  return (
    <select className={`input ${className}`} {...rest}>
      {children}
    </select>
  );
}

export function StepperInput({ value, onChange, min, max, step = 1, suffix = "", tint }) {
  const canDec = value > min;
  const canInc = value < max;
  return (
    <div className="stepper" data-tint={tint}>
      <button
        type="button"
        className="stepper__btn"
        disabled={!canDec}
        onClick={() => onChange(Math.max(min, value - step))}
      >
        −
      </button>
      <div className="stepper__value">
        {value}
        {suffix}
      </div>
      <button
        type="button"
        className="stepper__btn"
        disabled={!canInc}
        onClick={() => onChange(Math.min(max, value + step))}
      >
        +
      </button>
    </div>
  );
}

export function Switch({ on, onChange, disabled, ariaLabel }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={ariaLabel}
      className={`switch ${on ? "switch--on" : ""}`}
      disabled={disabled}
      onClick={() => onChange?.(!on)}
    />
  );
}

/* SwitchRow honesty states:
   - fixed:    "always included" — no toggle affordance, shows a ✓ note instead
   - locked:   Pro-gated — shows ProBadge; clicking anywhere runs onLockedClick
   - disabled: not available (e.g. platform disabled it) — inert, no badge */
export function SwitchRow({ label, hint, on, onChange, fixed, locked, disabled, onLockedClick, id }) {
  const inert = fixed || disabled;
  const handle = () => {
    if (inert) return;
    if (locked) return onLockedClick?.();
    onChange?.(!on);
  };
  return (
    <div
      className="switch-row"
      id={id}
      data-fixed={fixed || undefined}
      data-locked={locked || undefined}
      onClick={handle}
      role={inert ? undefined : "button"}
      style={{ cursor: inert ? "default" : "pointer", opacity: disabled ? 0.6 : 1 }}
    >
      <div className="switch-row__text">
        <div className="switch-row__label" style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {label}
          {locked && !disabled && <ProBadge />}
        </div>
        {hint && <div className="switch-row__hint">{hint}</div>}
      </div>
      {fixed ? (
        <span className="switch-row__fixed">✓ Always included</span>
      ) : (
        /* presentational — the whole row is the click target; pointer-events
           off so the click doesn't fire twice (button + row bubble) */
        <span style={{ pointerEvents: "none", display: "inline-flex" }}>
          <Switch
            on={locked && !disabled ? false : on}
            disabled={locked || disabled}
            ariaLabel={typeof label === "string" ? label : undefined}
          />
        </span>
      )}
    </div>
  );
}

export function SegmentedControl({ options, value, onChange, id }) {
  return (
    <div className="seg" id={id} role="radiogroup">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={value === o.id}
          className={`seg__opt ${value === o.id ? "seg__opt--active" : ""}`}
          disabled={o.disabled}
          title={o.title}
          onClick={() => !o.disabled && onChange(o.id)}
        >
          {o.label}
          {o.pro && <ProBadge />}
        </button>
      ))}
    </div>
  );
}
