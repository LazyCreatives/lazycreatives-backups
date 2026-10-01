import { createContext, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { makeApi } from "./api";
import type { Entitlement } from "./types";

const api = makeApi();
type Feature = keyof Entitlement["features"];

const Ctx = createContext<{ ent: Entitlement | null; refresh: () => void }>({ ent: null, refresh: () => {} });

export function EntitlementProvider({ children }: { children: ReactNode }) {
  const [ent, setEnt] = useState<Entitlement | null>(null);
  function refresh() { api.entitlement().then(setEnt).catch(() => {}); }
  useEffect(refresh, []);
  return <Ctx.Provider value={{ ent, refresh }}>{children}</Ctx.Provider>;
}

export function useEntitlement() {
  const { ent, refresh } = useContext(Ctx);
  const tier = ent?.tier ?? "free";
  return {
    tier,
    isPro: tier !== "free",
    loaded: ent !== null,
    allows: (f: Feature) => Boolean(ent?.features?.[f]),
    refresh,
  };
}
