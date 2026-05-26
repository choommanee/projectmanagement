"use client";

import {
  useState,
  useEffect,
  useRef,
  useCallback,
  type KeyboardEvent,
} from "react";
import { useRouter } from "next/navigation";
import {
  FolderKanban,
  Factory,
  Package,
  Users,
  ClipboardList,
  ShoppingCart,
  X,
  ArrowRight,
  Layers,
} from "lucide-react";
import { listProjects } from "@/lib/api/projects";
import { listWorkOrders, listItems } from "@/lib/api/mfg";
import { listCustomers } from "@/lib/api/sales";
import { listEmployees } from "@/lib/api/hr";

// ─── types ────────────────────────────────────────────────────────────────────

interface SearchResult {
  id: string;
  label: string;
  sublabel?: string;
  href: string;
  group: string;
  icon: React.ReactNode;
}

interface ResultGroup {
  group: string;
  items: SearchResult[];
}

// ─── quick links shown when palette is open but query is empty ───────────────

const QUICK_LINKS: SearchResult[] = [
  {
    id: "ql-work-orders",
    label: "Work Orders",
    sublabel: "Manufacturing",
    href: "/mfg/work-orders",
    group: "Quick Links",
    icon: <Factory size={14} />,
  },
  {
    id: "ql-projects",
    label: "Projects",
    sublabel: "Project Management",
    href: "/pm/projects",
    group: "Quick Links",
    icon: <FolderKanban size={14} />,
  },
  {
    id: "ql-items",
    label: "Items",
    sublabel: "Manufacturing",
    href: "/mfg/items",
    group: "Quick Links",
    icon: <Package size={14} />,
  },
  {
    id: "ql-customers",
    label: "Customers",
    sublabel: "Sales",
    href: "/sales/customers",
    group: "Quick Links",
    icon: <ShoppingCart size={14} />,
  },
  {
    id: "ql-employees",
    label: "Employees",
    sublabel: "HR",
    href: "/hr/employees",
    group: "Quick Links",
    icon: <Users size={14} />,
  },
  {
    id: "ql-tasks",
    label: "Tasks",
    sublabel: "Project Management",
    href: "/pm/tasks",
    group: "Quick Links",
    icon: <ClipboardList size={14} />,
  },
];

// ─── global open/close state (module-level so hook can share it) ─────────────

type SetOpen = (open: boolean) => void;
let _setOpenFns: Set<SetOpen> = new Set();

function notifyOpen(open: boolean) {
  for (const fn of _setOpenFns) fn(open);
}

// ─── hook ─────────────────────────────────────────────────────────────────────

export function useGlobalSearch() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    _setOpenFns.add(setOpen);
    return () => { _setOpenFns.delete(setOpen); };
  }, []);

  const openPalette = useCallback(() => notifyOpen(true), []);

  return { open, setOpen, openPalette };
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function groupResults(results: SearchResult[]): ResultGroup[] {
  const map = new Map<string, SearchResult[]>();
  for (const r of results) {
    if (!map.has(r.group)) map.set(r.group, []);
    map.get(r.group)!.push(r);
  }
  return Array.from(map.entries()).map(([group, items]) => ({ group, items }));
}

function flattenGroups(groups: ResultGroup[]): SearchResult[] {
  return groups.flatMap((g) => g.items);
}

// ─── skeleton row ─────────────────────────────────────────────────────────────

function SkeletonRow() {
  return (
    <div className="flex items-center gap-3 px-4 py-2 animate-pulse">
      <div className="h-4 w-4 rounded-sm bg-surface-2 shrink-0" />
      <div className="flex-1 space-y-1">
        <div className="h-3 w-2/3 rounded-sm bg-surface-2" />
        <div className="h-2.5 w-1/3 rounded-sm bg-surface-2" />
      </div>
    </div>
  );
}

// ─── component ───────────────────────────────────────────────────────────────

