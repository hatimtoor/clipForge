import { useRef, useState } from "react";

/* v2 Button. Ports PixelBtn's synchronous busyRef debounce verbatim: every
   click is ignored while the handler runs plus a 600ms cooldown, and promise
   handlers keep the button disabled until they settle. This is backend
   protection (prevents queueing duplicate jobs) — do not remove. */
export function Button({
  variant = "primary",
  size = "md",
  full,
  children,
  onClick,
  disabled,
  type = "button",
  id,
  className = "",
  title,
  ...rest
}) {
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false); // synchronous guard so rapid clicks can't slip through

  const handleClick = async (e) => {
    if (busyRef.current || disabled) return;
    busyRef.current = true;
    setBusy(true);
    try {
      await onClick?.(e);
    } finally {
      setTimeout(() => {
        busyRef.current = false;
        setBusy(false);
      }, 600);
    }
  };

  const cls = [
    "btn",
    variant !== "primary" && `btn--${variant}`,
    size !== "md" && `btn--${size}`,
    full && "btn--full",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      id={id}
      type={type}
      title={title}
      className={cls}
      onClick={handleClick}
      disabled={disabled || busy}
      {...rest}
    >
      {children}
    </button>
  );
}
