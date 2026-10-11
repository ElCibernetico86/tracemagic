import { Link } from 'react-router-dom';
import { Zap, CheckCircle2, Shield, Search, Sparkles, Layers } from 'lucide-react';

export default function Features() {
  return (
    <div className="py-32 bg-[#050505]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center max-w-3xl mx-auto mb-20">
          <h1 className="text-5xl md:text-6xl font-black text-white tracking-[-2px] uppercase mb-6">Engineered for Perfection.</h1>
          <p className="text-xl text-white/60">TraceMagic turns raster artwork into SVG paths with a fast local tracing engine.</p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
          {[
            {
              icon: <Zap className="w-6 h-6 text-[#C1FF00]" />,
              title: "VTracer Engine",
              desc: "Under the hood, TraceMagic uses deterministic color clustering and path fitting instead of remote model calls."
            },
            {
              icon: <Layers className="w-6 h-6 text-[#C1FF00]" />,
              title: "Full Color Preservation",
              desc: "Maintains gradients and flat colors perfectly without creating million-layer monstrosities."
            },
            {
              icon: <CheckCircle2 className="w-6 h-6 text-[#C1FF00]" />,
              title: "Production Ready SVG",
              desc: "Outputs standard, compliant SVG 1.1 code that drops right into Illustrator, Figma, or your codebase."
            },
            {
              icon: <Shield className="w-6 h-6 text-[#C1FF00]" />,
              title: "Private & Secure",
              desc: "Your uploaded images are processed in memory and never stored. Upscaling runs entirely on your device."
            },
            {
              icon: <Search className="w-6 h-6 text-[#C1FF00]" />,
              title: "Detail Control",
              desc: "Balances color precision, speckle filtering, corner detection, and curve fitting for clean SVG output."
            },
            {
              icon: <Sparkles className="w-6 h-6 text-[#C1FF00]" />,
              title: "Zero Tuning Required",
              desc: "No more messing with thresholds, corner penalties, or noise reduction sliders. It just works."
            }
          ].map((feat, i) => (
            <div key={i} className="bg-[#111] border border-white/10 rounded-3xl p-10 hover:border-[#C1FF00]/50 hover:bg-white/5 transition-all group">
              <div className="bg-white/5 w-14 h-14 rounded-2xl flex items-center justify-center mb-8 group-hover:bg-[#C1FF00]/10 transition-colors">
                {feat.icon}
              </div>
              <h3 className="text-xl font-black text-white uppercase tracking-tight mb-3">{feat.title}</h3>
              <p className="text-white/60 leading-relaxed font-medium">{feat.desc}</p>
            </div>
          ))}
        </div>

        <div className="mt-32 bg-[#C1FF00] rounded-3xl p-16 text-center text-black relative overflow-hidden">
          <div className="relative z-10">
            <h2 className="text-4xl font-black uppercase tracking-tighter mb-6">Ready to stop tweaking sliders?</h2>
            <p className="text-black/70 mb-10 max-w-2xl mx-auto text-lg font-bold">Join designers saving hours every week with fast SVG vectorization.</p>
            <Link to="/app" className="bg-black text-[#C1FF00] px-10 py-5 rounded-xl font-black text-sm uppercase tracking-widest hover:bg-black/80 transition-colors inline-block">
              Start Tracing
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
