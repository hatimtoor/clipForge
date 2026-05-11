/**
 * ClipForge -- Pixel UI (drop-in replacement for App.jsx)
 *
 * INSTALL
 *   1. Replace your existing App.jsx with this file.
 *   2. In your public/index.html, add these <link> tags inside <head>:
 *
 *      <link rel="preconnect" href="https://fonts.googleapis.com">
 *      <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
 *      <link href="https://fonts.googleapis.com/css2?family=Press+Start+2P&family=VT323&family=JetBrains+Mono:wght@400;500;600;700&display=swap" rel="stylesheet">
 *
 *   3. That's it. Every endpoint, every fetch, every poll, every auth path is
 *      preserved from the original -- only the visual layer changed.
 *
 * Endpoints used (unchanged):
 *   POST /api/clip                           -- start a job
 *   GET  /api/status/:jobId                  -- poll job status
 *   GET  /api/jobs                           -- past jobs + auth check
 *   GET  /api/youtube/status                 -- connection state
 *   GET  /api/youtube/auth                   -- OAuth start (returns auth_url)
 *   POST /api/youtube/upload/:jobId/:clipIdx -- start clip upload
 *   GET  /api/youtube/upload_status/...      -- poll upload progress
 *   GET  <clip.path>                         -- clip mp4 (auth required)
 */
import { useState, useEffect, useRef } from "react";

const API = "";
const authFetch = (url, options = {}) => {
  const raw = sessionStorage.getItem("cf_auth") ?? "";
  const auth = raw.startsWith("Basic ") ? raw.slice(6) : raw;
  return fetch(url, {
    ...options,
    headers: { ...(options.headers || {}), "X-Clip-Auth": auth },
  });
};

/*  pixel tokens  */
const C = {
  ink: "#1a0d2e",
  cream: "#f4ecd6",
  cream2: "#ebe1c4",
  paper: "#fef7e4",
  signal: "#7ddca0",
  signalDeep: "#3aa86a",
  hot: "#f5a3c7",
  hotDeep: "#d4669a",
  amber: "#f5d76e",
  amberDeep: "#d4ad3a",
  lavender: "#c8b3ec",
  lavenderDeep: "#9b7ed4",
  peach: "#ffc4a3",
  yt: "#ff7a7a",
  ytDeep: "#d44a4a",
  dim: "#6b5b8a",
  dim2: "#4a3d68",
  windowBg: "#2a1d4a",
};
const SHADOW = `5px 5px 0 ${C.ink}`;
const SHADOW_SM = `3px 3px 0 ${C.ink}`;
const BORDER = `3px solid ${C.ink}`;
const BORDER_SM = `2px solid ${C.ink}`;

const STAGE_LABELS = { downloading:"DOWNLOAD", merging:"MERGE", transcribing:"TRANSCRIBE", analyzing:"ANALYZE", clipping:"CLIP", done:"DONE" };

const KEYFRAMES = `
  *,*::before,*::after{box-sizing:border-box;image-rendering:pixelated}
  html,body,#root{min-height:100vh}
  body{
    margin:0; color:${C.ink};
    font-family:'JetBrains Mono',ui-monospace,monospace;
    background:linear-gradient(180deg,#b8a5e8 0%,#d8b6e0 30%,#f4c4d8 55%,#ffd2b8 80%,#ffe8c8 100%);
    background-attachment:fixed;
  }
  body::before{
    content:"";position:fixed;inset:0;pointer-events:none;z-index:0;
    background-image:
      radial-gradient(circle at 12% 18%, #fff 0 6px, transparent 7px),
      radial-gradient(circle at 14% 16%, #fff 0 8px, transparent 9px),
      radial-gradient(circle at 16% 18%, #fff 0 6px, transparent 7px),
      radial-gradient(circle at 78% 12%, #fff 0 5px, transparent 6px),
      radial-gradient(circle at 80% 13%, #fff 0 7px, transparent 8px),
      radial-gradient(circle at 82% 12%, #fff 0 5px, transparent 6px),
      radial-gradient(circle at 45% 8%, #fff 0 4px, transparent 5px);
    opacity:.7;
  }
  body::after{
    content:"";position:fixed;inset:0;pointer-events:none;z-index:0;
    background-image:repeating-linear-gradient(0deg,rgba(26,13,46,0.04) 0 1px,transparent 1px 4px);
  }
  ::-webkit-scrollbar{width:14px;height:14px}
  ::-webkit-scrollbar-track{background:#e8d8b8;border-left:3px solid ${C.ink}}
  ::-webkit-scrollbar-thumb{background:${C.lavenderDeep};border:3px solid ${C.ink};border-radius:0}
  button,input,textarea,select{font-family:inherit;outline:none;border:none;color:inherit}
  .pixel{font-family:'Press Start 2P',monospace;letter-spacing:0;line-height:1.4}
  .vt{font-family:'VT323',monospace;letter-spacing:.02em}
  .mono{font-family:'JetBrains Mono',monospace}
  @keyframes blink{50%{opacity:0}}
  @keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
  @keyframes bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-4px)}}
  @keyframes spin{to{transform:rotate(360deg)}}
  @keyframes pop{from{transform:scale(.85)}to{transform:scale(1)}}
  @keyframes hammer{0%,100%{transform:rotate(-15deg)}45%{transform:rotate(50deg)}55%{transform:rotate(50deg)}}
  @keyframes spark{0%{opacity:0;transform:scale(0)}30%{opacity:1;transform:scale(1)}100%{opacity:0;transform:scale(1.5)}}
  @keyframes drift{from{transform:translateX(-30px)}to{transform:translateX(calc(100vw + 30px))}}
  .fade{animation:pop .25s ease both}
  #root{position:relative;z-index:1}
`;

/*  helpers  */
const fmtTime = (s) => {
  const m = Math.floor((s||0)/60); const sec = Math.floor((s||0)%60);
  return `${m}:${String(sec).padStart(2,"0")}`;
};
const timeAgo = (iso) => {
  if (!iso) return "";
  const d = Math.floor((Date.now() - new Date(iso))/1000);
  if (d<60) return `${d}s ago`;
  if (d<3600) return `${Math.floor(d/60)}m ago`;
  if (d<86400) return `${Math.floor(d/3600)}h ago`;
  return `${Math.floor(d/86400)}d ago`;
};

/*  pixel sprites  */
const PixelSprite = ({ data, size=4, palette, style }) => {
  const cols = data[0].length;
  return (
    <div style={{display:"grid",gridTemplateColumns:`repeat(${cols},${size}px)`,gridAutoRows:`${size}px`,...style}}>
      {data.flatMap((row, ri) => row.split('').map((ch, ci) => (
        <div key={`${ri}-${ci}`} style={{background: ch==='.' ? "transparent" : palette[ch] || "transparent"}}/>
      )))}
    </div>
  );
};
const ANVIL = ["...........","...XXXXX...","..XGGGGGX..",".XGGGGGGGX.","XGGGGGGGGGX","XGGGGGGGGGX","..XGGGGGX..","...XGGGX...","..XGGGGGX..",".XXXXXXXXX.","XXXXXXXXXXX"];
const ANVIL_PAL = { X:C.ink, G:"#888899" };
const HAMMER = ["....HHHHHH...","...HKKKKKKH..","..HKKKKKKKKH.","..HKKKKKKKKH.","...HKKKKKKH..","....HHWWHH...",".....HWWH....",".....HWWH....",".....HWWH....",".....HWWH...."];
const HAMMER_PAL = { H:C.ink, K:"#aa6644", W:"#7a4a2a" };

