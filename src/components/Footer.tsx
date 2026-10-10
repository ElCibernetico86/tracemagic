import { Link } from 'react-router-dom';
import { Sparkles, Twitter, Github, Linkedin } from 'lucide-react';

export default function Footer() {
  return (
    <footer className="bg-[#050505] border-t border-white/10 pt-16 pb-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-12 mb-12">
          <div className="col-span-1 md:col-span-1">
            <Link to="/" className="flex items-center gap-2 mb-4">
              <div className="bg-[#C1FF00] p-1.5 rounded text-black">
                <Sparkles className="w-5 h-5" />
              </div>
              <span className="font-black text-xl tracking-tighter uppercase text-white">TraceMagic</span>
            </Link>
            <p className="text-white/60 text-sm mb-6 leading-relaxed">
              Fast image tracing in seconds. Vectorize your images better, faster, and without limits.
            </p>
            <div className="flex items-center gap-4 text-white/40">
              <a href="#" className="hover:text-[#C1FF00] transition-colors"><Twitter className="w-5 h-5" /></a>
              <a href="#" className="hover:text-[#C1FF00] transition-colors"><Github className="w-5 h-5" /></a>
              <a href="#" className="hover:text-[#C1FF00] transition-colors"><Linkedin className="w-5 h-5" /></a>
            </div>
          </div>
          
          <div>
            <h3 className="font-black text-[11px] uppercase tracking-[1.5px] text-white mb-6">Product</h3>
            <ul className="space-y-4 text-sm text-white/60 font-medium">
              <li><Link to="/features" className="hover:text-[#C1FF00] transition-colors">Features</Link></li>
              <li><Link to="/pricing" className="hover:text-[#C1FF00] transition-colors">Pricing</Link></li>
              <li><Link to="/app" className="hover:text-[#C1FF00] transition-colors">Try for free</Link></li>
              <li><Link to="/blog" className="hover:text-[#C1FF00] transition-colors">Changelog</Link></li>
            </ul>
          </div>

          <div>
            <h3 className="font-black text-[11px] uppercase tracking-[1.5px] text-white mb-6">Comparisons</h3>
            <ul className="space-y-4 text-sm text-white/60 font-medium">
              <li><Link to="/vs/vectorizer-ai" className="hover:text-[#C1FF00] transition-colors">vs Vectorizer.ai</Link></li>
              <li><Link to="/vs/adobe-illustrator" className="hover:text-[#C1FF00] transition-colors">vs Adobe Illustrator</Link></li>
              <li><Link to="/vs/autotracer" className="hover:text-[#C1FF00] transition-colors">vs Autotracer.org</Link></li>
              <li><Link to="/vs/inkscape" className="hover:text-[#C1FF00] transition-colors">vs Inkscape</Link></li>
            </ul>
          </div>

          <div>
            <h3 className="font-black text-[11px] uppercase tracking-[1.5px] text-white mb-6">Resources</h3>
            <ul className="space-y-4 text-sm text-white/60 font-medium">
              <li><Link to="/blog" className="hover:text-[#C1FF00] transition-colors">Blog</Link></li>
              <li><a href="#" className="hover:text-[#C1FF00] transition-colors">API Documentation</a></li>
              <li><a href="#" className="hover:text-[#C1FF00] transition-colors">Help Center</a></li>
              <li><a href="#" className="hover:text-[#C1FF00] transition-colors">Contact Support</a></li>
            </ul>
          </div>
        </div>
        
        <div className="border-t border-white/10 pt-8 flex flex-col md:flex-row justify-between items-center gap-4 text-xs font-bold uppercase tracking-widest text-white/40">
          <p>© {new Date().getFullYear()} TraceMagic</p>
          <div className="flex gap-6">
            <a href="#" className="hover:text-white">Privacy</a>
            <a href="#" className="hover:text-white">Terms</a>
          </div>
        </div>
      </div>
    </footer>
  );
}