export function GlobalSearch() {
  const router = useRouter();
  const { open, setOpen } = useGlobalSearch();
  const inputRef = useRef<HTMLInputElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [activeIdx, setActiveIdx] = useState(-1);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ─── keyboard shortcut to open ──────────────────────────────────────────

  useEffect(() => {
    function handleKeyDown(e: globalThis.KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        notifyOpen(true);
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  // ─── focus input on open ────────────────────────────────────────────────

  useEffect(() => {
    if (open) {
      setQuery("");
      setResults([]);
      setActiveIdx(-1);
      setTimeout(() => inputRef.current?.focus(), 10);
    }
  }, [open]);

  // ─── search ─────────────────────────────────────────────────────────────

  const runSearch = useCallback(async (q: string) => {
    if (!q.trim()) {
      setResults([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const lower = q.toLowerCase();

    const [projectsRes, workOrdersRes, itemsRes, customersRes, employeesRes] =
      await Promise.allSettled([
        listProjects({ q, limit: 10 }),
        listWorkOrders({ q, limit: 10 }),
        listItems({ q, limit: 10 }),
        listCustomers(),
        listEmployees({ q }),
      ]);

    const found: SearchResult[] = [];

    // Projects
    if (projectsRes.status === "fulfilled") {
      for (const p of projectsRes.value.items) {
        found.push({
          id: `proj-${p.id}`,
          label: p.name,
          sublabel: p.code,
          href: `/pm/projects/${p.id}`,
          group: "Projects",
          icon: <FolderKanban size={14} />,
        });
      }
    }

    // Work Orders
    if (workOrdersRes.status === "fulfilled") {
      for (const wo of workOrdersRes.value.items) {
        found.push({
          id: `wo-${wo.id}`,
          label: wo.code,
          sublabel: wo.notes || wo.status,
          href: `/mfg/work-orders/${wo.id}`,
          group: "Work Orders",
          icon: <Factory size={14} />,
        });
      }
    }

    // Items — client-side filter since API supports q param
    if (itemsRes.status === "fulfilled") {
      for (const item of itemsRes.value.items) {
        if (
          item.code.toLowerCase().includes(lower) ||
          item.name.toLowerCase().includes(lower)
        ) {
          found.push({
            id: `item-${item.id}`,
            label: item.name,
            sublabel: item.code,
            href: `/mfg/items/${item.id}`,
            group: "Items",
            icon: <Package size={14} />,
          });
        }
      }
    }

    // Customers — client-side filter (no q param in listCustomers)
    if (customersRes.status === "fulfilled") {
      for (const c of customersRes.value) {
        if (c.name.toLowerCase().includes(lower) || c.code.toLowerCase().includes(lower)) {
          found.push({
            id: `cust-${c.id}`,
            label: c.name,
            sublabel: c.code,
            href: `/sales/customers/${c.id}`,
            group: "Customers",
            icon: <ShoppingCart size={14} />,
          });
        }
      }
    }

    // Employees
    if (employeesRes.status === "fulfilled") {
      for (const emp of employeesRes.value.items) {
        const fullName = `${emp.firstName} ${emp.lastName}`;
        if (
          fullName.toLowerCase().includes(lower) ||
          emp.empNo.toLowerCase().includes(lower)
        ) {
          found.push({
            id: `emp-${emp.id}`,
            label: fullName,
            sublabel: emp.empNo,
            href: `/hr/employees/${emp.id}`,
            group: "Employees",
            icon: <Users size={14} />,
          });
        }
      }
    }

    setResults(found);
    setActiveIdx(-1);
    setLoading(false);
  }, []);

  // ─── debounced search ───────────────────────────────────────────────────

  useEffect(() => {
    if (!open) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query.trim()) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    debounceRef.current = setTimeout(() => runSearch(query), 200);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, open, runSearch]);

  // ─── close on Escape ────────────────────────────────────────────────────

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    setResults([]);
  }, [setOpen]);

  // ─── click outside ──────────────────────────────────────────────────────

  const handleOverlayClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (e.target === overlayRef.current) close();
    },
    [close],
  );

  // ─── keyboard nav ───────────────────────────────────────────────────────

  const displayItems = query.trim()
    ? flattenGroups(groupResults(results))
    : QUICK_LINKS;

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      switch (e.key) {
        case "Escape":
          close();
          break;
        case "ArrowDown":
          e.preventDefault();
          setActiveIdx((i) => Math.min(i + 1, displayItems.length - 1));
          break;
        case "ArrowUp":
          e.preventDefault();
          setActiveIdx((i) => Math.max(i - 1, 0));
          break;
        case "Enter":
          if (activeIdx >= 0 && activeIdx < displayItems.length) {
            router.push(displayItems[activeIdx].href);
            close();
          }
          break;
      }
    },
    [activeIdx, displayItems, router, close],
  );

  // ─── scroll active item into view ───────────────────────────────────────

  useEffect(() => {
    if (activeIdx < 0 || !listRef.current) return;
    const el = listRef.current.querySelector(`[data-idx="${activeIdx}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [activeIdx]);

  // ─── render ─────────────────────────────────────────────────────────────

  if (!open) return null;

  const groups = query.trim() ? groupResults(results) : [{ group: "Quick Links", items: QUICK_LINKS }];

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh] bg-black/40"
      onClick={handleOverlayClick}
      role="dialog"
      aria-modal="true"
      aria-label="Global search"
    >
      <div className="w-full max-w-xl bg-paper border border-line rounded shadow-xl overflow-hidden">
        {/* ── search input ── */}
        <div className="flex items-center gap-2 px-4 border-b border-line">
          <Layers size={14} className="text-ink-3 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search work orders, projects, items, customers..."
            aria-label="Search"
            className="flex-1 py-3 text-sm bg-transparent outline-none font-mono placeholder:text-ink-3 text-ink"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              className="text-ink-3 hover:text-ink transition-colors"
              aria-label="Clear search"
            >
              <X size={13} />
            </button>
          )}
          <kbd className="hidden sm:inline-flex items-center gap-0.5 rounded border border-line bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] text-ink-3">
            ESC
          </kbd>
        </div>

        {/* ── results list ── */}
        <div ref={listRef} className="max-h-80 overflow-y-auto">
          {loading ? (
            <div className="py-1">
              <SkeletonRow />
              <SkeletonRow />
              <SkeletonRow />
            </div>
          ) : (
            <>
              {query.trim() && results.length === 0 && !loading ? (
                <p className="text-ink-3 text-xs text-center py-6 font-mono">
                  No results for &ldquo;{query}&rdquo;
                </p>
              ) : (
                <>
                  {(() => {
                    let flatIdx = 0;
                    return groups.map(({ group, items }) => (
                      <div key={group}>
                        {/* group label */}
                        <div className="flex items-center gap-2 px-4 pt-3 pb-1">
                          <span className="text-[10px] font-semibold uppercase tracking-widest text-ink-3 font-mono">
                            {group}
                          </span>
                          <div className="flex-1 h-px bg-line" />
                        </div>

                        {/* group items */}
                        {items.map((result) => {
                          const idx = flatIdx++;
                          const isActive = idx === activeIdx;
                          return (
                            <button
                              key={result.id}
                              type="button"
                              data-idx={idx}
                              onClick={() => {
                                router.push(result.href);
                                close();
                              }}
                              onMouseEnter={() => setActiveIdx(idx)}
                              className={[
                                "flex w-full items-center gap-3 px-4 py-2 cursor-pointer text-sm text-left transition-colors",
                                isActive
                                  ? "bg-accent/10 text-ink"
                                  : "hover:bg-surface-2 text-ink-2",
                              ].join(" ")}
                            >
                              <span
                                className={[
                                  "shrink-0 transition-colors",
                                  isActive ? "text-accent" : "text-ink-3",
                                ].join(" ")}
                              >
                                {result.icon}
                              </span>
                              <span className="flex-1 min-w-0">
                                <span className="block truncate text-[13px] leading-tight">
                                  {result.label}
                                </span>
                                {result.sublabel && (
                                  <span className="block truncate text-[11px] text-ink-3 font-mono leading-tight">
                                    {result.sublabel}
                                  </span>
                                )}
                              </span>
                              {isActive && (
                                <ArrowRight size={12} className="text-accent shrink-0" />
                              )}
                            </button>
                          );
                        })}
                      </div>
                    ));
                  })()}
                </>
              )}
            </>
          )}
        </div>

        {/* ── footer hint ── */}
        <div className="flex items-center gap-3 border-t border-line px-4 py-2">
          <span className="text-[10px] text-ink-3 font-mono">
            <kbd className="rounded border border-line bg-surface-2 px-1 py-0.5 font-mono text-[10px]">↑↓</kbd>
            {" "}navigate
          </span>
          <span className="text-[10px] text-ink-3 font-mono">
            <kbd className="rounded border border-line bg-surface-2 px-1 py-0.5 font-mono text-[10px]">↵</kbd>
            {" "}open
          </span>
          <span className="text-[10px] text-ink-3 font-mono">
            <kbd className="rounded border border-line bg-surface-2 px-1 py-0.5 font-mono text-[10px]">esc</kbd>
            {" "}close
          </span>
        </div>
      </div>
    </div>
  );
}
