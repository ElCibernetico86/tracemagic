import { useParams, Link } from 'react-router-dom';
import { Check, X as XIcon, ArrowRight } from 'lucide-react';

export default function VsPage() {
  const { competitor } = useParams();
  
  const nameMap: Record<string, string> = {
    'vectorizer-ai': 'Vectorizer.ai',
    'adobe-illustrator': 'Adobe Illustrator',
    'autotracer': 'Autotracer.org',
    'inkscape': 'Inkscape',
  };

  const cName = competitor ? nameMap[competitor] || competitor.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') : 'Competitor';

  return (
    <div className="py-32 bg-[#050505]">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-20">
          <div className="inline-block bg-[#C1FF00]/10 text-[#C1FF00] px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest mb-6">
            Head to Head
          </div>
          <h1 className="text-5xl md:text-6xl font-black text-white tracking-[-2px] uppercase mb-6">
            TraceMagic <span className="text-white/40">vs</span><br /> {cName}
          </h1>
          <p className="text-xl text-white/60 max-w-2xl mx-auto">
            Looking for a {cName} alternative? See how TraceMagic's VTracer-based engine compares in speed, quality, and pricing.
          </p>
        </div>

        {/* Feature Comparison Table */}
        <div className="bg-[#111] border border-white/10 rounded-3xl shadow-sm overflow-hidden mb-24">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-white/10">
                <th className="p-8 text-[11px] font-black text-white/40 uppercase tracking-widest w-1/3">Feature</th>
                <th className="p-8 text-xl font-black text-[#C1FF00] uppercase tracking-tight w-1/3 bg-white/5">TraceMagic</th>
                <th className="p-8 text-xl font-black text-white uppercase tracking-tight w-1/3">{cName}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              <tr>
                <td className="p-8 font-bold text-white/80">Tracing Engine</td>
                <td className="p-8 bg-white/5"><span className="inline-flex items-center gap-3 text-white font-bold"><Check className="w-5 h-5 text-[#C1FF00]"/> VTracer-based</span></td>
                <td className="p-8 text-white/40 font-medium">Varies by tool</td>
              </tr>
              <tr>
                <td className="p-8 font-bold text-white/80">Pricing Model</td>
                <td className="p-8 bg-white/5"><span className="inline-flex items-center gap-3 text-white font-bold"><Check className="w-5 h-5 text-[#C1FF00]"/> Flat $12/mo</span></td>
                <td className="p-8 text-white/40 font-medium">Expensive Credits</td>
              </tr>
              <tr>
                <td className="p-8 font-bold text-white/80">Output Quality</td>
                <td className="p-8 bg-white/5"><span className="inline-flex items-center gap-3 text-white font-bold"><Check className="w-5 h-5 text-[#C1FF00]"/> Production SVG</span></td>
                <td className="p-8 text-white/40 font-medium">Requires cleanup</td>
              </tr>
              <tr>
                <td className="p-8 font-bold text-white/80">Processing Speed</td>
                <td className="p-8 bg-white/5"><span className="inline-flex items-center gap-3 text-white font-bold"><Check className="w-5 h-5 text-[#C1FF00]"/> &lt; 5 seconds</span></td>
                <td className="p-8 text-white/40 font-medium">Variable</td>
              </tr>
              <tr>
                <td className="p-8 font-bold text-white/80">Privacy</td>
                <td className="p-8 bg-white/5"><span className="inline-flex items-center gap-3 text-white font-bold"><Check className="w-5 h-5 text-[#C1FF00]"/> Zero Retention</span></td>
                <td className="p-8 text-rose-500 font-medium"><span className="inline-flex items-center gap-2"><XIcon className="w-5 h-5"/> Read terms</span></td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="prose prose-invert prose-lg mx-auto text-white/60 mb-24">
          <h2 className="text-3xl font-black text-white uppercase tracking-tight mb-6">The best {cName} alternative</h2>
          <p className="mb-6 font-medium">
            If you're tired of hitting paywalls or dealing with sub-par vector outputs, TraceMagic is built for you. While {cName} may rely on older workflows or credit-based pricing, TraceMagic gives you straightforward SVG tracing for a flat fee.
          </p>
          <p className="font-medium">
            Stop spending hours manually cleaning up anchor points. TraceMagic converts bitmap artwork into optimized SVG paths you can inspect, edit, and download.
          </p>
        </div>

        <div className="text-center bg-[#111] p-16 rounded-3xl border border-white/10">
          <h2 className="text-3xl font-black text-white uppercase tracking-tight mb-6">See the difference</h2>
          <p className="text-white/60 mb-10 font-medium text-lg">Try TraceMagic for free, no credit card required.</p>
          <Link to="/app" className="bg-[#C1FF00] text-black px-10 py-5 rounded-xl font-black text-sm uppercase tracking-widest hover:bg-[#a6db00] transition-colors inline-flex items-center gap-3">
            Compare Output Now <ArrowRight className="w-5 h-5" />
          </Link>
        </div>
      </div>
    </div>
  );
}
