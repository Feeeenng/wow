import { createContext, useContext, useRef, useState } from "react";
import type { PropsWithChildren } from "react";
import { WebApi } from "@/auth/api";
import { UUID_PATTERN } from "@/config";

export interface Profile { userId: string; displayName: string; teams: { teamId: string; name: string; role: "leader" | "analyst" | "member" }[]; }
interface Session { api: WebApi | null; profile: Profile | null; login: (token: string) => Promise<void>; logout: () => void; }
const Context = createContext<Session | null>(null);

/** 账号和请求实例共存于应用内存，换账号时旧请求与页面数据一起失效。 */
export function SessionProvider({ children }: PropsWithChildren) {
  const [session, setSession] = useState<{ api: WebApi; profile: Profile } | null>(null);
  const active = useRef<WebApi | null>(null);
  const logout = () => { active.current?.close(); active.current = null; setSession(null); };
  const login = async (token: string) => {
    logout();
    const api = new WebApi(token, () => { if (active.current === api) logout(); });
    active.current = api;
    try {
      const profile = await api.request<Profile>("/me");
      if (typeof profile.userId !== "string" || typeof profile.displayName !== "string" || !Array.isArray(profile.teams)
        || profile.teams.some((item) => !item || !UUID_PATTERN.test(item.teamId) || typeof item.name !== "string" || !["leader", "analyst", "member"].includes(item.role))) throw new Error("账号资料格式无效。");
      if (active.current === api) setSession({ api, profile });
    } catch (error) { if (active.current === api) logout(); else api.close(); throw error; }
  };
  return <Context.Provider value={{ api: session?.api ?? null, profile: session?.profile ?? null, login, logout }}>{children}</Context.Provider>;
}

export function useSession() {
  const value = useContext(Context);
  if (!value) throw new Error("缺少账号会话。");
  return value;
}