/*  primitives  */
function PixelBtn({ color="signal", size="md", full, children, onClick, disabled, type, style: ext }) {
  const colors = {
    signal:{bg:C.signal,deep:C.signalDeep}, hot:{bg:C.hot,deep:C.hotDeep},
    amber:{bg:C.amber,deep:C.amberDeep}, lavender:{bg:C.lavender,deep:C.lavenderDeep},
    cream:{bg:C.cream,deep:"#c4b88e"}, yt:{bg:C.yt,deep:C.ytDeep},
    danger:{bg:"#ff8888",deep:"#cc4444"},
  }[color];
  const s = { sm:{p:"6px 12px",f:9}, md:{p:"10px 18px",f:10}, lg:{p:"14px 24px",f:11} }[size];
  const [pressed, setPressed] = useState(false);
  const off = pressed ? 0 : 4;
  return (
    <button
      type={type} onClick={onClick} disabled={disabled}
      onMouseDown={()=>setPressed(true)} onMouseUp={()=>setPressed(false)} onMouseLeave={()=>setPressed(false)}
      className="pixel"
      style={{
        background:colors.bg, color:C.ink, padding:s.p, fontSize:s.f,
        border:BORDER, boxShadow:`${off}px ${off}px 0 ${C.ink}`,
        transform:`translate(${pressed?4:0}px,${pressed?4:0}px)`,
        cursor:disabled?"not-allowed":"pointer", opacity:disabled?.5:1,
        width:full?"100%":"auto", display:"inline-flex", alignItems:"center", justifyContent:"center", gap:8,
        textTransform:"uppercase", transition:"transform .04s,box-shadow .04s",
        userSelect:"none", ...ext,
      }}
    >{children}</button>
  );
}

const PixelCard = ({ children, color=C.cream, padding=24, style, ...p }) => (
  <div style={{background:color,border:BORDER,boxShadow:SHADOW,padding,position:"relative",...style}} {...p}>{children}</div>
);

const Tag = ({ children, color=C.ink, bg=C.cream2 }) =>
  <span className="pixel" style={{display:"inline-flex",alignItems:"center",gap:4,fontSize:8,color,background:bg,padding:"4px 8px",border:`2px solid ${C.ink}`,boxShadow:`2px 2px 0 ${C.ink}`,textTransform:"uppercase"}}>{children}</span>;

const Field = ({ label, children }) => (
  <div>
    <div className="pixel" style={{fontSize:8,color:C.dim2,marginBottom:6}}>{label}</div>
    {children}
  </div>
);

function NumField({ label, suffix, value, setValue, min, max, step, bg }) {
  const dec = () => setValue(Math.max(min, value-step));
  const inc = () => setValue(Math.min(max, value+step));
  return (
    <div>
      <div className="pixel" style={{fontSize:8,color:C.dim2,marginBottom:6}}>{label}</div>
      <div style={{display:"flex",border:BORDER,boxShadow:SHADOW_SM,background:bg}}>
        <button onClick={dec} className="pixel" style={{width:32,padding:"10px 0",background:"transparent",borderRight:`2px solid ${C.ink}`,fontSize:14,cursor:value>min?"pointer":"not-allowed",color:value>min?C.ink:C.dim}}>-</button>
        <div className="pixel" style={{flex:1,textAlign:"center",padding:"10px 0",fontSize:16,color:C.ink}}>{value}{suffix||""}</div>
        <button onClick={inc} className="pixel" style={{width:32,padding:"10px 0",background:"transparent",borderLeft:`2px solid ${C.ink}`,fontSize:14,cursor:value<max?"pointer":"not-allowed",color:value<max?C.ink:C.dim}}>+</button>
      </div>
    </div>
  );
}

function Toggle({ on, setOn, label, hint }) {
  return (
    <button onClick={()=>setOn(!on)} className="pixel" style={{
      textAlign:"left",padding:14,
      background: on?C.signal:C.paper,
      color:C.ink,border:BORDER,
      boxShadow: on?`2px 2px 0 ${C.ink}`:SHADOW_SM,
      cursor:"pointer", transform:on?"translate(2px,2px)":"none",
    }}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
        <span style={{fontSize:10}}>{label}</span>
        <div style={{width:18,height:10,background:on?C.ink:C.cream2,border:`2px solid ${C.ink}`,position:"relative"}}>
          <div style={{position:"absolute",top:-2,left:on?6:-2,width:8,height:10,background:on?C.signal:C.dim,border:`2px solid ${C.ink}`,transition:"left .1s"}}/>
        </div>
      </div>
      <div className="vt" style={{fontSize:14,color:C.dim2,letterSpacing:0,textTransform:"none",lineHeight:1.2}}>{hint}</div>
    </button>
  );
}

/*  progress bar  */
const ProgressBar = ({ progress, color = C.hot }) => (
  <div style={{height:24,background:C.paper,border:BORDER,padding:3}}>
    <div style={{height:"100%",width:`${progress}%`,background:color,borderRight:`2px solid ${C.ink}`,transition:"width .08s linear",position:"relative",overflow:"hidden"}}>
      <div style={{position:"absolute",inset:0,backgroundImage:"repeating-linear-gradient(45deg,rgba(0,0,0,.12) 0 4px,transparent 4px 8px)"}}/>
    </div>
  </div>
);

