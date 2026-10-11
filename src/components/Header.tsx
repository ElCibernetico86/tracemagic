import { Link, useNavigate } from 'react-router-dom';
import { Sparkles, Menu, X, User } from 'lucide-react';
import { useState } from 'react';
import { useAuthState } from 'react-firebase-hooks/auth';
import { auth, signInWithGoogle, logOut } from '../lib/firebase';

export default function Header() {
  const [isOpen, setIsOpen] = useState(false);
  const [user] = useAuthState(auth);
  const navigate = useNavigate();

  const handleAuth = async () => {
    if (user) {
      await logOut();
      navigate('/');
    } else {
      await signInWithGoogle();
      navigate('/dashboard');
    }
  };

  return (
    <header className="sticky top-0 z-50 w-full border-b border-white/10 bg-[#050505]/80 backdrop-blur-md">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-[72px]">
          <Link to="/" className="flex items-center gap-2">
            <div className="bg-[#C1FF00] p-1.5 rounded text-black">
              <Sparkles className="w-5 h-5" />
            </div>
            <span className="font-black text-xl tracking-tighter uppercase text-white">TraceMagic</span>
          </Link>

          {/* Desktop Nav */}
          <nav className="hidden lg:flex items-center gap-8 text-[11px] font-bold text-white/60 uppercase tracking-[1.5px]">
            <Link to="/app" className="hover:text-white transition-colors">Trace</Link>
            <Link to="/upscale" className="hover:text-white transition-colors">Upscale</Link>
            <Link to="/features" className="hover:text-white transition-colors">Features</Link>
            <Link to="/pricing" className="hover:text-white transition-colors">Pricing</Link>
            <Link to="/blog" className="hover:text-white transition-colors">Blog</Link>
            <Link to="/vs/vectorizer-ai" className="hover:text-white transition-colors">Compare</Link>
          </nav>

          <div className="hidden lg:flex items-center gap-4">
            {user && (
              <Link to="/dashboard" className="text-[11px] font-bold text-white/60 hover:text-white uppercase tracking-[1.5px] flex items-center gap-2">
                <img src={user.photoURL || ''} alt="avatar" className="w-6 h-6 rounded-full" />
                Dashboard
              </Link>
            )}
            <button 
              onClick={handleAuth}
              className="text-[11px] font-bold text-white/60 hover:text-white uppercase tracking-[1.5px] transition-colors"
            >
              {user ? 'Sign Out' : 'Sign In'}
            </button>
            <Link 
              to="/app" 
              className="bg-[#C1FF00] hover:bg-[#a6db00] text-black px-5 py-2.5 rounded-full text-[11px] font-black uppercase tracking-[1.5px] transition-all"
            >
              Start Tracing
            </Link>
          </div>

          {/* Mobile Menu Button */}
          <button 
            className="lg:hidden p-2 text-white/60"
            onClick={() => setIsOpen(!isOpen)}
          >
            {isOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>
        </div>
      </div>

      {/* Mobile Nav */}
      {isOpen && (
        <div className="lg:hidden border-t border-white/10 bg-[#050505]">
          <div className="px-4 py-6 flex flex-col gap-4 text-[11px] font-bold uppercase tracking-[1.5px]">
            <Link to="/app" onClick={() => setIsOpen(false)} className="text-white/60 hover:text-white">Trace</Link>
            <Link to="/upscale" onClick={() => setIsOpen(false)} className="text-white/60 hover:text-white">Upscale</Link>
            <Link to="/features" onClick={() => setIsOpen(false)} className="text-white/60 hover:text-white">Features</Link>
            <Link to="/pricing" onClick={() => setIsOpen(false)} className="text-white/60 hover:text-white">Pricing</Link>
            <Link to="/blog" onClick={() => setIsOpen(false)} className="text-white/60 hover:text-white">Blog</Link>
            <Link to="/vs/vectorizer-ai" onClick={() => setIsOpen(false)} className="text-white/60 hover:text-white">Compare</Link>
            {user && (
               <Link to="/dashboard" onClick={() => setIsOpen(false)} className="text-[#C1FF00]">Dashboard</Link>
            )}
            <div className="border-t border-white/10 pt-4 mt-2 flex flex-col gap-4">
              <button onClick={() => { handleAuth(); setIsOpen(false); }} className="w-full text-center text-white/60 hover:text-white py-2">
                {user ? 'Sign Out' : 'Sign In'}
              </button>
              <Link to="/app" onClick={() => setIsOpen(false)} className="w-full bg-[#C1FF00] text-black text-center py-3 rounded-xl font-black">
                Start Tracing
              </Link>
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
