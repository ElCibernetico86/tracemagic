import { useEffect, useState } from 'react';
import { collection, query, where, orderBy, getDocs } from 'firebase/firestore';
import { db, auth } from '../lib/firebase';
import { useAuthState } from 'react-firebase-hooks/auth';
import { Loader2, Calendar, Download } from 'lucide-react';
import { Link } from 'react-router-dom';

export default function Dashboard() {
  const [user, loading] = useAuthState(auth);
  const [traces, setTraces] = useState<any[]>([]);
  const [fetching, setFetching] = useState(true);

  useEffect(() => {
    if (user) {
      fetchTraces();
    } else if (!loading) {
      setFetching(false);
    }
  }, [user, loading]);

  const fetchTraces = async () => {
    try {
      const q = query(
        collection(db, 'traces'),
        where('userId', '==', user?.uid),
        orderBy('createdAt', 'desc')
      );
      const snapshot = await getDocs(q);
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setTraces(data);
    } catch (err) {
      console.error(err);
    } finally {
      setFetching(false);
    }
  };

  if (loading || fetching) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="w-8 h-8 animate-spin text-[#C1FF00]" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-4">
        <h1 className="text-4xl font-black uppercase tracking-tight text-white mb-4">Access Denied</h1>
        <p className="text-white/60 mb-8 font-medium">Authentication required to view workspace data.</p>
        <Link to="/" className="bg-white/10 text-white px-6 py-3 rounded-xl font-bold uppercase tracking-widest text-sm hover:bg-white/20 transition-colors">Return</Link>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-20 flex-grow w-full">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-12 gap-6">
        <div>
          <h1 className="text-4xl font-black text-white uppercase tracking-tight mb-2">Workspace</h1>
          <p className="text-white/60 font-medium">Manage your vector reconstructions and billing.</p>
        </div>
        <div className="flex gap-4">
          <button className="bg-[#111] border border-white/10 text-white px-6 py-3 rounded-xl font-bold text-sm uppercase tracking-widest hover:bg-white/5 transition-colors">
            Billing
          </button>
          <Link to="/app" className="bg-[#C1FF00] text-black px-6 py-3 rounded-xl font-black text-sm uppercase tracking-widest hover:bg-[#a6db00] transition-colors">
            New Trace
          </Link>
        </div>
      </div>

      <div className="bg-[#111] rounded-3xl border border-white/10 overflow-hidden">
        <div className="px-8 py-6 border-b border-white/10 bg-white/[0.02]">
          <h2 className="font-bold text-white uppercase tracking-widest text-sm">Recent Traces</h2>
        </div>
        
        {traces.length === 0 ? (
          <div className="p-20 text-center flex flex-col items-center text-white/40">
            <Calendar className="w-12 h-12 mb-6 opacity-50" />
            <p className="mb-6 font-medium">No processing history found.</p>
            <Link to="/app" className="text-[#C1FF00] font-bold text-sm uppercase tracking-widest hover:text-white transition-colors">Initialize first trace</Link>
          </div>
        ) : (
          <div className="divide-y divide-white/5">
            {traces.map((trace) => (
              <div key={trace.id} className="p-8 flex items-center gap-8 hover:bg-white/5 transition-colors">
                <div className="w-24 h-24 bg-black rounded-xl border border-white/10 flex items-center justify-center p-3 overflow-hidden flex-shrink-0">
                  <div className="w-full h-full [&>svg]:w-full [&>svg]:h-full" dangerouslySetInnerHTML={{ __html: trace.svg }} />
                </div>
                <div className="flex-grow">
                  <h3 className="font-bold text-white mb-2">{trace.fileName || 'UNTITLED_TRACE'}</h3>
                  <p className="text-[11px] font-bold uppercase tracking-widest text-white/40 flex items-center gap-2">
                    <Calendar className="w-4 h-4" /> 
                    {new Date(trace.createdAt?.seconds * 1000).toLocaleDateString()}
                  </p>
                </div>
                <div>
                  <a 
                    href={`data:image/svg+xml;utf8,${encodeURIComponent(trace.svg)}`}
                    download={`trace-${trace.id}.svg`}
                    className="flex items-center gap-2 bg-white/10 hover:bg-white/20 text-white px-5 py-2.5 rounded-xl text-xs font-bold uppercase tracking-widest transition-colors"
                  >
                    <Download className="w-4 h-4" /> SVG
                  </a>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
