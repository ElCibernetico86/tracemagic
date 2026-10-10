import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';

const posts = [
  {
    id: 1,
    title: "How to vectorize a logo in 2026: The ultimate guide",
    excerpt: "Learn how modern tracing engines turn raster artwork into scalable SVG paths.",
    date: "Jun 24, 2026",
    category: "Tutorials"
  },
  {
    id: 2,
    title: "Raster vs Vector: When to use which?",
    excerpt: "A comprehensive breakdown of image formats, resolution independence, and why SVGs rule the modern web.",
    date: "Jun 22, 2026",
    category: "Education"
  },
  {
    id: 3,
    title: "Why we built TraceMagic to replace Vectorizer.ai",
    excerpt: "The story behind our flat-pricing model and the technology that makes our traces superior.",
    date: "Jun 15, 2026",
    category: "Company"
  }
];

export default function Blog() {
  return (
    <div className="py-32 bg-[#050505] min-h-screen">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center max-w-3xl mx-auto mb-20">
          <h1 className="text-5xl md:text-6xl font-black text-white tracking-[-2px] uppercase mb-6">Transmission Log.</h1>
          <p className="text-xl text-white/60">Tips, tutorials, and updates from the TraceMagic team on mastering vector graphics.</p>
        </div>

        <div className="grid md:grid-cols-3 gap-8">
          {posts.map(post => (
            <article key={post.id} className="bg-[#111] rounded-3xl border border-white/10 overflow-hidden hover:border-[#C1FF00]/50 transition-all flex flex-col group">
              <div className="aspect-[16/9] bg-white/5 border-b border-white/10 flex items-center justify-center group-hover:bg-white/10 transition-colors">
                <span className="text-[10px] font-black text-white/20 uppercase tracking-widest">Image Data</span>
              </div>
              <div className="p-8 flex flex-col flex-grow">
                <div className="flex items-center justify-between mb-6">
                  <span className="text-[10px] font-black text-[#C1FF00] uppercase tracking-widest bg-[#C1FF00]/10 px-3 py-1 rounded">{post.category}</span>
                  <span className="text-[10px] font-bold text-white/40 uppercase tracking-widest">{post.date}</span>
                </div>
                <h2 className="text-2xl font-black text-white mb-4 uppercase tracking-tight group-hover:text-[#C1FF00] transition-colors">{post.title}</h2>
                <p className="text-white/60 mb-8 flex-grow font-medium leading-relaxed">{post.excerpt}</p>
                <Link to="/app" className="text-white font-bold text-sm uppercase tracking-widest flex items-center gap-2 group-hover:gap-4 transition-all">
                  Read File <ArrowRight className="w-4 h-4 text-[#C1FF00]" />
                </Link>
              </div>
            </article>
          ))}
        </div>
      </div>
    </div>
  );
}
