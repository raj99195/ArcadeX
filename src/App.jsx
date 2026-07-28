import { Routes, Route } from "react-router-dom";
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
import ChainSelector from "./pages/ChainSelector";
import { useChain } from "./context/ChainContext";
import Support from "./pages/Support";
import CampaignLanding from "./pages/CampaignLanding";
import Campaign from "./pages/Campaign";
import CampaignDashboard from "./pages/CampaignDashboard";
import CampaignLeaderboard from "./pages/CampaignLeaderboard";
import CampaignAdmin from "./pages/CampaignAdmin";
import AdminMST from "./pages/AdminMST";
export default function App() {
  const { hasSelectedChain } = useChain();
  // No chain picked yet — show the full-screen "Choose Your Chain" picker
  // and nothing else (no navbar, no routes). The moment setChainKey() is
  // called inside ChainSelector, this re-renders and falls through to the
  // normal app below.
  if (!hasSelectedChain) {
    return <ChainSelector />;
  }
  return (
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
        <Route path="/mstblockchain" element={<ChainLanding chainKey="mst" />} />
<Route path="/botchain" element={<ChainLanding chainKey="botchain" />} />
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
    </div>
  );
}