import { Link } from 'react-router-dom';
import { ArrowRight, CheckCircle2, Zap, Layout, Infinity as InfinityIcon } from 'lucide-react';
import { motion } from 'motion/react';

export default function Home() {
  return (
    <div className="overflow-hidden flex-1 flex flex-col">
      {/* Hero Section */}
      <section className="relative pt-24 pb-20 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto flex flex-col lg:flex-row items-center gap-16 flex-1">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="lg:w-1/2 flex flex-col items-start text-left"
        >
          <div className="text-[10px] font-bold uppercase tracking-[1px] bg-[#C1FF00]/10 text-[#C1FF00] px-3 py-1.5 rounded-full inline-block mb-6">
            Local VTracer Vectorization
          </div>
          <h1 className="text-6xl md:text-[80px] leading-[0.85] font-black text-white tracking-[-3px] mb-8 uppercase">
            Pixels<br />Are<br />Dead.
          </h1>
          <p className="text-lg text-white/60 max-w-md mb-10 leading-relaxed">
            Fast raster-to-SVG conversion that runs without model keys, credits, or waiting on an AI service. Upload a bitmap and get scalable vector paths.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 w-full sm:w-auto">
            <Link 
              to="/app" 
              className="bg-[#C1FF00] hover:bg-[#a6db00] text-black px-8 py-5 rounded-xl text-sm font-black tracking-widest uppercase transition-all flex items-center justify-center gap-3"
            >
              Trace Paths <ArrowRight className="w-5 h-5" />
            </Link>
            <Link 
              to="/vs/vectorizer-ai" 
              className="bg-transparent hover:bg-white/5 text-white border border-white/20 px-8 py-5 rounded-xl text-sm font-black tracking-widest uppercase transition-all flex items-center justify-center"
            >
              Compare
            </Link>
          </div>
          
          <div className="flex gap-10 mt-16">
            <div>
              <div className="text-3xl font-black text-white">1.2s</div>
              <div className="text-[10px] uppercase tracking-widest text-white/40 mt-1">Avg Process</div>
            </div>
            <div>
              <div className="text-3xl font-black text-white">∞</div>
              <div className="text-[10px] uppercase tracking-widest text-white/40 mt-1">Lossless Scale</div>
            </div>
            <div>
              <div className="text-3xl font-black text-white">SVG</div>
              <div className="text-[10px] uppercase tracking-widest text-white/40 mt-1">Native Output</div>
            </div>
          </div>
        </motion.div>

        {/* Demo UI Mockup */}
        <motion.div 
          initial={{ opacity: 0, x: 40 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.7, delay: 0.2 }}
          className="lg:w-1/2 w-full relative"
        >
          <div className="bg-[#111] rounded-3xl border border-white/10 p-8 shadow-[0_40px_100px_rgba(0,0,0,0.5)] flex flex-col h-[500px]">
            <div className="flex justify-between items-center mb-6">
              <div className="flex gap-2">
                <div className="w-3 h-3 rounded-full bg-[#ff5f56]" />
                <div className="w-3 h-3 rounded-full bg-[#ffbd2e]" />
                <div className="w-3 h-3 rounded-full bg-[#27c93f]" />
              </div>
              <div className="text-[10px] font-bold text-[#C1FF00] font-mono tracking-widest uppercase">ENGINE: VTRACER</div>
            </div>
            
            <div className="flex-1 border-2 border-dashed border-[#C1FF00]/20 rounded-2xl bg-black/40 flex flex-col items-center justify-center relative overflow-hidden group">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#C1FF00" strokeWidth="1.5" className="mb-4">
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12"/>
              </svg>
              <div className="font-bold text-lg text-white">Drop your bitmap here</div>
              <div className="text-xs text-white/40 mt-2 font-medium uppercase tracking-widest">JPG, PNG, WEBP</div>
              
              <div className="absolute bottom-6 left-6 right-6 flex gap-3">
                <div className="flex-1 h-1 bg-[#C1FF00]/30 rounded-full overflow-hidden">
                  <div className="w-1/3 h-full bg-[#C1FF00]" />
                </div>
              </div>
            </div>
            
            <div className="grid grid-cols-3 gap-3 mt-6">
              <div className="bg-white/5 p-4 rounded-xl">
                <div className="text-[9px] text-white/40 uppercase tracking-widest mb-1">Precision</div>
                <div className="font-bold text-sm text-white">Sub-Pixel</div>
              </div>
              <div className="bg-white/5 p-4 rounded-xl">
                <div className="text-[9px] text-white/40 uppercase tracking-widest mb-1">Tracing</div>
                <div className="font-bold text-sm text-white">O(n)</div>
              </div>
              <div className="bg-white/5 p-4 rounded-xl">
                <div className="text-[9px] text-white/40 uppercase tracking-widest mb-1">Output</div>
                <div className="font-bold text-sm text-white">Clean SVG</div>
              </div>
            </div>
          </div>
        </motion.div>
      </section>

      {/* Comparison Ticker */}
      <div className="h-12 bg-white/[0.03] border-y border-white/10 flex items-center justify-between px-4 sm:px-8 text-[10px] uppercase tracking-widest text-white/40 overflow-hidden whitespace-nowrap overflow-x-auto">
        <div className="flex items-center gap-8">
          <span>Better than: Vectorizer.ai</span>
          <span>•</span>
          <span>Adobe Image Trace</span>
          <span>•</span>
          <span>Inkscape</span>
          <span>•</span>
          <span>Autotracer</span>
        </div>
        <div className="hidden md:flex gap-6">
          <span>System Status: Operational</span>
          <span className="text-[#C1FF00]/60">v4.2.1-stable</span>
        </div>
      </div>

      {/* Features */}
      <section className="py-32 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-left mb-20 flex flex-col md:flex-row md:items-end justify-between gap-8">
          <div>
            <h2 className="text-4xl md:text-6xl font-black text-white tracking-[-2px] uppercase mb-4">Architecture</h2>
            <p className="text-xl text-white/60 max-w-xl font-medium">Built from the ground up for extreme performance and uncompromised fidelity.</p>
          </div>
        </div>
        
        <div className="grid md:grid-cols-3 gap-6">
          {[
            {
              icon: <Zap className="w-6 h-6 text-[#C1FF00]" />,
              title: "VTracer Engine",
              desc: "Powered by deterministic raster-to-vector tracing with color clustering, path fitting, and SVG optimization."
            },
            {
              icon: <InfinityIcon className="w-6 h-6 text-white" />,
              title: "Unmetered",
              desc: "True professional workflow. No predatory credit systems. Infinite scale on our premium tiers."
            },
            {
              icon: <CheckCircle2 className="w-6 h-6 text-white" />,
              title: "Pristine Output",
              desc: "We generate lean, mathematically perfect SVG paths ready for production deployment."
            }
          ].map((feat, i) => (
            <div key={i} className="bg-[#111] p-10 rounded-3xl border border-white/10 hover:border-[#C1FF00]/50 transition-colors group">
              <div className="bg-white/5 w-14 h-14 rounded-2xl flex items-center justify-center mb-8 group-hover:bg-[#C1FF00]/10 transition-colors">
                {feat.icon}
              </div>
              <h3 className="text-xl font-black text-white mb-3 tracking-tight uppercase">{feat.title}</h3>
              <p className="text-white/60 leading-relaxed font-medium">{feat.desc}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
