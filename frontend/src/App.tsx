import { Link, Route, Routes } from "react-router-dom";
import GameDetailPage from "./pages/GameDetailPage";
import GamesListPage from "./pages/GamesListPage";

export default function App() {
  return (
    <div className="app">
      <header className="app-header">
        <Link to="/" className="app-title">Chegga</Link>
      </header>
      <main>
        <Routes>
          <Route path="/" element={<GamesListPage />} />
          <Route path="/games/:id" element={<GameDetailPage />} />
        </Routes>
      </main>
    </div>
  );
}
