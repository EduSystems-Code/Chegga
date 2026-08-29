import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";
import Logo from "./Logo";

// Small hand-drawn icon set (not a library) so the nav reads as designed
// for this app rather than generic — a board-grid, a bar-chart, and a
// target, matching what each section actually is.
function GamesIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <rect x="1.5" y="1.5" width="6.5" height="6.5" rx="1" fill="currentColor" opacity="0.35" />
      <rect x="10" y="1.5" width="6.5" height="6.5" rx="1" fill="currentColor" opacity="0.9" />
      <rect x="1.5" y="10" width="6.5" height="6.5" rx="1" fill="currentColor" opacity="0.9" />
      <rect x="10" y="10" width="6.5" height="6.5" rx="1" fill="currentColor" opacity="0.35" />
    </svg>
  );
}

function ProfileIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <rect x="2" y="10" width="3.2" height="6" rx="0.8" fill="currentColor" opacity="0.55" />
      <rect x="7.4" y="5.5" width="3.2" height="10.5" rx="0.8" fill="currentColor" opacity="0.85" />
      <rect x="12.8" y="2" width="3.2" height="14" rx="0.8" fill="currentColor" />
    </svg>
  );
}

function DrillsIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <circle cx="9" cy="9" r="7.2" stroke="currentColor" strokeWidth="1.6" opacity="0.5" />
      <circle cx="9" cy="9" r="4.3" stroke="currentColor" strokeWidth="1.6" opacity="0.8" />
      <circle cx="9" cy="9" r="1.4" fill="currentColor" />
    </svg>
  );
}

const NAV_ITEMS = [
  { to: "/", label: "Games", icon: GamesIcon, end: true },
  { to: "/profile", label: "Profile", icon: ProfileIcon, end: false },
  { to: "/drills", label: "Drills", icon: DrillsIcon, end: false },
];

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <NavLink to="/" className="sidebar-logo">
          <Logo size={26} />
        </NavLink>
        <nav className="sidebar-nav">
          {NAV_ITEMS.map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end} className={({ isActive }) => `sidebar-link ${isActive ? "active" : ""}`}>
              <Icon />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-footer">
          <span className="sidebar-footer-dot" />
          your own engine, your own data
        </div>
      </aside>
      <main className="app-content">{children}</main>
    </div>
  );
}
