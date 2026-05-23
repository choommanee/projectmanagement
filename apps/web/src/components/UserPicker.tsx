"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { listUsers, type UserSummary } from "@/lib/api/identity";

export interface UserPickerProps {
  value?: string;
  onChange: (userId: string) => void;
  placeholder?: string;
  className?: string;
}

export function UserPicker({ value, onChange, placeholder = "Search team members…", className }: UserPickerProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<UserSummary[]>([]);
  const [selected, setSelected] = useState<UserSummary | null>(null);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Resolve display name when value prop changes but no cached user
  useEffect(() => {
    if (!value) {
      setSelected(null);
      setQuery("");
      return;
    }
    // If we already have the right user cached, skip
    if (selected?.id === value) return;
    // Try to fetch by searching with the partial id — best effort
    listUsers(value, 6)
      .then((users) => {
        const match = users.find((u) => u.id === value);
        if (match) {
          setSelected(match);
          setQuery(`${match.display_name} <${match.email}>`);
        } else {
          // Show truncated UUID
          setSelected(null);
          setQuery(`${value.slice(0, 8)}…`);
        }
      })
      .catch(() => {
        setSelected(null);
        setQuery(`${value.slice(0, 8)}…`);
      });
    // We intentionally don't include `selected` in deps to avoid an infinite loop
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const search = useCallback((q: string) => {
    if (!q.trim()) {
      setResults([]);
      setOpen(false);
      return;
    }
    listUsers(q, 6)
      .then((users) => {
        setResults(users);
        setOpen(users.length > 0);
        setActiveIndex(-1);
      })
      .catch(() => {
        setResults([]);
        setOpen(false);
      });
  }, []);

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const q = e.target.value;
    setQuery(q);
    // Clear selection when user starts editing
    if (selected) {
      setSelected(null);
      onChange("");
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => search(q), 300);
  }

  function selectUser(user: UserSummary) {
    setSelected(user);
    setQuery(`${user.display_name} <${user.email}>`);
    setResults([]);
    setOpen(false);
    setActiveIndex(-1);
    onChange(user.id);
  }

  function clear(e: React.MouseEvent) {
    e.stopPropagation();
    setSelected(null);
    setQuery("");
    setResults([]);
    setOpen(false);
    onChange("");
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (activeIndex >= 0 && results[activeIndex]) {
        selectUser(results[activeIndex]);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
      setResults([]);
    }
  }

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  return (
    <div ref={containerRef} className={`relative${className ? ` ${className}` : ""}`}>
      <div className="relative">
        <input
          type="text"
          value={query}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onFocus={() => {
            if (!selected && query.trim() && results.length > 0) setOpen(true);
          }}
          placeholder={placeholder}
          autoComplete="off"
          spellCheck={false}
          className="h-9 w-full rounded-sm border border-line bg-surface px-3 pr-8 text-sm text-ink placeholder:text-ink-3 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15"
          aria-autocomplete="list"
          aria-expanded={open}
          role="combobox"
        />
        {selected && (
          <button
            type="button"
            aria-label="Clear selection"
            onClick={clear}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-3 hover:text-ink"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
              <path d="M2 2l10 10M12 2L2 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </button>
        )}
      </div>

      {open && results.length > 0 && (
        <ul
          role="listbox"
          className="absolute left-0 top-full z-50 mt-1 w-full rounded-sm border border-line bg-paper shadow-pop"
        >
          {results.map((user, i) => (
            <li
              key={user.id}
              role="option"
              aria-selected={i === activeIndex}
              onMouseDown={(e) => {
                e.preventDefault();
                selectUser(user);
              }}
              onMouseEnter={() => setActiveIndex(i)}
              className={`flex cursor-pointer flex-col gap-0.5 px-3 py-2 ${
                i === activeIndex ? "bg-accent/10 text-ink" : "hover:bg-surface"
              }`}
            >
              <span className="text-sm font-semibold leading-tight text-ink">
                {user.display_name}
              </span>
              <span className="text-xs text-ink-3">{user.email}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
