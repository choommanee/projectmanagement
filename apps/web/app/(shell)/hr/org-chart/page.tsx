"use client";
import { useEffect, useMemo, useState } from "react";
import { Breadcrumb } from "@/shell/Breadcrumb";
import { CommandBar } from "@/shell/CommandBar";
import {
  listDepartments,
  listEmployees,
  type Department,
  type Employee,
} from "@/lib/api/hr";

// ─── tree types ──────────────────────────────────────────────────────────────

type DeptTreeNode = Department & { children: DeptTreeNode[]; employees: Employee[] };

function buildTree(depts: Department[], employees: Employee[]): DeptTreeNode[] {
  const nodeMap = new Map<string, DeptTreeNode>();

  for (const d of depts) {
    nodeMap.set(d.id, { ...d, children: [], employees: [] });
  }

  for (const e of employees) {
    if (e.departmentId && nodeMap.has(e.departmentId)) {
      nodeMap.get(e.departmentId)!.employees.push(e);
    }
  }

  const roots: DeptTreeNode[] = [];
  for (const node of nodeMap.values()) {
    if (node.parentId && nodeMap.has(node.parentId)) {
      nodeMap.get(node.parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  return roots;
}

// ─── dept node ───────────────────────────────────────────────────────────────

function DeptNode({ node, depth }: { node: DeptTreeNode; depth: number }) {
  const [open, setOpen] = useState(true);

  const totalInSubtree = useMemo(() => {
    function count(n: DeptTreeNode): number {
      return n.employees.length + n.children.reduce((s, c) => s + count(c), 0);
    }
    return count(node);
  }, [node]);

  const leftPad = depth > 0 ? "ml-6" : "";

  return (
    <div className={`mt-2 ${leftPad}`}>
      <div className={depth > 0 ? "border-l border-line pl-4" : ""}>
        {/* Department header button */}
        <button
          onClick={() => setOpen((o) => !o)}
          className="flex w-full items-center gap-2 rounded-xs px-3 py-2 text-left transition-colors hover:bg-surface-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
        >
          {/* Chevron */}
          <svg
            className={`h-3 w-3 shrink-0 text-ink-3 transition-transform ${open ? "rotate-90" : ""}`}
            viewBox="0 0 12 12"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          >
            <path d="M4 2l4 4-4 4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>

          {/* Dept code badge */}
          <span className="font-mono text-[10px] uppercase tracking-widest text-ink-3 bg-surface-2 border border-line rounded-xs px-1.5 py-0.5 shrink-0">
            {node.code}
          </span>

          {/* Dept name */}
          <span className="font-medium text-sm text-ink">{node.name}</span>

          {/* People count */}
          <span className="ml-auto shrink-0 font-mono text-xs text-ink-3">
            {node.employees.length}
            {totalInSubtree !== node.employees.length && (
              <span className="text-ink-4"> / {totalInSubtree} total</span>
            )}
            <span className="ml-1 text-ink-4">people</span>
          </span>
        </button>

        {/* Collapsible content */}
        {open && (
          <div className="pb-2 pl-3">
            {/* Employee chips */}
            {node.employees.length > 0 && (
              <div className="flex flex-wrap gap-1.5 py-1.5">
                {node.employees.map((e) => (
                  <span
                    key={e.id}
                    className="inline-flex items-center gap-1 rounded-full border border-line bg-surface px-2.5 py-0.5 text-xs text-ink-2"
                  >
                    <span className="font-medium text-ink">
                      {e.firstName} {e.lastName}
                    </span>
                    {e.positionName && (
                      <>
                        <span className="text-ink-4">·</span>
                        <span className="text-ink-3">{e.positionName}</span>
                      </>
                    )}
                    {!e.positionName && e.status !== "active" && (
                      <>
                        <span className="text-ink-4">·</span>
                        <span className={`text-[10px] ${e.status === "terminated" ? "text-danger" : e.status === "probation" ? "text-warning" : "text-ink-3"}`}>
                          {e.status}
                        </span>
                      </>
                    )}
                  </span>
                ))}
              </div>
            )}

            {/* Child departments */}
            {node.children.map((child) => (
              <DeptNode key={child.id} node={child} depth={depth + 1} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── page ─────────────────────────────────────────────────────────────────────

export default function OrgChartPage() {
  const [departments, setDepartments] = useState<Department[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [depts, empResult] = await Promise.all([
        listDepartments(),
        listEmployees(),
      ]);
      setDepartments(depts);
      setEmployees(empResult.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load org chart");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  const tree = useMemo(
    () => buildTree(departments, employees),
    [departments, employees],
  );

  const activeDepts = departments.filter((d) => d.active);
  const activeEmps = employees.filter((e) => e.status === "active");

  return (
    <div className="flex h-full flex-col">
      <Breadcrumb
        items={[
          { label: "HR Hub", href: "/hr/home" },
          { label: "Organization" },
          { label: "Org Chart" },
        ]}
      />
      <CommandBar
        actions={[
          { id: "refresh", label: "Refresh", variant: "ghost", onClick: () => void load() },
        ]}
      />

      {/* Summary strip */}
      <div className="flex items-center gap-6 border-b border-line bg-paper px-4 py-2">
        <div className="flex items-center gap-2">
          <span className="text-xs text-ink-3">Departments</span>
          <span className="font-mono text-sm font-semibold text-ink">{activeDepts.length}</span>
        </div>
        <div className="h-3 w-px bg-line" />
        <div className="flex items-center gap-2">
          <span className="text-xs text-ink-3">Active Employees</span>
          <span className="font-mono text-sm font-semibold text-ink">{activeEmps.length}</span>
        </div>
        <div className="h-3 w-px bg-line" />
        <div className="flex items-center gap-2">
          <span className="text-xs text-ink-3">Total Employees</span>
          <span className="font-mono text-sm font-semibold text-ink">{employees.length}</span>
        </div>
      </div>

      {error && (
        <div className="m-4 rounded-sm bg-danger/10 px-4 py-3 text-sm text-danger">{error}</div>
      )}

      <div className="min-h-0 flex-1 overflow-auto p-4">
        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-10 animate-pulse rounded-xs bg-surface-2" />
            ))}
          </div>
        ) : tree.length === 0 ? (
          <div className="flex h-40 items-center justify-center text-sm text-ink-3">
            No departments found.
          </div>
        ) : (
          <div className="rounded-sm border border-line bg-paper p-4">
            {tree.map((node) => (
              <DeptNode key={node.id} node={node} depth={0} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
