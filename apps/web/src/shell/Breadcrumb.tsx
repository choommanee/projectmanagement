import Link from "next/link";

export function Breadcrumb({ items }: { items: { label: string; href?: string }[] }) {
  return (
    <nav aria-label="Breadcrumb" className="px-3 py-1 text-xs text-fgMuted">
      <ol className="flex items-center gap-1">
        {items.map((it, i) => (
          <li key={i} className="flex items-center gap-1">
            {it.href ? <Link className="hover:text-fg" href={it.href}>{it.label}</Link> : <span>{it.label}</span>}
            {i < items.length - 1 && <span aria-hidden>›</span>}
          </li>
        ))}
      </ol>
    </nav>
  );
}
