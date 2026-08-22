import { Link, Route, Routes } from "react-router-dom";
import DrillsPage from "./pages/DrillsPage";
import GameDetailPage from "./pages/GameDetailPage";
import GamesListPage from "./pages/GamesListPage";
import ProfilePage from "./pages/ProfilePage";

export default function App() {
  return (
    <div className="app">
      <header className="app-header">
        <Link to="/" className="app-title">Chegga</Link>
        <nav className="app-nav">
          <Link to="/">Games</Link>
          <Link to="/profile">Profile</Link>
          <Link to="/drills">Drills</Link>
        </nav>
      </header>
      <main>
        <Routes>
          <Route path="/" element={<GamesListPage />} />
          <Route path="/games/:id" element={<GameDetailPage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/drills" element={<DrillsPage />} />
        </Routes>
      </main>
    </div>
  );
}
