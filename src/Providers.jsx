import { WagmiProvider } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createAppKit } from "@reown/appkit/react";
import { WagmiAdapter } from "@reown/appkit-adapter-wagmi";
import { defineChain } from "@reown/appkit/networks";
import { ChainProvider } from "./context/ChainContext";
import { CHAIN_LIST } from "./config/chains";
import { useAutoAuth } from "./hooks/useAutoAuth";

// ── Build wagmi network list dynamically from the chain registry ──────────
// Only chains with a real chainId + rpcUrl get registered with wagmi —
// "coming_soon" chains with chainId: null (like MST before launch) are
// skipped automatically. The moment MST's chainId/rpcUrl are filled in and
// flipped to "live", it appears here with zero code changes needed.
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

// Fallback safety: wagmi/Reown require at least one network. This should
// never trigger in practice since BOTChain is always live, but guards
// against a misconfigured registry breaking the entire app on boot.
if (wagmiNetworks.length === 0) {
  throw new Error(
    "No chains with a valid chainId+rpcUrl found in chains.js — check that at least one chain has status 'live' with chainId and rpcUrl set."
  );
}

const projectId = import.meta.env.VITE_REOWN_PROJECT_ID;
const queryClient = new QueryClient();

const wagmiAdapter = new WagmiAdapter({
  networks: wagmiNetworks,
  projectId,
  ssr: false,
});

createAppKit({
  adapters: [wagmiAdapter],
  networks: wagmiNetworks,
  projectId,
  defaultNetwork: wagmiNetworks[0],
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

// NOTE: The old exported constants (ARCADE_TOKEN_ADDRESS, PLATFORM_ADDRESS,
// CHAIN_ID, etc.) are intentionally removed. Every page should now pull
// these from useChain() (see src/context/ChainContext.jsx) instead of
// importing them from here — that's the whole point of the registry.
// If you see an import error for one of these old names somewhere, that
// file still needs to be refactored to use useChain().

// Tiny wrapper so useAutoAuth() (a hook) can run inside the WagmiProvider
// tree, where useAccount()/useWalletClient() are actually available.
// It renders nothing — purely a side-effect mount point. Without this,
// arcadex_jwt never gets set and every JWT-gated route (comments, likes,
// score submission, admin actions, badge claims) silently fails with
// "Unauthorized".
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