import Link from "next/link";
import type { AppDef } from "./shell.types";

export function NavPane({ app }: { app: AppDef }) {
  return (
    <nav aria-label="Primary" className="h-full w-60 shrink-0 overflow-y-auto border-r border-border bg-bg">
      {app.areas.map((area) => (
        <div key={area.id} className="px-2 py-3">
          <div className="px-2 text-[11px] font-semibold uppercase tracking-wide text-fgMuted">{area.name}</div>
          {area.groups.map((g) => (
            <div key={g.id} className="mt-2">
              <div className="px-2 text-xs font-medium text-fgMuted">{g.name}</div>
              <ul>
                {g.subareas.map((sub) => (
                  <li key={sub.id}>
                    <Link
                      href={sub.href}
                      className="block rounded-md px-2 py-1.5 text-sm text-fg hover:bg-bgMuted"
                    >
                      {sub.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      ))}
    </nav>
  );
}
