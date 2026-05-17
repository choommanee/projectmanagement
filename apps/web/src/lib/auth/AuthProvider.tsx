"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { decodeUserMeta } from "./cookies";
import type { UserMeta } from "./cookies";

interface AuthCtx {
  user: UserMeta | null;
  isLoading: boolean;
  signOut: () => Promise<void>;
  refresh: () => void;
}

const AuthContext = createContext<AuthCtx>({
  user: null,
  isLoading: true,
  signOut: async () => {},
  refresh: () => {},
});

function readUserMetaCookie(): UserMeta | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie
    .split("; ")
    .find((row) => row.startsWith("user_meta="));
  if (!match) return null;
  const value = match.slice("user_meta=".length);
  return decodeUserMeta(decodeURIComponent(value));
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [user, setUser] = useState<UserMeta | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const load = useCallback(() => {
    const meta = readUserMetaCookie();
    setUser(meta);
    setIsLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const signOut = useCallback(async () => {
    await fetch("/api/auth/signout", { method: "POST" });
    setUser(null);
    router.push("/login");
  }, [router]);

  return (
    <AuthContext.Provider value={{ user, isLoading, signOut, refresh: load }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthCtx {
  return useContext(AuthContext);
}
