"use client";
import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";

export function Breadcrumb({ items }: { items: { label: string; href?: string }[] }) {
  const t = useTranslations("shell");
  return (
    <nav aria-label={t("breadcrumb")} className="flex items-center gap-1 px-4 py-2.5 text-[12px] text-ink-3">
      {items.map((it, i) => {
        const last = i === items.length - 1;
        return (
          <span key={i} className="flex items-center gap-1">
            {it.href && !last ? (
              <Link href={it.href} className="hover:text-ink transition-colors">{it.label}</Link>
            ) : (
              <span className={last ? "font-medium text-ink" : ""}>{it.label}</span>
            )}
            {!last && <ChevronRight size={12} className="opacity-50" />}
          </span>
        );
      })}
    </nav>
  );
}
