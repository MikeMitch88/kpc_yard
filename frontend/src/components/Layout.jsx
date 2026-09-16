import { NavLink, Outlet } from "react-router-dom";
import {
  LayoutDashboard,
  Ticket,
  Smartphone,
  Map as MapIcon,
  Settings2,
} from "lucide-react";

const NAV = [
  { to: "/", label: "Executive Dashboard", icon: LayoutDashboard, end: true },
  { to: "/depot-map", label: "Depot Map", icon: MapIcon },
  { to: "/gate-kiosk", label: "Gate Kiosk", icon: Ticket },
  { to: "/driver", label: "Driver Mobile", icon: Smartphone },
  { to: "/admin", label: "Admin Ops", icon: Settings2 },
];

export default function Layout() {
  return (
    <div className="flex min-h-screen">
      <aside className="fixed inset-y-0 left-0 z-40 flex w-16 flex-col items-center gap-2 border-r border-white/10 bg-black/40 py-4 md:w-60 md:items-stretch md:px-4">
        <div className="mb-4 flex items-center justify-center px-1 md:justify-start">
          <img
            src="/images/logo_no_white_corners.png"
            alt="Njiasmart Logo"
            className="h-10 w-auto object-contain md:h-12"
          />
        </div>
        {NAV.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              `flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition ${
                isActive
                  ? "bg-kpc-green/30 font-semibold text-emerald-300 ring-1 ring-inset ring-orange-400/40"
                  : "text-slate-400 hover:bg-white/10 hover:text-white"
              }`
            }
            title={label}
          >
            <Icon className="h-4 w-4" />
            <span className="hidden md:inline">{label}</span>
          </NavLink>
        ))}
        <div className="mt-auto px-3 text-[10px] text-slate-600">
          Njiasmart Enterprise
          <br />
          Yard & Queue Control Plane
        </div>
      </aside>
      <main className="ml-16 flex-1 p-4 md:ml-60 md:p-6">
        <Outlet />
      </main>
    </div>
  );
}