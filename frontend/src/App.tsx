import { Routes, Route } from 'react-router-dom';
import { AnimatePresence } from 'framer-motion';
import Navbar from './components/Navbar';
import Footer from './components/Footer';
import Home from './pages/Home';
import Playground from './pages/Playground';
import AiLabPage from './pages/AiLabPage';
import Stats from './pages/Stats';

export default function App() {
  return (
    <div className="min-h-screen flex flex-col bg-cyber-bg">
      <Navbar />
      <main className="flex-1">
        <AnimatePresence mode="wait">
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/playground" element={<Playground />} />
            <Route path="/ai-lab" element={<AiLabPage />} />
            <Route path="/stats" element={<Stats />} />
          </Routes>
        </AnimatePresence>
      </main>
      <Footer />
    </div>
  );
}
