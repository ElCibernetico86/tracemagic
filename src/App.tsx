/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Header from './components/Header';
import Footer from './components/Footer';
import Home from './pages/Home';
import AppPage from './pages/AppPage';
import UpscalePage from './pages/UpscalePage';
import Features from './pages/Features';
import VsPage from './pages/VsPage';
import Blog from './pages/Blog';

export default function App() {
  return (
    <BrowserRouter>
      <div className="min-h-screen flex flex-col bg-[#050505] text-white font-sans selection:bg-[#C1FF00]/30 selection:text-[#C1FF00]">
        <Header />
        <main className="flex-grow flex flex-col">
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/app" element={<AppPage />} />
            <Route path="/upscale" element={<UpscalePage />} />
            <Route path="/features" element={<Features />} />
            <Route path="/blog" element={<Blog />} />
            <Route path="/vs/:competitor" element={<VsPage />} />
          </Routes>
        </main>
        <Footer />
      </div>
    </BrowserRouter>
  );
}
