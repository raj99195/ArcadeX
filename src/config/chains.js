// src/config/chains.js
//
// Central Chain Registry — single source of truth for every chain ArcadeX
// supports. ALL static metadata (chainId, RPC URL, explorer URL, native
// currency) lives directly here as hardcoded values — these are public,
// non-secret values (no different than what's in a block explorer), so
// there's no benefit to routing them through .env. Only contract addresses
// come from deployedAddresses.json, since those are generated at deploy
// time rather than known up front.
//
// To add a new chain:
//   1. Add a full metadata block below (chainId, name, rpcUrl, explorerUrl,
//      nativeCurrency, rewardToken, status: "coming_soon")
//   2. Run: npx hardhat run scripts/deploy.js --network <chainKey>
//   3. deploy.js fills deployedAddresses.json AND flips status to "live" automatically
// That's it — no other file needs to change.

import deployedAddresses from "./deployedAddresses.json";

export const CHAINS = {
  botchain: {
    key: "botchain",
    chainId: 677,
    name: "BOTChain",
    rpcUrl: "https://rpc.botchain.ai",
    explorerUrl: "https://scan.botchain.ai",
    nativeCurrency: { name: "BOT", symbol: "BOT", decimals: 18 },
    rewardToken: "ARCADE",
    rewardType: "erc20",   // approve + transferFrom
    contracts: deployedAddresses.botchain,
    logo: "/chains/botchain.svg",
    status: "live",
    minRewardRate: 10,
    maxRewardRate: 500,
  },

  mst: {
    key: "mst",
    chainId: 4646,
    name: "MST Blockchain",
    rpcUrl: "https://mariorpc.mstblockchain.com",
    explorerUrl: "https://mstscan.com",
    nativeCurrency: { name: "MSTC", symbol: "MSTC", decimals: 18 },
    rewardToken: "MSTC",
    rewardType: "native",  // msg.value — no approve needed
    contracts: deployedAddresses.mst,
    logo: "/chains/mst.svg",
    status: "live",
    minRewardRate: 1,
    maxRewardRate: 2,
  },

  somnia: {
    key: "somnia",
    chainId: 50312,
    name: "Somnia",
    rpcUrl: "https://50312.rpc.thirdweb.com",
    explorerUrl: "https://shannon-explorer.somnia.network",
    nativeCurrency: { name: "Somnia Test Token", symbol: "STT", decimals: 18 },
    rewardToken: "ARCADE",
    rewardType: "erc20",   // approve + transferFrom
    contracts: deployedAddresses.somnia,
    logo: "/chains/somnia.svg",
    status: "coming_soon",
    minRewardRate: 10,
    maxRewardRate: 500,
  },
};

/** Ordered list for UI rendering (chain selector cards, dropdowns, etc.) */
export const CHAIN_LIST = Object.values(CHAINS);

/** Only chains that are actually usable right now */
export const LIVE_CHAINS = CHAIN_LIST.filter(c => c.status === "live");

/** Lookup by numeric chainId (e.g. from wagmi's useChainId()) */
export function getChainByChainId(chainId) {
  return CHAIN_LIST.find(c => c.chainId === chainId) || null;
}

/** Lookup by registry key (e.g. "botchain", "somnia") */
export function getChainByKey(key) {
  return CHAINS[key] || null;
}

/** Default chain key — used when nothing is saved in localStorage yet */
export const DEFAULT_CHAIN_KEY = "botchain";