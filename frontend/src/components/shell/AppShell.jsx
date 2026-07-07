import { useEffect, useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { useApp } from "../../context/AppContext";
import { supabase } from "../../lib/supabase";
import { Button, ProgressBar, MenuButton, RetroSprite } from "../kit";
import { ANVIL, ANVIL_PAL } from "../ui";
import ThemeFab from "../theme/ThemeFab";
import {
  IconPlus,
  IconBolt,
  IconArchive,
  IconEye,
  IconLayers,
  IconCalendar,
  IconLink,
  IconAnvil,
} from "./icons";

function Logo({ onClick }) {
  return (
    <div className="side__logo" onClick={onClick}>
      <RetroSprite
        data={ANVIL}
        palette={ANVIL_PAL}
        size={3}
        modern={
          <span style={{ color: "var(--accent)", display: "inline-flex" }}>
            <IconAnvil size={22} />
          </span>
        }
      />
      <span className="side__logo-name">
        <b>Clip</b>Forge
      </span>
    </div>
  );
}

function NavItem({ icon, label, to, active, live, pro, count, onClick }) {
  return (
    <button
      type="button"
      className={`nav-item ${active ? "nav-item--active" : ""}`}
      onClick={onClick}
      data-to={to}
    >
      <span className="nav-item__icon">{icon}</span>
      <span className="nav-item__label">{label}</span>
      {live && <span className="nav-item__live">LIVE</span>}
      {count > 0 && <span className="nav-item__count">{count}</span>}
      {pro && <span className="pro-badge">Pro</span>}
    </button>
  );
}

function useNav() {
  const { isPro, ytStatus, ttStatus, jobActive } = useApp();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const connectedCount = (ytStatus?.channels?.length || 0) + (ttStatus?.accounts?.length || 0);

  const go = (to) => navigate(to === "/work" && jobActive ? `/work?job=${jobActive}` : to);

  const sections = [
    {
      title: "Create",
      items: [{ to: "/hello", label: "Create clips", icon: <IconPlus /> }],
    },
    {
      title: "Activity",
      items: [
        { to: "/work", label: "Work", icon: <IconBolt />, live: !!jobActive },
        { to: "/archive", label: "Archive", icon: <IconArchive /> },
      ],
    },
    {
      title: "Automation",
      items: [
        { to: "/watchlist", label: "Watchlist", icon: <IconEye />, pro: !isPro },
        { to: "/digest", label: "Digest", icon: <IconLayers />, pro: !isPro },
        { to: "/calendar", label: "Calendar", icon: <IconCalendar /> },
        ...(isPro
          ? [{ to: "/connections", label: "Connections", icon: <IconLink />, count: connectedCount }]
          : []),
      ],
    },
  ];

  return { sections, go, pathname };
}

function SideNav({ onNavigate }) {
  const { sections, go, pathname } = useNav();
  return (
    <nav style={{ display: "block" }}>
      {sections.map((s) => (
        <div key={s.title}>
          <div className="side__section">{s.title}</div>
          {s.items.map((it) => (
            <NavItem
              key={it.to}
              {...it}
              active={pathname === it.to}
              onClick={() => {
                go(it.to);
                onNavigate?.();
              }}
            />
          ))}
        </div>
      ))}
    </nav>
  );
}

function UsageFooter({ onNavigate }) {
  const { profile, isPro } = useApp();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setEmail(data?.user?.email || ""));
  }, []);

  const used = profile.clips_used ?? 0;
  const limit = profile.clips_limit ?? 10;

  return (
    <div className="side__foot">
      {!isPro && (
        <div className="usage-card">
          <div className="usage-card__row">
            <span className="usage-card__plan">Free plan</span>
            <span className="usage-card__nums">
              {used}/{limit}
            </span>
          </div>
          <ProgressBar progress={limit ? (used / limit) * 100 : 0} />
          {profile.billing_enabled && (
            <Button
              size="sm"
              full
              style={{ marginTop: 10 }}
              onClick={() => {
                navigate("/upgrade");
                onNavigate?.();
              }}
            >
              Upgrade to Pro
            </Button>
          )}
        </div>
      )}
      <MenuButton
        align="left"
        trigger={(toggle) => (
          <button type="button" className="account" onClick={toggle} style={{ width: "100%" }}>
            <span className="account__avatar">{(email || "?")[0]}</span>
            <span className="account__mail">{email || "Account"}</span>
          </button>
        )}
        items={[
          { label: isPro ? "Plan: Pro" : "Plan: Free", disabled: true },
          { label: "Sign out", onClick: () => supabase.auth.signOut() },
        ]}
      />
    </div>
  );
}

function MobileChrome() {
  const { profile, isPro, jobActive } = useApp();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [drawer, setDrawer] = useState(false);

  const quick = [
    { to: "/hello", label: "Create", icon: <IconPlus /> },
    { to: "/work", label: "Work", icon: <IconBolt />, live: !!jobActive },
    { to: "/archive", label: "Archive", icon: <IconArchive /> },
  ];

  return (
    <>
      <div className="topbar">
        <button
          type="button"
          className="topbar__burger"
          aria-label="Menu"
          onClick={() => setDrawer(true)}
        >
          ☰
        </button>
        <Logo onClick={() => navigate("/hello")} />
        <span style={{ flex: 1 }} />
        {!isPro && (
          <span className="usage-card__nums">
            {profile.clips_used}/{profile.clips_limit}
          </span>
        )}
      </div>

      <div className="bottomnav">
        {quick.map((q) => (
          <button
            key={q.to}
            type="button"
            className={`bottomnav__item ${pathname === q.to ? "bottomnav__item--active" : ""}`}
            onClick={() => navigate(q.to === "/work" && jobActive ? `/work?job=${jobActive}` : q.to)}
          >
            {q.live && <span className="bottomnav__live" />}
            <span className="bottomnav__icon">{q.icon}</span>
            {q.label}
          </button>
        ))}
      </div>

      {drawer && (
        <>
          <div className="drawer-backdrop" onClick={() => setDrawer(false)} />
          <div className="drawer">
            <Logo
              onClick={() => {
                navigate("/hello");
                setDrawer(false);
              }}
            />
            <SideNav onNavigate={() => setDrawer(false)} />
            <UsageFooter onNavigate={() => setDrawer(false)} />
          </div>
        </>
      )}
    </>
  );
}

/* Layout route element for redesigned pages: sidebar (desktop) or
   topbar/drawer/bottomnav (mobile) + <Outlet/> + the Go Retro FAB. */
export default function AppShell() {
  const navigate = useNavigate();
  return (
    <div className="shell">
      <aside className="shell__side">
        <Logo onClick={() => navigate("/hello")} />
        <SideNav />
        <UsageFooter />
      </aside>
      <MobileChrome />
      <main className="shell__main">
        <Outlet />
      </main>
      <ThemeFab />
    </div>
  );
}
