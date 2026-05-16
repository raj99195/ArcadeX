import { Routes, Route } from "react-router-dom";
import Navbar from "./components/Navbar";
import Home from "./pages/Home";
import GameLibrary from "./pages/GameLibrary";
import GamePlay from "./pages/GamePlay";
import Leaderboard from "./pages/Leaderboard";
import Admin from "./pages/Admin";
import Creator from "./pages/Creator";
import SDK from "./pages/SDK";

export default function App() {
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
           </Routes>
    </div>
  );
}