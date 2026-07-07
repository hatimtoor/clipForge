import { useTheme } from "../../hooks/useTheme";
import { PixelSprite } from "../ui";

/* Renders a pixel sprite ONLY under the retro skin; modern shows nothing
   (or the `modern` fallback node if given). Wraps the legacy PixelSprite. */
export function RetroSprite({ data, palette, size = 4, style, modern = null }) {
  const theme = useTheme();
  if (theme !== "retro") return modern;
  return (
    <span className="px-crisp" style={{ display: "inline-flex" }}>
      <PixelSprite data={data} palette={palette} size={size} style={style} />
    </span>
  );
}
