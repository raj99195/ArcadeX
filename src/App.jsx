export default function App() {
  const { hasSelectedChain } = useChain();

  // ChainLanding routes — BEFORE the hasSelectedChain gate
  // Inhe hamesha render karo taaki direct links kaam karein
  return (
    <Routes>
      {/* Ye routes seedha chain set karke / pe bhejte hain */}
      <Route path="/mstblockchain" element={<ChainLanding chainKey="mst" />} />
      <Route path="/botchain" element={<ChainLanding chainKey="botchain" />} />

      {/* Baaki sab hasSelectedChain ke baad */}
      <Route path="*" element={
        !hasSelectedChain ? (
          <ChainSelector />
        ) : (
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
          </div>
        )
      } />
    </Routes>
  );
}
