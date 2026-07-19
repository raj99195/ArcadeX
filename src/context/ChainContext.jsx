// src/context/ChainContext.jsx
//
// Tracks which chain the user is currently playing on. Replaces all
// hardcoded import.meta.env.VITE_PLATFORM_ADDRESS style references —
// any component that needs a contract address, the reward token symbol,
// or the active chainId should call useChain() instead.

import { createContext, useContext, useState, useCallback } from "react";
import {
  CHAINS,
  CHAIN_LIST,
  LIVE_CHAINS,
  getChainByKey,
} from "../config/chains";

const STORAGE_KEY = "arcadex_selected_chain";
const ChainContext = createContext(null);

export function ChainProvider({ children }) {
  const [chainKey, setChainKeyState] = useState(() => {
    if (typeof window === "undefined") return null;
    const saved = window.localStorage.getItem(STORAGE_KEY);
    // Only honor a saved key if it's still a valid, live chain —
    // protects against stale localStorage pointing at a chain that
    // got removed or flipped back to "coming_soon".
    if (saved && getChainByKey(saved)?.status === "live") return saved;

    // No saved selection (or it's stale) — always show the selector
    // screen, even if there's only one live chain. The user explicitly
    // picks every time on a fresh browser/cleared storage, by design.
    return null;
  });

  const setChainKey = useCallback((key) => {
    const chain = getChainByKey(key);
    if (!chain || chain.status !== "live") {
      console.warn(`Attempted to select unavailable chain: ${key}`);
      return;
    }
    window.localStorage.setItem(STORAGE_KEY, key);
    setChainKeyState(key);
  }, []);

  const clearChainSelection = useCallback(() => {
    window.localStorage.removeItem(STORAGE_KEY);
    setChainKeyState(null);
  }, []);

  const activeChain = chainKey ? CHAINS[chainKey] : null;

  const value = {
    chainKey,
    activeChain,           // full chain object: { chainId, name, contracts, rewardToken, ... }
    setChainKey,            // call this when user picks a chain on the selector screen
    clearChainSelection,     // call this to force the selector to show again
    hasSelectedChain: !!activeChain,
    allChains: CHAIN_LIST,
    liveChains: LIVE_CHAINS,
  };

  return <ChainContext.Provider value={value}>{children}</ChainContext.Provider>;
}

/**
 * useChain() — the single hook every page/component should use instead of
 * reading import.meta.env directly.
 *
 * Example:
 *   const { contracts, rewardToken, chainId, isNativeToken } = useChain();
 *   await writeContract(wagmiAdapter.wagmiConfig, {
 *     address: contracts.gameItems,
 *     ...
 *     value: isNativeToken ? price : undefined,
 *     chainId,
 *   });
 */
export function useChain() {
  const ctx = useContext(ChainContext);
  if (!ctx) throw new Error("useChain() must be used inside <ChainProvider>");

  const { activeChain } = ctx;
  const rewardType = activeChain?.rewardType ?? "erc20"; // "erc20" | "native"

  return {
    ...ctx,
    // Flattened convenience accessors — undefined-safe if no chain selected yet
    chainId:       activeChain?.chainId      ?? null,
    contracts:     activeChain?.contracts    ?? {},
    rewardToken:   activeChain?.rewardToken  ?? null,
    rewardType,
    // Derived boolean, kept in sync with rewardType so callers don't have to
    // re-derive it (or worse, assume a field name that doesn't exist here).
    isNativeToken: rewardType === "native",
    nativeCurrency: activeChain?.nativeCurrency ?? null,
    explorerUrl:   activeChain?.explorerUrl  ?? null,
    chainName:     activeChain?.name         ?? null,
    minRewardRate: activeChain?.minRewardRate ?? 5,
    maxRewardRate: activeChain?.maxRewardRate ?? 500,
  };
}