import { WagmiProvider } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createAppKit } from "@reown/appkit/react";
import { WagmiAdapter } from "@reown/appkit-adapter-wagmi";
import { defineChain } from "@reown/appkit/networks";
import { ChainProvider } from "./context/ChainContext";
import { CHAIN_LIST } from "./config/chains";
import { useAutoAuth } from "./hooks/useAutoAuth";

const wagmiNetworks = CHAIN_LIST
  .filter(c => c.chainId && c.rpcUrl)
  .map(c =>
    defineChain({
      id: c.chainId,
      name: c.name,
      nativeCurrency: c.nativeCurrency,
      rpcUrls: { default: { http: [c.rpcUrl] } },
      blockExplorers: c.explorerUrl
        ? { default: { name: `${c.name} Explorer`, url: c.explorerUrl } }
        : undefined,
    })
  );

if (wagmiNetworks.length === 0) {
  throw new Error(
    "No chains with a valid chainId+rpcUrl found in chains.js — check that at least one chain has status 'live' with chainId and rpcUrl set."
  );
}

const projectId = import.meta.env.VITE_REOWN_PROJECT_ID;
const queryClient = new QueryClient();

// ── Chain icons for the AppKit "Choose Network" modal ──────────────────
// Bina iske AppKit har custom chain pe generic globe dikhata hai. Har chain
// ka logo chains.js se lete hain aur ABSOLUTE URL banate hain (AppKit ka
// modal apne context me render hota hai — relative "/chains/mst.svg" kaam
// nahi karta, isliye origin prefix karte hain).
const ORIGIN =
  (typeof window !== "undefined" && window.location?.origin) ||
  "https://playarcadex.in";

const chainImages = CHAIN_LIST.reduce((acc, c) => {
  if (c.chainId && c.logo) {
    acc[c.chainId] = c.logo.startsWith("http")
      ? c.logo
      : `${ORIGIN}${c.logo.startsWith("/") ? "" : "/"}${c.logo}`;
  }
  return acc;
}, {});

// Read selected chain from localStorage
const savedChainKey = (() => {
  try { return window.localStorage.getItem("arcadex_selected_chain"); } catch { return null; }
})();
const savedNetwork = savedChainKey
  ? wagmiNetworks.find(n => {
      const chain = CHAIN_LIST.find(c => c.key === savedChainKey);
      return chain && n.id === chain.chainId;
    })
  : null;

const defaultNetwork = savedNetwork ?? wagmiNetworks[0];

// KEY FIX: AppKit internally tries to add/connect networks[0] when user clicks
// "Connect Wallet" — defaultNetwork sirf UI default set karta hai, actual
// chain request networks array ki FIRST entry se aati hai.
// Isliye selected chain ko array mein PEHLE rakho — baaki chains baad mein.
// wagmiAdapter ke paas sab chains rehti hain (chain-switching ke liye),
// AppKit ko selected-first order milta hai.
const appKitNetworks = savedNetwork
  ? [savedNetwork, ...wagmiNetworks.filter(n => n.id !== savedNetwork.id)]
  : wagmiNetworks;

const wagmiAdapter = new WagmiAdapter({
  networks: wagmiNetworks, // wagmi ke paas sab chains (switching support)
  projectId,
  ssr: false,
});

createAppKit({
  adapters: [wagmiAdapter],
  networks: appKitNetworks, // selected chain PEHLE — yahi fix hai
  projectId,
  defaultNetwork,
  chainImages, // ← globe ki jagah har chain ka apna icon (MST/BOTChain/Somnia)
  metadata: {
    name: "ArcadeX",
    description: "Play. Earn. Build — On Any Chain.",
    url: "https://playarcadex.in",
    icons: ["/IA-logo.png"],
  },
  features: {
    analytics: false,
    email: false,
    socials: false,
    onramp: false,
    swaps: false,
  },
  themeMode: "dark",
  themeVariables: {
    "--w3m-accent": "#7B2FFF",
    "--w3m-border-radius-master": "8px",
  },
});

export { wagmiAdapter };

function AutoAuth() {
  useAutoAuth();
  return null;
}

export default function Providers({ children }) {
  return (
    <WagmiProvider config={wagmiAdapter.wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <ChainProvider>
          <AutoAuth />
          {children}
        </ChainProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}