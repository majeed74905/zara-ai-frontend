import React, { useState, useEffect } from 'react';
import { Activity, ShieldCheck, Globe, AlertTriangle, RefreshCw, BarChart } from 'lucide-react';

export const AdminSEOBoard: React.FC = () => {
    const [status, setStatus] = useState<any>(null);
    const [loading, setLoading] = useState(true);

    const fetchStatus = async () => {
        setLoading(true);
        try {
            const apiRes = await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:8000/api/v1'}/seo/status`);
            const data = await apiRes.json();
            setStatus(data);
        } catch (e) {
            console.error("Failed to fetch SEO status", e);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchStatus();
    }, []);

    if (loading) return (
        <div className="flex flex-col items-center justify-center h-full gap-4 text-text-sub">
            <RefreshCw className="w-8 h-8 animate-spin text-primary" />
            <p className="text-xs font-bold uppercase tracking-widest">Loading SEO Metrics...</p>
        </div>
    );

    return (
        <div className="h-full p-6 md:p-8 animate-fade-in overflow-y-auto max-w-5xl mx-auto">
            <div className="mb-8 flex justify-between items-end">
                <div>
                    <h2 className="text-3xl font-bold text-white mb-2 flex items-center gap-3">
                        <Activity className="text-green-500" /> SEO Monitoring
                    </h2>
                    <p className="text-text-sub">Real-time status of search engine indexing and crawl health.</p>
                </div>
                <button onClick={fetchStatus} className="p-2 hover:bg-white/5 rounded-lg border border-white/10 text-text-sub hover:text-white transition-all">
                    <RefreshCw className="w-4 h-4" />
                </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                <div className="glass-panel p-6 rounded-2xl border-l-4 border-l-green-500">
                    <ShieldCheck className="w-6 h-6 text-green-500 mb-4" />
                    <p className="text-2xl font-bold text-white">{status?.status?.toUpperCase()}</p>
                    <p className="text-xs text-text-sub uppercase tracking-widest font-bold">System Health</p>
                </div>
                <div className="glass-panel p-6 rounded-2xl border-l-4 border-l-blue-500">
                    <Globe className="w-6 h-6 text-blue-500 mb-4" />
                    <p className="text-2xl font-bold text-white">{status?.active_pages}</p>
                    <p className="text-xs text-text-sub uppercase tracking-widest font-bold">Crawlable Pages</p>
                </div>
                <div className="glass-panel p-6 rounded-2xl border-l-4 border-l-orange-500">
                    <AlertTriangle className="w-6 h-6 text-orange-500 mb-4" />
                    <p className="text-2xl font-bold text-white">{status?.crawl_errors}</p>
                    <p className="text-xs text-text-sub uppercase tracking-widest font-bold">Crawl Errors</p>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="glass-panel p-6 rounded-2xl">
                    <h3 className="font-bold flex items-center gap-2 mb-6 text-white text-sm uppercase tracking-widest">
                        <BarChart className="w-4 h-4 text-primary" /> Indexing Status
                    </h3>
                    <div className="space-y-4">
                        {status?.indexing && Object.entries(status.indexing).map(([engine, state]: [string, any]) => (
                            <div key={engine} className="flex items-center justify-between p-3 bg-white/5 rounded-xl border border-white/5">
                                <span className="text-sm font-bold capitalize text-white">{engine}</span>
                                <span className={`text-[10px] font-black uppercase px-2 py-1 rounded border ${
                                    state === 'indexed' ? 'bg-green-500/10 text-green-400 border-green-500/20' :
                                    state === 'partial' ? 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20' :
                                    'bg-red-500/10 text-red-400 border-red-500/20'
                                }`}>
                                    {state}
                                </span>
                            </div>
                        ))}
                    </div>
                </div>

                <div className="glass-panel p-6 rounded-2xl">
                    <h3 className="font-bold flex items-center gap-2 mb-4 text-white text-sm uppercase tracking-widest">
                        <Activity className="w-4 h-4 text-accent" /> Submission Log
                    </h3>
                    <div className="text-sm text-text-sub space-y-4">
                        <div className="p-3 border-l-2 border-primary bg-primary/5 rounded-r-xl">
                            <p className="font-bold text-white text-xs">Sitemap Submitted</p>
                            <p className="text-[10px] opacity-70 mb-1">Google Search Console • {status?.last_crawl}</p>
                            <p className="text-[11px]">Submission successful. Processing queue: 1-3 days.</p>
                        </div>
                        <div className="p-3 border-l-2 border-accent bg-accent/5 rounded-r-xl">
                            <p className="font-bold text-white text-xs">Ping Sent</p>
                            <p className="text-[10px] opacity-70 mb-1">Bing Webmaster • {status?.last_crawl}</p>
                            <p className="text-[11px]">API request confirmed. Crawl scheduled.</p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};
