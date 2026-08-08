import { Routes, Route } from "react-router-dom";
import { useChain } from "./context/ChainContext";  // ← YE CRITICAL HAI
import ChainSelector from "./pages/ChainSelector";
import ChainLanding from "./pages/ChainLanding";
import Navbar from "./components/Navbar";
import Home from "./pages/Home";
import GameLibrary from "./pages/GameLibrary";
import GamePlay from "./pages/GamePlay";
import Leaderboard from "./pages/Leaderboard";
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

export default function App() {
  const { hasSelectedChain } = useChain();

  return (
    <Routes>
      {/* Direct chain links — hasSelectedChain gate se bahar */}
      <Route path="/mstblockchain" element={<ChainLanding chainKey="mst" />} />
      <Route path="/botchain" element={<ChainLanding chainKey="botchain" />} />

      {/* Baaki sab */}
      <Route path="*" element={
        (
          <div style={{ background: "#0C0C0C", minHeight: "100vh" }}>
            <Navbar />
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/games" element={<GameLibrary />} />
              <Route path="/play/:gameId" element={<GamePlay />} />
              <Route path="/leaderboard" element={<Leaderboard />} />
              <Route path="/admin" element={<Admin />} />
              <Route path="/publish" element={<Creator />} />
              <Route path="/sdk" element={<SDK />} />
              <Route path="/tournaments" element={<Tournaments />} />
              <Route path="/marketplace" element={<Marketplace />} />
              <Route path="/community" element={<Community />} />
              <Route path="/publish/game/:gameId" element={<CreatorGameDetail />} />
              <Route path="/support" element={<Support />} />
              <Route path="/campaign" element={<CampaignLanding />} />
              <Route path="/campaign/portal" element={<Campaign />} />
              <Route path="/campaign/dashboard" element={<CampaignDashboard />} />
              <Route path="/campaign/leaderboard" element={<CampaignLeaderboard />} />
              <Route path="/campaign/admin" element={<CampaignAdmin />} />
              <Route path="/admin/mst" element={<AdminMST />} />
            </Routes>
            {/* ChainSelector is a fixed full-screen overlay (z-9999), so it
                covers the content for humans on first visit — preserving the
                "pick a chain every time" flow — while the real page content and
                its SEO title/description/schema stay in the DOM for search
                crawlers, which have no saved chain and previously saw only the
                selector on every URL. */}
            {!hasSelectedChain && <ChainSelector />}
          </div>
        )
      } />
    </Routes>
  );
}