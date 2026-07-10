import { useRef, useEffect, useState } from "react";
import { useTheme } from "../../hooks/useTheme";
import { buildForge } from "./forgeScene";

const IDS = ["viral", "3xK9p", "aQ7", "Zr4tL", "M0n"];

/*
  Real-time WebGL forge animation for the landing hero. Mounts a <canvas>, builds
  the scene, and drives a small DOM overlay (fake URL bar + "N shorts ready" label).
  If WebGL is unavailable, buildForge throws, we swallow it, and onReady never fires —
  so the parent simply keeps the text hero. Pauses when scrolled out of view.
*/
export default function ForgeHero({ onReady, revealed, className }) {
  const canvasRef = useRef(null);
  const stageRef = useRef(null);
  const forgeRef = useRef(null);
  const idxRef = useRef(0);
  const theme = useTheme();
  const [vid, setVid] = useState("viral");
  const [labelOn, setLabelOn] = useState(false);

  useEffect(() => {
    let forge;
    try {
      forge = buildForge(canvasRef.current, stageRef.current, {
        skin: theme,
        onReady: () => onReady && onReady(),
        onLabel: (shown) => setLabelOn(shown),
        onCycle: () => { idxRef.current = (idxRef.current + 1) % IDS.length; setVid(IDS[idxRef.current]); },
      });
      forgeRef.current = forge;
    } catch {
      return; // no WebGL — parent keeps the text hero
    }
    const io = new IntersectionObserver(
      (entries) => forge.setRunning(entries[0].isIntersecting),
      { threshold: 0.02 }
    );
    io.observe(stageRef.current);
    return () => { io.disconnect(); forge.dispose(); forgeRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // build once

  useEffect(() => { if (forgeRef.current) forgeRef.current.setSkin(theme); }, [theme]);

  // On reveal, restart the timeline so the animation always plays from the beginning.
  useEffect(() => { if (revealed && forgeRef.current) forgeRef.current.restart(); }, [revealed]);

  return (
    <div ref={stageRef} className={className}>
      <canvas ref={canvasRef} className="lforge__canvas" />
      <div className="lforge__url">
        <span className="lforge__yt" aria-hidden="true" />
        <span className="lforge__urltxt"><b>youtube.com</b>/watch?v={vid}<span className="lforge__caret" /></span>
      </div>
      <div className={"lforge__label" + (labelOn ? " is-on" : "")}>
        <b>3 shorts ready</b>
        <span>captioned · scored · vertical</span>
      </div>
    </div>
  );
}
