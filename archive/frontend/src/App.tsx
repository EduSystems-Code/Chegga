import { useEffect, useState } from "react";
import { Route, Routes } from "react-router-dom";
import { api } from "./api/client";
import Layout from "./components/Layout";
import LoadingScreen from "./components/LoadingScreen";
import DrillsPage from "./pages/DrillsPage";
import GameDetailPage from "./pages/GameDetailPage";
import GamesListPage from "./pages/GamesListPage";
import ProfilePage from "./pages/ProfilePage";

const MIN_LOADING_MS = 900; // long enough for the mark's draw-in animation to actually be seen

export default function App() {
  const [showLoadingScreen, setShowLoadingScreen] = useState(true);
  const [fadingOut, setFadingOut] = useState(false);

  useEffect(() => {
    const start = Date.now();
    api
      .health()
      .catch(() => {}) // a down backend shouldn't trap the user on the loading screen forever
      .finally(() => {
        const elapsed = Date.now() - start;
        setTimeout(() => setFadingOut(true), Math.max(0, MIN_LOADING_MS - elapsed));
      });
  }, []);

  useEffect(() => {
    if (!fadingOut) return;
    const timer = setTimeout(() => setShowLoadingScreen(false), 400); // matches .loading-screen's opacity transition
    return () => clearTimeout(timer);
  }, [fadingOut]);

  return (
    <>
      {showLoadingScreen && <LoadingScreen fadingOut={fadingOut} />}
      <Layout>
        <Routes>
          <Route path="/" element={<GamesListPage />} />
          <Route path="/games/:id" element={<GameDetailPage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/drills" element={<DrillsPage />} />
        </Routes>
      </Layout>
    </>
  );
}
