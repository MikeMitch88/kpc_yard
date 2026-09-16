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
        <div className="mb-4 flex items-center gap-2.5 px-1">
          <img
            src="https://kpc.co.ke/wp-content/uploads/2019/06/cropped-kpc1.png"
            alt="KPC"
            className="h-9 w-9 rounded object-contain"
            onError={(e) => (e.currentTarget.style.display = "none")}
          />
          <div className="hidden md:block">
            <p className="text-sm font-bold uppercase tracking-wide text-white">KPC Yard CP</p>
            <p className="text-[10px] font-semibold uppercase tracking-[0.25em] text-emerald-400">MBA Depot</p>
            <p className="text-[9px] text-slate-500">Kenya Pipeline Co.</p>
          </div>
        </div>
        {NAV.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              `flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition ${
                isActive
                  ? "bg-kpc-green/30 font-semibold text-emerald-300"
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
          KPC Yard Control Plane
          <br />
          MBA Depot · Autonomous Yard Control
        </div>
      </aside>
      <main className="ml-16 flex-1 p-4 md:ml-60 md:p-6">
        <Outlet />
      </main>
    </div>
  );
}