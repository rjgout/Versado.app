"use client";
import { createContext, useContext, type ReactNode } from "react";
import type { AccountActions } from "@/lib/account/contracts";

const Context = createContext<AccountActions | null>(null);
export function AccountActionsProvider({ actions, children }: { actions: AccountActions; children: ReactNode }) { return <Context.Provider value={actions}>{children}</Context.Provider>; }
export function useAccountActions() { const actions = useContext(Context); if (!actions) throw new Error("AccountActionsProvider ontbreekt"); return actions; }