/*  numbered step indicator boxes  */
function PhaseSteps({ status }) {
  const steps = [
    { key: "downloading",  num: "01", label: "DOWNLOAD",   color: C.hot },
    { key: "merging",      num: "02", label: "MERGE",      color: C.peach },
    { key: "transcribing", num: "03", label: "TRANSCRIBE", color: C.amber },
    { key: "analyzing",    num: "04", label: "ANALYZE",    color: C.lavender },
    { key: "clipping",     num: "05", label: "CLIP",       color: C.signal },
  ];
  const isDone = status === "done";
  const currentIdx = steps.findIndex(s => s.key === status);
  return (
    <div style={{display:"flex", gap:6}}>
      {steps.map((step, i) => {
        const isActive = !isDone && i === currentIdx;
        const isComplete = isDone || i < currentIdx;
        return (
          <div key={step.key} style={{
            flex:1, padding:"12px 4px", textAlign:"center",
            background: isComplete || isActive ? step.color : C.cream2,
            border: BORDER,
            boxShadow: isActive ? `4px 4px 0 ${C.ink}` : `2px 2px 0 ${C.ink}`,
            transform: isActive ? "translate(-2px,-2px)" : "none",
            transition: "transform .1s, box-shadow .1s",
          }}>
            <div className="pixel" style={{fontSize:7, color: C.ink}}>
              {step.label}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/*  segmented 4-block progress bar  */
function SegmentedProgressBar({ displayProgress, status }) {
  const isDone = status === "done";
  const currentIdx = PHASE_BLOCKS.findIndex(b => b.key === status);

  return (
    <div style={{display:"flex",gap:6}}>
      {PHASE_BLOCKS.map((block, i) => {
        const [start, end] = PHASE_RANGES[block.key];
        let fill;
        if (isDone || i < currentIdx) {
          fill = 100;
        } else if (i === currentIdx) {
          fill = Math.min(100, Math.max(0, (displayProgress - start) / (end - start) * 100));
        } else {
          fill = 0;
        }
        const isActive = !isDone && i === currentIdx;
        const isComplete = isDone || i < currentIdx;

        return (
          <div key={block.key} style={{flex:1,display:"flex",flexDirection:"column",gap:4}}>
            <div style={{height:22,background:C.paper,border:`2px solid ${C.ink}`,padding:2,position:"relative",overflow:"hidden"}}>
              <div style={{
                height:"100%", width:`${fill}%`,
                background: isComplete ? block.color : block.color,
                transition:"width .08s linear",
                position:"relative", overflow:"hidden",
              }}>
                {isActive && <div style={{position:"absolute",inset:0,backgroundImage:"repeating-linear-gradient(45deg,rgba(0,0,0,.15) 0 4px,transparent 4px 8px)"}}/>}
              </div>
            </div>
            <div className="pixel" style={{
              fontSize:7, textAlign:"center", color: C.ink,
            }}>
              {isActive ? `${Math.round(fill)}%` : isComplete ? "DONE" : "--"}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/*  header  */
function Header({ tab, setTab, ytStatus, onConnectYT, onLogout, jobActive }) {
  const ytConnected = ytStatus?.connected;
  return (
    <header style={{position:"relative",padding:"24px 32px 0"}}>
      <div style={{display:"flex",alignItems:"flex-start",gap:24,maxWidth:1320,margin:"0 auto",flexWrap:"wrap"}}>
        <div style={{display:"flex",alignItems:"center",gap:14}}>
          <PixelSprite data={ANVIL} palette={ANVIL_PAL} size={5}/>
          <div>
            <div className="pixel" style={{fontSize:22,color:C.ink,lineHeight:1}}>
              <span style={{color:C.hotDeep}}>CLIP</span><span>FORGE</span>
            </div>
            <div className="vt" style={{fontSize:18,color:C.dim2,marginTop:4}}>{`>`} roll tape to forge</div>
          </div>
        </div>
        <div style={{flex:1}}/>
        <nav style={{display:"flex",gap:10,flexWrap:"wrap"}}>
          {[["new","HELLO"],["processing", jobActive?"LIVE":"WORK"],["history","ARCHIVE"]].map(([k,l]) => {
            const active = tab===k;
            const col = k==="new"?C.signal : k==="processing"?C.hot : C.amber;
            return (
              <button key={k} onClick={()=>setTab(k)} className="pixel" style={{
                background: active ? col : C.cream, color:C.ink,
                padding:"10px 16px", fontSize:11, border:BORDER,
                boxShadow: active ? `0px 0px 0 ${C.ink}` : SHADOW_SM,
                transform: active ? "translate(3px,3px)" : "translate(0,0)",
                cursor:"pointer", textTransform:"uppercase", position:"relative",
              }}>
                {l}{k==="processing" && jobActive && <span style={{display:"inline-block",width:8,height:8,background:C.ink,marginLeft:6,animation:"blink 1s steps(1) infinite"}}/>}
              </button>
            );
          })}
          {ytConnected
            ? <span className="pixel" style={{display:"inline-flex",alignItems:"center",gap:6,padding:"10px 14px",fontSize:9,background:C.yt,color:C.ink,border:BORDER,boxShadow:SHADOW_SM}}>* {ytStatus.channel_name || "YT"}</span>
            : <button onClick={onConnectYT} className="pixel" style={{padding:"10px 14px",fontSize:9,background:C.cream,color:C.ink,border:BORDER,boxShadow:SHADOW_SM,cursor:"pointer",textTransform:"uppercase"}}>+ YT</button>}
          <button onClick={onLogout} className="pixel" title="Sign out" style={{padding:"10px 12px",fontSize:11,background:C.cream,color:C.ink,border:BORDER,boxShadow:SHADOW_SM,cursor:"pointer"}}>X</button>
        </nav>
      </div>
    </header>
  );
}

/*  NEW CLIP  */
function NewClip({ url, setUrl, maxClips, setMaxClips, minDur, setMinDur, maxDur, setMaxDur, onSubmit, error }) {
  const [hooks, setHooks] = useState(true);
  const [captions, setCaptions] = useState(true);
  const valid = /youtu\.?be/.test(url);

  return (
    <div className="fade" style={{padding:"32px 32px 64px",maxWidth:1320,margin:"0 auto"}}>
      <div style={{display:"grid",gridTemplateColumns:"minmax(0,1.55fr) minmax(0,1fr)",gap:32,alignItems:"start"}}>
        <PixelCard color={C.cream} padding={32}>
          <div className="pixel" style={{fontSize:10,color:C.hotDeep,marginBottom:16}}>{`>`} NEW JOB - STANDING BY</div>
          <h1 className="pixel" style={{fontSize:30,lineHeight:1.3,color:C.ink,marginBottom:14}}>
            Drop a long video.<br/>
            <span style={{color:C.signalDeep}}>Pull the moments<br/>that travel.</span>
          </h1>
          <p className="vt" style={{fontSize:22,color:C.dim2,lineHeight:1.4,marginBottom:28,maxWidth:560}}>
            ⚡ One YouTube link in. <strong style={{color:C.ink}}>Up to 10 viral-ready shorts</strong> out -- captions burned, hooks scored, ready to ship. ✂️
          </p>

          <div className="pixel" style={{fontSize:9,color:C.dim2,marginBottom:8}}>YOUTUBE URL</div>
          <div style={{display:"flex",alignItems:"center",gap:10,padding:"14px 16px",background:C.paper,border:BORDER,boxShadow:valid?`4px 4px 0 ${C.signalDeep}`:`4px 4px 0 ${C.ink}`,marginBottom:24,transition:"box-shadow .15s"}}>
            <span className="pixel" style={{fontSize:12,color:valid?C.signalDeep:C.dim}}>{`>`}</span>
            <input value={url} onChange={e=>setUrl(e.target.value)}
              onKeyDown={e=>e.key==="Enter"&&valid&&onSubmit()}
              placeholder="https://youtube.com/watch?v="
              className="mono" style={{flex:1,background:"transparent",color:C.ink,fontSize:15,fontWeight:500,minWidth:0}}/>
            {url && <button onClick={()=>setUrl("")} className="pixel" style={{background:"transparent",color:C.dim,fontSize:9,cursor:"pointer"}}>x</button>}
            {valid && <Tag color={C.signalDeep} bg={C.signal}>v OK</Tag>}
          </div>

          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:14,marginBottom:24}}>
            <NumField label="MAX CLIPS" value={maxClips} setValue={setMaxClips} min={1} max={10} step={1} bg={C.lavender}/>
            <NumField label="MIN DUR" suffix="s" value={minDur} setValue={setMinDur} min={15} max={60} step={5} bg={C.peach}/>
            <NumField label="MAX DUR" suffix="s" value={maxDur} setValue={setMaxDur} min={30} max={180} step={10} bg={C.amber}/>
          </div>

          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:24}}>
            <Toggle on={hooks} setOn={setHooks} label="HOOKS" hint="find the line that travels"/>
            <Toggle on={captions} setOn={setCaptions} label="CAPS" hint="burn word-by-word subs"/>
          </div>

          {error && (
            <div className="pixel" style={{padding:"10px 12px",background:`${C.hot}55`,border:`2px solid ${C.hotDeep}`,color:C.hotDeep,fontSize:9,marginBottom:16}}>
              ! {error}
            </div>
          )}

          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",paddingTop:18,borderTop:`2px dashed ${C.ink}33`,gap:14,flexWrap:"wrap"}}>
            <div className="vt" style={{fontSize:18,color:C.dim2}}>Ctrl+V to paste - Enter to forge - est. 2-4 min</div>
            <PixelBtn color="hot" size="lg" onClick={onSubmit} disabled={!valid}>{`>`} ROLL TAPE</PixelBtn>
          </div>
        </PixelCard>

        <aside style={{display:"flex",flexDirection:"column",gap:18}}>
          <PixelCard color={C.paper} padding={22}>
            <div className="pixel" style={{fontSize:10,color:C.dim2,marginBottom:14}}>WHAT WE LOOK FOR</div>
            <ul style={{listStyle:"none",margin:0,padding:0,display:"flex",flexDirection:"column",gap:14}}>
              {[
                ["⚡","Tension shifts","Moments where energy changes register."],
                ["💰","Numbers & names","Specific dollar figures, ages, places."],
                ["🌶️","Contrarian frames","Statements that invite disagreement."],
                ["💬","Confessions","First-person admissions land everywhere."],
              ].map(([emoji,h,d]) => (
                <li key={h} style={{display:"grid",gridTemplateColumns:"32px 1fr",gap:12,alignItems:"start"}}>
                  <div style={{fontSize:20}}>{emoji}</div>
                  <div>
                    <div className="pixel" style={{fontSize:10,color:C.ink}}>{h}</div>
                    <div className="vt" style={{fontSize:18,color:C.dim2,lineHeight:1.3,marginTop:3}}>{d}</div>
                  </div>
                </li>
              ))}
            </ul>
          </PixelCard>

          <PixelCard color={C.lavender} padding={20}>
            <div className="pixel" style={{fontSize:10,color:C.ink,marginBottom:10}}><span style={{fontSize:20}}>💁‍♂️</span> TIP</div>
            <p className="vt" style={{fontSize:18,color:C.ink,lineHeight:1.35}}>
              Long videos can take 5-10 min. Your job keeps swinging on the server even if you close this tab -- find it under <strong>ARCHIVE</strong>.
            </p>
          </PixelCard>
        </aside>
      </div>
    </div>
  );
}

/*  PROCESSING / RESULTS combined  */
function ProcessingTab({ job, onReset, ytStatus, onYTUpload, refreshJob }) {
  if (!job) {
    return (
      <div className="fade" style={{padding:"64px 32px",maxWidth:1320,margin:"0 auto"}}>
        <PixelCard color={C.cream} padding={48} style={{textAlign:"center"}}>
          <div className="pixel" style={{fontSize:11,color:C.dim2,marginBottom:14}}>NO ACTIVE JOB</div>
          <h2 className="pixel" style={{fontSize:22,color:C.ink,marginBottom:18}}>The forge is cold.</h2>
          <p className="vt" style={{fontSize:20,color:C.dim2,marginBottom:24}}>Start a new clip to fire it up.</p>
        </PixelCard>
      </div>
    );
  }

  if (job.status === "error") {
    return (
      <div className="fade" style={{padding:"32px 32px 64px",maxWidth:920,margin:"0 auto"}}>
        <PixelCard color={C.hot} padding={32} style={{textAlign:"center"}}>
          <div className="pixel" style={{fontSize:11,color:C.ink,marginBottom:12}}>! JOB FAILED</div>
          <p className="pixel" style={{fontSize:14,color:C.ink,lineHeight:1.5,marginBottom:24}}>
            {(job.error || "Something went wrong.").split("\n").pop()}
          </p>
          <PixelBtn color="cream" onClick={onReset} size="lg">{`>`} TRY AGAIN</PixelBtn>
        </PixelCard>
      </div>
    );
  }

  if (job.status === "done") {
    return <Results job={job} onNew={onReset} ytStatus={ytStatus} onYTUpload={onYTUpload} refreshJob={refreshJob}/>;
  }

  return <LiveProcessing job={job} onCancel={onReset}/>;
}

/*  LIVE PROCESSING  */
// Segmented bar config — one block per phase
const PHASE_BLOCKS = [
  { key: "downloading",  label: "DOWNLOAD",   color: C.hot },
  { key: "merging",      label: "MERGE",      color: C.peach },
  { key: "transcribing", label: "TRANSCRIBE", color: C.amber },
  { key: "analyzing",    label: "ANALYZE",    color: C.lavender },
  { key: "clipping",     label: "CLIP",       color: C.signal },
];

// Global progress range [start, end] for each phase
const PHASE_RANGES = {
  downloading:  [0,  37],
  merging:      [37, 40],
  transcribing: [40, 65],
  analyzing:    [65, 77],
  clipping:     [77, 100],
};

function LiveProcessing({ job, onCancel }) {
  const [elapsed, setElapsed] = useState(0);
  const [displayProgress, setDisplayProgress] = useState(job.progress || 0);
  const lastServerProgress = useRef(job.progress || 0);
  const lastServerTime = useRef(Date.now());

  useEffect(() => { const i = setInterval(()=>setElapsed(s=>s+1),1000); return ()=>clearInterval(i); }, []);

  // Snap to real server progress whenever it changes
  useEffect(() => {
    const p = job.progress || 0;
    if (p !== lastServerProgress.current) {
      lastServerProgress.current = p;
      lastServerTime.current = Date.now();
      setDisplayProgress(p);
    }
  }, [job.progress]);

  // Creep the bar forward when server goes quiet (merge step, API calls, etc.)
  useEffect(() => {
    // Stop 0.5 units before phase end so server confirmation never snaps backwards
    const phaseEnd = PHASE_RANGES[job.status]?.[1] ?? 100;
    const ceiling = phaseEnd - 0.5;
    const id = setInterval(() => {
      if (Date.now() - lastServerTime.current > 1500) {
        setDisplayProgress(p => p < ceiling ? Math.min(p + 0.2, ceiling) : p);
      }
    }, 300);
    return () => clearInterval(id);
  }, [job.status]);

  const elapsedStr = `${Math.floor(elapsed/60)}:${String(elapsed%60).padStart(2,"0")}`;

  // Phase-specific % for the sidebar big number
  const [phaseStart, phaseEnd] = PHASE_RANGES[job.status] || [0, 100];
  const phaseProgress = Math.min(100, Math.max(0,
    (displayProgress - phaseStart) / (phaseEnd - phaseStart) * 100
  ));

  return (
    <div className="fade" style={{padding:"32px 32px 64px",maxWidth:1320,margin:"0 auto",display:"grid",gridTemplateColumns:"minmax(0,1fr) 360px",gap:24,alignItems:"start"}}>
      <div style={{display:"flex",flexDirection:"column",gap:18,minWidth:0}}>
        <PixelCard color={C.cream} padding={28}>
          <div className="pixel" style={{fontSize:10,color:C.hotDeep,marginBottom:14}}>* LIVE - {elapsedStr}</div>
          <h1 className="pixel" style={{fontSize:24,color:C.ink,lineHeight:1.3,marginBottom:8}}>
            {job.message || "Forging clips"}
          </h1>
          <div className="vt" style={{fontSize:18,color:C.dim2,wordBreak:"break-all"}}>{job.url}</div>

          {/* anvil scene */}
          <div style={{position:"relative",height:120,marginTop:20,marginBottom:8,background:C.peach,border:BORDER_SM,overflow:"hidden"}}>
            {[0,1,2,3,4].map(i => (
              <div key={i} style={{position:"absolute",top:34+(i%2)*8,left:`${44+i*4}%`,width:6,height:6,background:C.amber,border:`1px solid ${C.ink}`,animation:`spark .8s ${i*.15}s ease-out infinite`}}/>
            ))}
            <div style={{position:"absolute",bottom:14,left:"50%",transform:"translateX(-50%)"}}>
              <PixelSprite data={ANVIL} palette={ANVIL_PAL} size={6}/>
            </div>
            <div style={{position:"absolute",bottom:64,left:"calc(50% + 8px)",transformOrigin:"bottom center",animation:"hammer 0.7s ease-in-out infinite"}}>
              <PixelSprite data={HAMMER} palette={HAMMER_PAL} size={5}/>
            </div>
            <div style={{position:"absolute",top:8,left:0,width:18,height:8,background:"#fff",border:`2px solid ${C.ink}`,animation:"drift 18s linear infinite"}}/>
            <div style={{position:"absolute",top:22,left:0,width:14,height:6,background:"#fff",border:`2px solid ${C.ink}`,animation:"drift 24s 3s linear infinite"}}/>
          </div>

          <div style={{marginTop:22, display:"flex", flexDirection:"column", gap:10}}>
            <SegmentedProgressBar displayProgress={displayProgress} status={job.status}/>
            <PhaseSteps status={job.status}/>
          </div>
        </PixelCard>

        <PixelCard color={C.paper} padding={20}>
          <div className="pixel" style={{fontSize:10,color:C.dim2,marginBottom:8}}>STATUS</div>
          <p className="vt" style={{fontSize:20,color:C.ink,lineHeight:1.35}}>
            Large videos can take 5-10 minutes. Each block fills as that stage runs and locks when it completes.
          </p>
        </PixelCard>
      </div>

      <div style={{display:"flex",flexDirection:"column",gap:18}}>
        <PixelCard color={C.lavender} padding={22}>
          <div className="pixel" style={{fontSize:9,color:C.ink,marginBottom:10}}>JOB - {(job.job_id||"--").slice(0,12)}</div>
          <div className="pixel" style={{fontSize:42,color:C.ink,lineHeight:1,marginBottom:6}}>{Math.round(phaseProgress)}<span style={{fontSize:18,color:C.dim2}}>%</span></div>
          <div className="vt" style={{fontSize:18,color:C.dim2,marginBottom:18}}>this stage</div>
          <Row k="STAGE"   v={STAGE_LABELS[job.status] || job.status?.toUpperCase()} color={C.hotDeep}/>
          <Row k="ELAPSED" v={elapsedStr}/>
          <Row k="ETA"     v={`~${Math.max(1,4-Math.floor(elapsed/60))}M`}/>
          <div style={{marginTop:18}}>
            <PixelBtn color="danger" full onClick={onCancel}>X CLOSE / NEW</PixelBtn>
          </div>
        </PixelCard>
      </div>
    </div>
  );
}

const Row = ({ k, v, color=C.ink }) => (
  <div className="pixel" style={{display:"flex",justifyContent:"space-between",padding:"5px 0",fontSize:9}}>
    <span style={{color:C.dim2}}>{k}</span><span style={{color}}>{v}</span>
  </div>
);

/*  RESULTS (clips list)  */
function Results({ job, onNew, ytStatus, onYTUpload }) {
  const clips = job.clips || [];
  const palette = [C.hot, C.signal, C.amber, C.lavender, C.peach];
  const [active, setActive] = useState(null);
  const [blobUrl, setBlobUrl] = useState(null);

  useEffect(() => {
    if (!active) { setBlobUrl(null); return; }
    let cancelled = false;
    setBlobUrl(null);
    authFetch(active.path).then(r=>r.blob()).then(b => {
      if (!cancelled) setBlobUrl(URL.createObjectURL(b));
    }).catch(()=>{});
    return () => { cancelled = true; };
  }, [active?.path]);

  return (
    <div className="fade" style={{padding:"32px 32px 64px",maxWidth:1380,margin:"0 auto"}}>
      <PixelCard color={C.signal} padding={26} style={{marginBottom:24}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:18,flexWrap:"wrap"}}>
          <div>
            <div className="pixel" style={{fontSize:10,color:C.ink,marginBottom:8}}>v DELIVERED</div>
            <h1 className="pixel" style={{fontSize:26,color:C.ink,lineHeight:1.2}}>
              <span style={{color:C.hotDeep,fontSize:36}}>{clips.length}</span> {clips.length===1?"clip":"clips"} ready to ship!
            </h1>
          </div>
          <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
            <PixelBtn color="hot" size="md" onClick={onNew}>+ NEW CLIP</PixelBtn>
          </div>
        </div>
      </PixelCard>

      <div style={{display:"grid",gridTemplateColumns:active ? "minmax(0,1fr) 340px" : "1fr",gap:28,alignItems:"start"}}>
        <div style={{display:"flex",flexDirection:"column",gap:18,minWidth:0}}>
          {clips.map((c, i) => (
            <ClipCard
              key={i} clip={c} idx={i}
              cardColor={palette[i % palette.length]}
              ytConnected={!!ytStatus?.connected}
              isActive={active?.path === c.path}
              onPreview={() => setActive(c)}
              onYTUpload={() => onYTUpload(c, i)}
              jobId={job.job_id}
            />
          ))}
          {clips.length === 0 && (
            <PixelCard color={C.cream} padding={32} style={{textAlign:"center"}}>
              <p className="vt" style={{fontSize:20,color:C.dim2}}>No clips were generated. Try a different video.</p>
            </PixelCard>
          )}
        </div>

        {active && (
          <div style={{position:"sticky",top:24}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
              <div className="pixel" style={{fontSize:9,color:C.dim2}}>NOW PREVIEWING</div>
              <button onClick={()=>setActive(null)} className="pixel" style={{padding:"4px 8px",fontSize:9,background:C.cream,border:BORDER_SM,boxShadow:`2px 2px 0 ${C.ink}`,cursor:"pointer"}}>x</button>
            </div>
            <div style={{background:C.windowBg,border:BORDER,boxShadow:SHADOW,padding:0,overflow:"hidden"}}>
              <div style={{aspectRatio:"9/16",background:C.windowBg,position:"relative"}}>
                {blobUrl ? (
                  <video src={blobUrl} controls autoPlay style={{width:"100%",height:"100%",display:"block",background:"#000"}}/>
                ) : (
                  <div style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:10}}>
                    <div style={{width:24,height:24,border:`3px solid ${C.signal}`,borderTopColor:"transparent",animation:"spin .7s linear infinite"}}/>
                    <span className="pixel" style={{fontSize:9,color:C.signal}}>LOADING</span>
                  </div>
                )}
              </div>
            </div>
            <div style={{marginTop:14}}>
              <Tag bg={C.cream}>CLIP {String((clips.indexOf(active))+1).padStart(2,"0")}</Tag>
              <p className="vt" style={{fontSize:18,color:C.ink,marginTop:10,lineHeight:1.35}}>{active.hook || active.title}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/*  ClipCard  */
function ClipCard({ clip, idx, cardColor, isActive, onPreview, onYTUpload, ytConnected, jobId }) {
  const [downloading, setDownloading] = useState(false);
  const handleDownload = async () => {
    setDownloading(true);
    try {
      const res = await authFetch(clip.path);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = clip.filename || `clip_${idx+1}.mp4`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } finally { setDownloading(false); }
  };
  const ytUp = clip.yt_upload;
  const score = clip.virality_score || 0;
  const fillBlocks = Math.round(score / 2); // 0-5 blocks for 0-10 score

  return (
    <div style={{
      background:cardColor, border:BORDER,
      boxShadow: isActive ? `8px 8px 0 ${C.ink}` : SHADOW,
      transform: isActive ? "translate(-3px,-3px)" : "none",
      transition:"transform .1s, box-shadow .1s",
    }}>
      <div style={{display:"grid",gridTemplateColumns:"140px minmax(0,1fr) auto",alignItems:"stretch"}}>
        <div style={{padding:"22px 16px",borderRight:BORDER,background:`${C.cream}66`,textAlign:"center"}}>
          <div className="pixel" style={{fontSize:32,color:C.ink,lineHeight:1}}>{score.toFixed(1)}</div>
          <div className="pixel" style={{fontSize:7,color:C.dim2,marginTop:8}}>VIRALITY / 10</div>
          <div style={{display:"flex",gap:2,justifyContent:"center",marginTop:10}}>
            {Array.from({length:5}).map((_,k) => (
              <div key={k} style={{width:10,height:10,background:k<fillBlocks?C.ink:`${C.ink}22`,border:`1px solid ${C.ink}`}}/>
            ))}
          </div>
        </div>
        <div style={{padding:"22px 22px",minWidth:0}}>
          <div style={{display:"flex",gap:8,marginBottom:12,flexWrap:"wrap"}}>
            <Tag bg={C.cream}>CLIP {String(idx+1).padStart(2,"0")}</Tag>
            <Tag bg={C.cream}>{fmtTime(clip.start)} -{`>`} {fmtTime(clip.end)}</Tag>
            <Tag bg={C.cream}>{clip.duration}S</Tag>
          </div>
          <h3 className="pixel" style={{fontSize:13,color:C.ink,lineHeight:1.5,marginBottom:10}}>
            {clip.title || `Clip ${idx+1}`}
          </h3>
          {clip.hook && (
            <p className="vt" style={{fontSize:18,color:C.ink,marginBottom:8,fontStyle:"italic",lineHeight:1.3}}>
              "{clip.hook}"
            </p>
          )}
          {clip.reason && (
            <p className="vt" style={{fontSize:17,color:C.dim2,lineHeight:1.3,marginBottom:12}}>{clip.reason}</p>
          )}
          {clip.tags?.length > 0 && (
            <div className="vt" style={{display:"flex",gap:6,fontSize:16,color:C.ink,flexWrap:"wrap"}}>
              {clip.tags.map(t => <span key={t} style={{padding:"1px 8px",background:`${C.ink}11`,border:`1px solid ${C.ink}33`}}>#{t}</span>)}
            </div>
          )}
        </div>
        <div style={{padding:"22px 18px",borderLeft:BORDER,display:"flex",flexDirection:"column",gap:8,justifyContent:"center",background:`${C.paper}88`}}>
          <PixelBtn color="cream" size="sm" onClick={onPreview}>{isActive?"||":">"} {isActive?"HIDE":"PLAY"}</PixelBtn>
          <PixelBtn color="cream" size="sm" onClick={handleDownload} disabled={downloading}>
            {downloading ? "..." : "v MP4"}
          </PixelBtn>
          {ytConnected && (
            ytUp?.status === "done" ? (
              <a href={ytUp.url} target="_blank" rel="noreferrer" className="pixel" style={{padding:"6px 12px",fontSize:9,color:C.ink,background:C.yt,border:BORDER,boxShadow:SHADOW_SM,textAlign:"center",textDecoration:"none",textTransform:"uppercase"}}>{`>`} YT ^</a>
            ) : (ytUp?.status === "uploading" || ytUp?.status === "queued") ? (
              <span className="pixel" style={{padding:"6px 12px",fontSize:9,color:C.ink,background:C.amber,border:BORDER,boxShadow:SHADOW_SM,textAlign:"center"}}>^ {ytUp.progress||0}%</span>
            ) : (
              <PixelBtn color="yt" size="sm" onClick={onYTUpload}>^ YT</PixelBtn>
            )
          )}
        </div>
      </div>
    </div>
  );
}

/*  PAST / ARCHIVE  */
function Past({ jobs, onResume, onViewLive, onViewClips, onRefresh }) {
  const [filter, setFilter] = useState("all");
  const filtered = jobs.filter(j => filter==="all" || j.status===filter);
  return (
    <div className="fade" style={{padding:"32px 32px 64px",maxWidth:1320,margin:"0 auto"}}>
      <div style={{display:"flex",alignItems:"flex-end",justifyContent:"space-between",marginBottom:20,gap:18,flexWrap:"wrap"}}>
        <div>
          <div className="pixel" style={{fontSize:10,color:C.dim2,marginBottom:10}}>ARCHIVE - {jobs.length} JOBS</div>
          <h1 className="pixel" style={{fontSize:26,color:C.ink}}>The vault.</h1>
        </div>
        <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
          {[["all","ALL"],["done","DONE"],["error","FAILED"]].map(([k,l]) => {
            const a = filter===k;
            const col = k==="done"?"signal" : k==="error"?"hot" : "cream";
            return <PixelBtn key={k} color={a?col:"cream"} onClick={()=>setFilter(k)} size="md" style={a?{transform:"translate(3px,3px)",boxShadow:`0 0 0 ${C.ink}`}:{}}>{l}</PixelBtn>;
          })}
          <PixelBtn color="lavender" size="md" onClick={onRefresh}>Refresh</PixelBtn>
        </div>
      </div>

      {filtered.length === 0 ? (
        <PixelCard color={C.cream} padding={48} style={{textAlign:"center"}}>
          <p className="vt" style={{fontSize:20,color:C.dim2}}>No jobs to show. Forge some clips first.</p>
        </PixelCard>
      ) : (
        <PixelCard color={C.cream} padding={0}>
          <div style={{display:"grid",gridTemplateColumns:"1fr 110px 110px 110px 200px",padding:"12px 20px",borderBottom:`3px solid ${C.ink}`,gap:14,background:C.cream2}}>
            {["SOURCE","STATUS","CLIPS","CREATED","ACTIONS"].map(h => <span key={h} className="pixel" style={{fontSize:8,color:C.dim2}}>{h}</span>)}
          </div>
          {filtered.map((j, i) => {
            const isDone = j.status === "done";
            const isErr = j.status === "error";
            const isProcessing = !["done","error"].includes(j.status);
            return (
              <div key={j.job_id} onClick={() => isProcessing && onViewLive(j)}
                style={{display:"grid",gridTemplateColumns:"1fr 110px 110px 110px 200px",padding:"16px 20px",borderBottom: i<filtered.length-1?`2px solid ${C.ink}22`:"none",gap:14,alignItems:"center",cursor:isProcessing?"pointer":"default"}}>
                <div style={{minWidth:0}}>
                  <div className="mono" style={{fontSize:13,color:C.ink,fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{j.url}</div>
                  {isErr && <div className="vt" style={{fontSize:16,color:C.hotDeep,marginTop:2}}>! {j.error?.split("\n").pop()}</div>}
                </div>
                <Tag bg={isDone?C.signal:isErr?C.hot:C.amber}>* {j.status?.toUpperCase()}</Tag>
                <span className="pixel" style={{fontSize:9,color:isDone?C.ink:C.dim}}>
                  {j.clips?.length>0 ? `${j.clips.length} CLIPS` : "--"}
                </span>
                <span className="vt" style={{fontSize:16,color:C.dim2}}>{timeAgo(j.created_at)}</span>
                <div style={{display:"flex",gap:6,justifyContent:"flex-end"}}>
                  {isDone && <PixelBtn color="lavender" size="sm" onClick={(e)=>{e.stopPropagation();onViewClips(j);}}>OPEN {`>`}</PixelBtn>}
                  {isErr && <PixelBtn color="amber" size="sm" onClick={(e)=>{e.stopPropagation();onResume(j);}}>RETRY</PixelBtn>}
                  {isProcessing && <PixelBtn color="hot" size="sm" onClick={(e)=>{e.stopPropagation();onViewLive(j);}}>LIVE {`>`}</PixelBtn>}
                </div>
              </div>
            );
          })}
        </PixelCard>
      )}
    </div>
  );
}

/*  LOGIN  */
function LoginScreen({ onLogin }) {
  const [user, setUser] = useState("");
  const [pass, setPass] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  const attempt = async () => {
    if (!user || !pass) { setErr("Enter username and password."); return; }
    setLoading(true); setErr("");
    const auth = btoa(user + ":" + pass);
    try {
      const res = await fetch("/api/jobs", { headers: { "X-Clip-Auth": auth } });
      if (res.status === 401) { setErr("Invalid username or password."); setLoading(false); return; }
      sessionStorage.setItem("cf_auth", auth);
      onLogin();
    } catch {
      setErr("Cannot reach server.");
    } finally { setLoading(false); }
  };

  return (
    <div style={{minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",position:"relative",overflow:"hidden",padding:24}}>
      <div style={{position:"absolute",left:0,right:0,bottom:0,height:80,background:`repeating-linear-gradient(90deg,${C.signalDeep} 0 8px,${C.signal} 8px 16px)`,borderTop:BORDER,zIndex:0}}/>
      <div style={{position:"absolute",left:0,right:0,bottom:80,height:8,background:`repeating-linear-gradient(90deg,#5a3a1a 0 8px,#7a4a2a 8px 16px)`,borderTop:BORDER,zIndex:0}}/>
      <div style={{position:"absolute",bottom:84,left:"calc(50% - 280px)",zIndex:1,animation:"bob 2s ease-in-out infinite"}}>
        <PixelSprite data={ANVIL} palette={ANVIL_PAL} size={6}/>
      </div>

      <div className="fade" style={{position:"relative",zIndex:2}}>
        <PixelCard color={C.cream} padding={36} style={{width:440,maxWidth:"90vw"}}>
          <div style={{display:"flex",alignItems:"center",gap:14,marginBottom:24}}>
            <PixelSprite data={ANVIL} palette={ANVIL_PAL} size={4}/>
            <div className="pixel" style={{fontSize:18,color:C.ink}}><span style={{color:C.hotDeep}}>CLIP</span>FORGE</div>
          </div>
          <h1 className="pixel" style={{fontSize:22,color:C.ink,lineHeight:1.3,marginBottom:8}}>Hello, Hatim.</h1>
          <p className="vt" style={{fontSize:20,color:C.dim2,marginBottom:24}}>Sign in to fire up the forge. -</p>

          <div style={{display:"flex",flexDirection:"column",gap:14}}>
            <Field label="USERNAME">
              <input value={user} onChange={e=>setUser(e.target.value)} placeholder="username" className="mono" autoComplete="off"
                style={{width:"100%",padding:"12px 14px",background:C.paper,border:BORDER,color:C.ink,fontSize:14,fontWeight:500,boxShadow:SHADOW_SM}}/>
            </Field>
            <Field label="PASSWORD">
              <input type="password" value={pass} onChange={e=>setPass(e.target.value)} placeholder="" className="mono"
                onKeyDown={e=>e.key==="Enter"&&attempt()}
                style={{width:"100%",padding:"12px 14px",background:C.paper,border:BORDER,color:C.ink,fontSize:14,fontWeight:500,boxShadow:SHADOW_SM}}/>
            </Field>
            {err && <div className="pixel" style={{fontSize:9,color:C.hotDeep,padding:"8px 10px",background:`${C.hot}55`,border:`2px solid ${C.hotDeep}`}}>! {err}</div>}
            <PixelBtn color="hot" size="lg" full onClick={attempt} disabled={loading}>
              {loading && <span style={{width:10,height:10,background:C.ink,animation:"blink .4s steps(1) infinite"}}/>}
              {loading?"FIRING UP":"> ENTER FORGE"}
            </PixelBtn>
          </div>
        </PixelCard>
      </div>
    </div>
  );
}

/*  YouTube Upload Modal  */
function YouTubeUploadModal({ clip, clipIndex, jobId, onClose, onUploaded }) {
  const isShort = (clip.duration || 0) <= 60;
  const [title, setTitle] = useState((clip.title || "") + (isShort ? " #Shorts" : ""));
  const [description, setDescription] = useState(
    [clip.hook, clip.reason, (clip.tags || []).map(t => `#${t}`).join(" "), isShort ? "#Shorts" : ""]
      .filter(Boolean).join("\n\n")
  );
  const [tags, setTags] = useState((clip.tags || []).join(", "));
  const [privacy, setPrivacy] = useState("public");
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [done, setDone] = useState(null);
  const [err, setErr] = useState("");
  const pollRef = useRef(null);
  useEffect(() => () => clearInterval(pollRef.current), []);

  const upload = async () => {
    setUploading(true); setErr("");
    try {
      const res = await authFetch(`${API}/api/youtube/upload/${jobId}/${clipIndex}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title, description,
          tags: tags.split(",").map(t=>t.trim()).filter(Boolean),
          privacy_status: privacy,
        }),
      });
      if (!res.ok) { setErr("Failed to start upload."); setUploading(false); return; }
      pollRef.current = setInterval(async () => {
        try {
          const r = await authFetch(`${API}/api/youtube/upload_status/${jobId}/${clipIndex}`);
          const s = await r.json();
          if (s.status === "uploading") setProgress(s.progress || 0);
          if (s.status === "done") { clearInterval(pollRef.current); setProgress(100); setDone(s); setUploading(false); onUploaded?.(); }
          if (s.status === "error") { clearInterval(pollRef.current); setErr(s.error || "Upload failed"); setUploading(false); }
        } catch {}
      }, 2000);
    } catch { setErr("Failed to start upload."); setUploading(false); }
  };

  return (
    <div onClick={e=>!uploading && e.target===e.currentTarget && onClose()}
      style={{position:"fixed",inset:0,background:"rgba(26,13,46,.7)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:100,padding:20}}>
      <div className="fade" style={{width:520,maxWidth:"100%",maxHeight:"90vh",overflowY:"auto"}}>
        <PixelCard color={C.cream} padding={26}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:18}}>
            <div className="pixel" style={{fontSize:11,color:C.ink,display:"flex",alignItems:"center",gap:10}}>
              <span style={{color:C.ytDeep}}>* YOUTUBE</span> / UPLOAD {isShort && <Tag bg={C.yt}>SHORT</Tag>}
            </div>
            {!uploading && <button onClick={onClose} className="pixel" style={{width:28,height:28,background:C.cream2,border:BORDER_SM,fontSize:14,cursor:"pointer",color:C.ink}}>x</button>}
          </div>

          {done ? (
            <div style={{textAlign:"center"}}>
              <p className="pixel" style={{fontSize:11,color:C.signalDeep,marginBottom:14}}>v UPLOADED!</p>
              <a href={done.url} target="_blank" rel="noreferrer" className="mono" style={{color:C.ytDeep,fontSize:13,wordBreak:"break-all",display:"block",marginBottom:18}}>{done.url}</a>
              <PixelBtn color="signal" onClick={onClose}>CLOSE</PixelBtn>
            </div>
          ) : uploading ? (
            <div>
              <p className="pixel" style={{fontSize:10,color:C.dim2,marginBottom:12}}>UPLOADING TO YOUTUBE</p>
              <ProgressBar progress={progress} color={C.yt}/>
              <p className="pixel" style={{fontSize:14,color:C.ytDeep,textAlign:"center",marginTop:10}}>{progress}%</p>
            </div>
          ) : (
            <>
              <Field label="TITLE">
                <input value={title} onChange={e=>setTitle(e.target.value)} className="mono"
                  style={{width:"100%",padding:"10px 12px",background:C.paper,border:BORDER,color:C.ink,fontSize:13,marginBottom:14,boxShadow:SHADOW_SM}}/>
              </Field>
              <Field label="DESCRIPTION">
                <textarea value={description} onChange={e=>setDescription(e.target.value)} rows={4} className="mono"
                  style={{width:"100%",padding:"10px 12px",background:C.paper,border:BORDER,color:C.ink,fontSize:13,marginBottom:14,boxShadow:SHADOW_SM,resize:"vertical"}}/>
              </Field>
              <Field label="TAGS (COMMA-SEPARATED)">
                <input value={tags} onChange={e=>setTags(e.target.value)} className="mono"
                  style={{width:"100%",padding:"10px 12px",background:C.paper,border:BORDER,color:C.ink,fontSize:13,marginBottom:14,boxShadow:SHADOW_SM}}/>
              </Field>
              <Field label="PRIVACY">
                <div style={{display:"flex",gap:8,marginBottom:20}}>
                  {["public","unlisted","private"].map(o => {
                    const sel=privacy===o;
                    return <button key={o} onClick={()=>setPrivacy(o)} className="pixel" style={{flex:1,padding:"10px",background:sel?C.signal:C.paper,color:C.ink,border:BORDER,boxShadow:sel?`0 0 0 ${C.ink}`:SHADOW_SM,transform:sel?"translate(3px,3px)":"none",fontSize:9,cursor:"pointer"}}>{o.toUpperCase()}</button>;
                  })}
                </div>
              </Field>
              {err && <div className="pixel" style={{padding:"10px 12px",background:`${C.hot}55`,border:`2px solid ${C.hotDeep}`,color:C.hotDeep,fontSize:9,marginBottom:14}}>! {err}</div>}
              <PixelBtn color="yt" size="lg" full onClick={upload}>^ UPLOAD TO YOUTUBE</PixelBtn>
            </>
          )}
        </PixelCard>
      </div>
    </div>
  );
}

/*  MAIN APP  */
export default function App() {
  const [authed, setAuthed] = useState(!!sessionStorage.getItem("cf_auth"));
  const [tab, setTab] = useState("new");
  const [url, setUrl] = useState("");
  const [maxClips, setMaxClips] = useState(5);
  const [minDur, setMinDur] = useState(30);
  const [maxDur, setMaxDur] = useState(90);
  const [jobId, setJobId] = useState(null);
  const [job, setJob] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [pastJobs, setPastJobs] = useState([]);
  const [ytStatus, setYtStatus] = useState({ connected: false });
  const [ytError, setYtError] = useState("");
  const [ytModal, setYtModal] = useState(null);
  const pollRef = useRef(null);

  const isProcessing = loading || (job && !["done","error"].includes(job?.status));

  const fetchPastJobs = async () => {
    try {
      const res = await authFetch(`${API}/api/jobs`);
      const data = await res.json();
      setPastJobs(data.sort((a,b) => new Date(b.created_at) - new Date(a.created_at)));
    } catch {}
  };

  const fetchYtStatus = async () => {
    try {
      const res = await authFetch(`${API}/api/youtube/status`);
      const data = await res.json();
      setYtStatus(data);
    } catch {}
  };

  const handleConnectYouTube = async () => {
    setYtError("");
    try {
      const res = await authFetch(`${API}/api/youtube/auth`);
      const data = await res.json();
      if (!res.ok) { setYtError(data.detail || "YouTube auth failed."); return; }
      if (!data.auth_url) { setYtError("No auth URL returned."); return; }
      window.open(data.auth_url, "youtube_auth", "width=600,height=700,scrollbars=yes,resizable=yes");
      const onMessage = (e) => {
        if (e.data?.type === "youtube_auth_success") { window.removeEventListener("message", onMessage); fetchYtStatus(); }
        else if (e.data?.type === "youtube_auth_error") { window.removeEventListener("message", onMessage); setYtError(e.data.error || "Auth failed"); }
      };
      window.addEventListener("message", onMessage);
    } catch { setYtError("Cannot reach server."); }
  };

  useEffect(() => { if (authed) fetchPastJobs(); }, [authed]);
  useEffect(() => { if (authed) fetchYtStatus(); }, [authed]);
  useEffect(() => { if (authed && tab === "history") fetchPastJobs(); }, [tab, authed]);
  useEffect(() => {
    if (!authed) return;
    const i = setInterval(fetchPastJobs, 10000);
    return () => clearInterval(i);
  }, [authed]);

  useEffect(() => {
    if (!jobId) return;
    clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const res = await authFetch(`${API}/api/status/${jobId}`);
        const data = await res.json();
        setJob(data);
        if (data.status === "done" || data.status === "error") {
          clearInterval(pollRef.current);
          setLoading(false);
          fetchPastJobs();
        }
      } catch {}
    }, 1000);
    return () => clearInterval(pollRef.current);
  }, [jobId]);

  const handleSubmit = async () => {
    if (!url.trim()) { setError("Paste a YouTube URL first."); return; }
    setError("");
    setJob({ status:"downloading", progress:5, message:"Starting...", clips:[], error:null, url });
    setLoading(true);
    setTab("processing");
    try {
      const res = await authFetch(`${API}/api/clip`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, max_clips: maxClips, min_duration: minDur, max_duration: maxDur }),
      });
      const data = await res.json();
      setJobId(data.job_id);
    } catch {
      setError("Failed to start job. Is the server running?");
      setLoading(false); setTab("new");
    }
  };

  const reset = () => {
    setUrl(""); setJob(null); setJobId(null);
    setLoading(false); setError("");
    clearInterval(pollRef.current);
    setTab("new");
  };
  const handleRetry = (j) => { setUrl(j.url || ""); setTab("new"); };
  const handleViewLive = (j) => {
    clearInterval(pollRef.current);
    setJobId(j.job_id); setJob(j);
    setLoading(true); setTab("processing");
  };
  const handleViewClips = (j) => {
    clearInterval(pollRef.current);
    setJobId(j.job_id); setJob(j);
    setLoading(false); setTab("processing");
  };
  const refreshJob = async () => {
    if (!jobId) return;
    try {
      const res = await authFetch(`${API}/api/status/${jobId}`);
      const data = await res.json();
      setJob(data);
    } catch {}
  };

  if (!authed) {
    return (
      <>
        <style>{KEYFRAMES}</style>
        <LoginScreen onLogin={() => setAuthed(true)}/>
      </>
    );
  }

  return (
    <div style={{minHeight:"100vh"}}>
      <style>{KEYFRAMES}</style>
      <Header
        tab={tab} setTab={setTab}
        ytStatus={ytStatus} onConnectYT={handleConnectYouTube}
        onLogout={() => { sessionStorage.clear(); window.location.reload(); }}
        jobActive={isProcessing}
      />
      {ytError && (
        <div style={{maxWidth:1320,margin:"0 auto",padding:"0 32px"}}>
          <div className="pixel" style={{padding:"10px 14px",background:`${C.hot}55`,border:`2px solid ${C.hotDeep}`,color:C.hotDeep,fontSize:9,marginTop:14}}>! {ytError}</div>
        </div>
      )}

      {tab === "new" && (
        <NewClip
          url={url} setUrl={setUrl}
          maxClips={maxClips} setMaxClips={setMaxClips}
          minDur={minDur} setMinDur={setMinDur}
          maxDur={maxDur} setMaxDur={setMaxDur}
          onSubmit={handleSubmit} error={error}
        />
      )}

      {tab === "processing" && (
        <ProcessingTab
          job={job} onReset={reset}
          ytStatus={ytStatus}
          onYTUpload={(clip, clipIndex) => setYtModal({ clip, clipIndex })}
          refreshJob={refreshJob}
        />
      )}

      {tab === "history" && (
        <Past
          jobs={pastJobs}
          onResume={handleRetry}
          onViewLive={handleViewLive}
          onViewClips={handleViewClips}
          onRefresh={fetchPastJobs}
        />
      )}

      {ytModal && (
        <YouTubeUploadModal
          clip={ytModal.clip}
          clipIndex={ytModal.clipIndex}
          jobId={jobId || job?.job_id}
          onClose={() => setYtModal(null)}
          onUploaded={() => { refreshJob(); fetchPastJobs(); }}
        />
      )}
    </div>
  );
}
