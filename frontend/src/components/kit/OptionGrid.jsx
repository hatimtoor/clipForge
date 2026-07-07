import { ProBadge } from "./primitives";

/* Visual option picker (layouts, formats, caption styles). options:
   [{id, label, description, preview: ReactNode, pro, disabled, title}].
   Pro-locked tiles stay clickable so onProClick can route to /upgrade. */
export function OptionGrid({ options, value, onChange, onProClick, columns, id }) {
  return (
    <div
      className="optgrid"
      id={id}
      style={columns ? { gridTemplateColumns: `repeat(${columns}, 1fr)` } : undefined}
    >
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          className={`optgrid__tile ${value === o.id ? "optgrid__tile--active" : ""}`}
          disabled={o.disabled}
          title={o.title}
          onClick={() => {
            if (o.disabled) return;
            if (o.pro && onProClick) return onProClick(o);
            onChange(o.id);
          }}
        >
          {o.preview}
          <span className="optgrid__label">
            {o.label}
            {o.pro && <ProBadge />}
          </span>
          {o.description && <span className="optgrid__desc">{o.description}</span>}
        </button>
      ))}
    </div>
  );
}
