// Place at: src/App.jsx (REPLACES existing)
import BattlePass from "./pages/BattlePass";
import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import { useChain } from "./context/ChainContext";
import { useMode } from "./hooks/useMode";
import { useWeb2Auth } from "./hooks/useWeb2Auth";
import ChainSelector from "./pages/ChainSelector";
import ChainLanding from "./pages/ChainLanding";
import ModeSelector from "./components/ModeSelector";
import Web2LoginScreen from "./components/Web2LoginScreen";
import Navbar from "./components/Navbar";
import ErrorBoundary from "./components/ErrorBoundary";
import { CursorGlow } from "./components/Motion";
import Home from "./pages/Home";
import GameLibrary from "./pages/GameLibrary";
import GamePlay from "./pages/GamePlay";
import Web2GamePlay from "./pages/Web2GamePlay";
import Leaderboard from "./pages/Leaderboard";
import Web2Leaderboard from "./pages/Web2Leaderboard";
import Web2Profile from "./pages/Web2Profile";
import Web2Tournaments from "./pages/Web2Tournaments";
import Web2Creators from "./pages/Web2Creators";
import Admin from "./pages/Admin";
import Creator from "./pages/Creator";
import SDK from "./pages/SDK";
import Tournaments from "./pages/Tournaments";
import Marketplace from "./pages/Marketplace";
import Community from "./pages/Community";
import CreatorGameDetail from "./pages/CreatorGameDetail";
import Support from "./pages/Support";
import CampaignLanding from "./pages/CampaignLanding";
import Campaign from "./pages/Campaign";
import CampaignDashboard from "./pages/CampaignDashboard";
import CampaignLeaderboard from "./pages/CampaignLeaderboard";
import CampaignAdmin from "./pages/CampaignAdmin";
import AdminMST from "./pages/AdminMST";
import BattleArena from "./pages/BattleArena";

// Pages blocked in Web2 mode (need wallet / on-chain state). In Web2 mode,
// hitting one of these redirects to Home. Phase 2 adds Web2-safe variants
// for leaderboard etc.
const WEB3_ONLY_PATHS = [
  "/admin", "/admin/mst",
  "/marketplace",
  "/campaign", "/campaign/portal", "/campaign/dashboard",
  "/campaign/leaderboard", "/campaign/admin",
  "/battle-arena", "/battle-pass",
  "/sdk",
];

function Web2RouteGuard({ children }) {
  const { mode } = useMode();
  const location = useLocation();
  if (mode === "web2") {
    const path = location.pathname;
    const blocked = WEB3_ONLY_PATHS.some(p => path === p || path.startsWith(p + "/"));
    if (blocked) return <Navigate to="/" replace />;
  }
  return children;
}

// /play/:gameId switches to Web2GamePlay when mode === "web2". Keeping both
// pages separate (not merged behind flags) so the Web3 flow stays untouched.
function PlayRoute() {
  const { mode } = useMode();
  return mode === "web2" ? <Web2GamePlay /> : <GamePlay />;
}

// /leaderboard: Web3 users keep the on-chain leaderboard; Web2 users see
// the Firestore-backed ArcadeCoins leaderboard.
function LeaderboardRoute() {
  const { mode } = useMode();
  return mode === "web2" ? <Web2Leaderboard /> : <Leaderboard />;
}

// /tournaments: Web3 users keep the on-chain Tournament.sol arena; Web2
// users see the Firestore-backed daily/weekly ArcadeCoin tournaments.
function TournamentsRoute() {
  const { mode } = useMode();
  return mode === "web2" ? <Web2Tournaments /> : <Tournaments />;
}

// /publish: Web3 opens the actual creator portal; Web2 sees a browse-only
// creator showcase (publishing needs a wallet).
function CreatorsRoute() {
  const { mode } = useMode();
  return mode === "web2" ? <Web2Creators /> : <Creator />;
}

// /profile is Web2-only for now (Web3 identity lives in wallet UI).
// Web3 users hitting /profile fall through to Home via Web2RouteGuard
// style redirect handled inline here.
function ProfileRoute() {
  const { mode } = useMode();
  if (mode !== "web2") return <Navigate to="/" replace />;
  return <Web2Profile />;
}

export default function App() {
  const { hasSelectedChain } = useChain();
  const { mode, hasSelectedMode } = useMode();
  const { isAuthenticated: web2Authed } = useWeb2Auth();

  // Overlay priority (highest first):
  //  1. ModeSelector  — no mode picked yet
  //  2. Web2Login     — web2 mode, not signed in
  //  3. ChainSelector — web3 mode, no chain picked
  const showModeSelector  = !hasSelectedMode;
  const showWeb2Login     = hasSelectedMode && mode === "web2" && !web2Authed;
  const showChainSelector = hasSelectedMode && mode === "web3" && !hasSelectedChain;

  return (
    <Routes>
      {/* Direct chain links — bypass mode/chain gates */}
      <Route path="/mstblockchain" element={<ChainLanding chainKey="mst" />} />
      <Route path="/botchain" element={<ChainLanding chainKey="botchain" />} />

      {/* Everything else */}
      <Route path="*" element={
        <div style={{ background: "#0C0C0C", minHeight: "100vh" }}>
          {/* Global cursor glow — soft purple halo that trails the pointer.
              Auto-skips on touch devices and when prefers-reduced-motion. */}
          <CursorGlow color="rgba(123,47,255,0.3)" size={460} blur={100} zIndex={1} />
          <Navbar />
          <Web2RouteGuard>
            <ErrorBoundary>
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/games" element={<GameLibrary />} />
              <Route path="/play/:gameId" element={<PlayRoute />} />
              <Route path="/leaderboard" element={<LeaderboardRoute />} />
              <Route path="/profile" element={<ProfileRoute />} />
              <Route path="/admin" element={<Admin />} />
              <Route path="/publish" element={<CreatorsRoute />} />
              <Route path="/sdk" element={<SDK />} />
              <Route path="/tournaments" element={<TournamentsRoute />} />
              <Route path="/marketplace" element={<Marketplace />} />
              <Route path="/community" element={<Community />} />
              <Route path="/publish/game/:gameId" element={<CreatorGameDetail />} />
              <Route path="/support" element={<Support />} />
              <Route path="/campaign" element={<CampaignLanding />} />
              <Route path="/campaign/portal" element={<Campaign />} />
              <Route path="/campaign/dashboard" element={<CampaignDashboard />} />
              <Route path="/campaign/leaderboard" element={<CampaignLeaderboard />} />
              <Route path="/campaign/admin" element={<CampaignAdmin />} />
              <Route path="/battle-arena" element={<BattleArena />} />
              <Route path="/admin/mst" element={<AdminMST />} />
              <Route path="/battle-pass" element={<BattlePass />} />
            </Routes>
            </ErrorBoundary>
          </Web2RouteGuard>

          {/* Overlays — same as ChainSelector pattern, DOM stays mounted for SEO */}
          {showChainSelector && <ChainSelector />}
          {showWeb2Login && <Web2LoginScreen />}
          {showModeSelector && <ModeSelector />}
        </div>
      } />
    </Routes>
  );
}
