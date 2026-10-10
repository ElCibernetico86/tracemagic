import { Check } from 'lucide-react';
import { Link } from 'react-router-dom';

export default function Pricing() {
  const handleSubscribe = async (priceId: string) => {
    try {
      const res = await fetch('/api/create-checkout-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ priceId })
      });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      }
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div className="py-32 bg-[#050505]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center max-w-3xl mx-auto mb-20">
          <h1 className="text-5xl md:text-6xl font-black text-white tracking-[-2px] uppercase mb-6">Simple Pricing.</h1>
          <p className="text-xl text-white/60">Start for free, upgrade when you need volume. Pay a fraction of what legacy tools charge.</p>
        </div>

        <div className="grid md:grid-cols-3 gap-8 max-w-5xl mx-auto">
          {/* Free Tier */}
          <div className="bg-[#111] rounded-3xl p-10 border border-white/10 flex flex-col">
            <h3 className="text-xl font-black text-white uppercase tracking-widest mb-2">Hobby</h3>
            <p className="text-white/40 text-sm mb-8 font-medium">For casual users and quick traces.</p>
            <div className="mb-8">
              <span className="text-5xl font-black text-white">$0</span>
              <span className="text-white/40 font-bold ml-2">/mo</span>
            </div>
            <ul className="space-y-4 mb-10 flex-grow">
              <li className="flex items-start gap-3"><Check className="w-5 h-5 text-white/40 flex-shrink-0" /> <span className="text-white/60">5 traces per month</span></li>
              <li className="flex items-start gap-3"><Check className="w-5 h-5 text-white/40 flex-shrink-0" /> <span className="text-white/60">Standard resolution</span></li>
              <li className="flex items-start gap-3"><Check className="w-5 h-5 text-white/40 flex-shrink-0" /> <span className="text-white/60">Community support</span></li>
            </ul>
            <Link to="/app" className="w-full text-center py-4 rounded-xl text-sm font-black uppercase tracking-widest border border-white/20 text-white hover:bg-white/5 transition-colors">
              Start Free
            </Link>
          </div>

          {/* Pro Tier */}
          <div className="bg-[#C1FF00] rounded-3xl p-10 border border-[#C1FF00] flex flex-col relative transform md:-translate-y-4 shadow-[0_20px_50px_rgba(193,255,0,0.15)]">
            <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-black text-[#C1FF00] px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest border border-[#C1FF00]">
              Most Popular
            </div>
            <h3 className="text-xl font-black text-black uppercase tracking-widest mb-2">Professional</h3>
            <p className="text-black/60 text-sm mb-8 font-medium">For freelancers and designers.</p>
            <div className="mb-8 text-black">
              <span className="text-5xl font-black">$12</span>
              <span className="text-black/60 font-bold ml-2">/mo</span>
            </div>
            <ul className="space-y-4 mb-10 flex-grow text-black/80 font-medium">
              <li className="flex items-start gap-3"><Check className="w-5 h-5 text-black flex-shrink-0" /> <span>Unlimited traces</span></li>
              <li className="flex items-start gap-3"><Check className="w-5 h-5 text-black flex-shrink-0" /> <span>High-res vector processing</span></li>
              <li className="flex items-start gap-3"><Check className="w-5 h-5 text-black flex-shrink-0" /> <span>Batch uploads</span></li>
              <li className="flex items-start gap-3"><Check className="w-5 h-5 text-black flex-shrink-0" /> <span>Priority email support</span></li>
            </ul>
            <button onClick={() => handleSubscribe('price_pro_monthly')} className="w-full py-4 rounded-xl text-sm font-black uppercase tracking-widest bg-black text-[#C1FF00] hover:bg-black/90 transition-colors">
              Upgrade to Pro
            </button>
          </div>

          {/* Studio Tier */}
          <div className="bg-[#111] rounded-3xl p-10 border border-white/10 flex flex-col">
            <h3 className="text-xl font-black text-white uppercase tracking-widest mb-2">Studio</h3>
            <p className="text-white/40 text-sm mb-8 font-medium">For teams and agencies.</p>
            <div className="mb-8">
              <span className="text-5xl font-black text-white">$49</span>
              <span className="text-white/40 font-bold ml-2">/mo</span>
            </div>
            <ul className="space-y-4 mb-10 flex-grow">
              <li className="flex items-start gap-3"><Check className="w-5 h-5 text-white/40 flex-shrink-0" /> <span className="text-white/60">Everything in Pro</span></li>
              <li className="flex items-start gap-3"><Check className="w-5 h-5 text-white/40 flex-shrink-0" /> <span className="text-white/60">5 Team seats</span></li>
              <li className="flex items-start gap-3"><Check className="w-5 h-5 text-white/40 flex-shrink-0" /> <span className="text-white/60">API Access</span></li>
              <li className="flex items-start gap-3"><Check className="w-5 h-5 text-white/40 flex-shrink-0" /> <span className="text-white/60">Custom integrations</span></li>
            </ul>
            <button onClick={() => handleSubscribe('price_studio_monthly')} className="w-full py-4 rounded-xl text-sm font-black uppercase tracking-widest border border-white/20 text-white hover:bg-white/5 transition-colors">
              Contact Sales
            </button>
          </div>
        </div>

        {/* FAQ */}
        <div className="max-w-3xl mx-auto mt-32">
          <h2 className="text-3xl font-black uppercase tracking-tight text-center mb-12">Frequently Asked Questions</h2>
          <div className="space-y-8">
            <div className="bg-[#111] p-8 rounded-2xl border border-white/10">
              <h4 className="text-lg font-bold text-white mb-3">Can I cancel my subscription?</h4>
              <p className="text-white/60 leading-relaxed">Yes, you can cancel at any time through our Stripe customer portal. You will retain access until the end of your billing period.</p>
            </div>
            <div className="bg-[#111] p-8 rounded-2xl border border-white/10">
              <h4 className="text-lg font-bold text-white mb-3">Do you keep my uploaded images?</h4>
              <p className="text-white/60 leading-relaxed">No. Images are processed in memory and immediately discarded unless you save or share a trace.</p>
            </div>
            <div className="bg-[#111] p-8 rounded-2xl border border-white/10">
              <h4 className="text-lg font-bold text-white mb-3">How does it compare to Vectorizer.ai?</h4>
              <p className="text-white/60 leading-relaxed">TraceMagic uses a VTracer-based engine with flat pricing, local processing, and no credit system.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
