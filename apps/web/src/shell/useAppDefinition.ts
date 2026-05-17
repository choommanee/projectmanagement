"use client";
import { useQuery } from "@tanstack/react-query";
import type { AppDef } from "./shell.types";

export function useAppDefinition(id: string) {
  return useQuery<AppDef>({
    queryKey: ["app-def", id],
    queryFn: async () => {
      const r = await fetch(`/api/app-definitions/${id}`);
      if (!r.ok) throw new Error("not found");
      return r.json();
    },
  });
}

export function useAppList() {
  return useQuery<{ id: string; name: string }[]>({
    queryKey: ["app-list"],
    queryFn: () => fetch("/api/app-definitions").then((r) => r.json()),
  });
}
