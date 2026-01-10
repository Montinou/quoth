/* =============================================================================
   QUOTH LANDING PAGE - APPROVED DESIGN
   Ported directly from landing.html
   ============================================================================= */
"use client";

import { Database, ShieldAlert, History, Github, Twitter, type LucideIcon } from 'lucide-react';

// --- ICON COMPONENT (Using lucide-react) ---
const iconMap: Record<string, LucideIcon> = {
  database: Database,
  "shield-alert": ShieldAlert,
  history: History,
  github: Github,
  twitter: Twitter,
};

const Icon = ({ name, size = 20, className }: { name: string, size?: number, className?: string }) => {
  const IconComponent = iconMap[name];
  if (!IconComponent) return null;
  return <IconComponent size={size} strokeWidth={1.5} className={className} />;
};

const Logo = () => (
    <div className="flex items-center gap-3">
        <div className="relative w-8 h-8 flex items-center justify-center">
           <svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M22.5 4H9.5C8.11929 4 7 5.11929 7 6.5V26.5L10.5 23H22.5C23.8807 23 25 21.8807 25 20.5V6.5C25 5.11929 23.8807 4 22.5 4Z" stroke="#8B5CF6" strokeWidth="2"/>
                <rect x="14" y="16" width="6" height="6" fill="#8B5CF6" fillOpacity="0.2" stroke="#8B5CF6"/>
                <path d="M12 28L15 25" stroke="#8B5CF6" strokeWidth="2" strokeLinecap="round"/>
           </svg>
        </div>
        <span className="font-serif text-2xl font-bold tracking-wider text-white" style={{ fontFamily: 'var(--font-cinzel), serif' }}>QUOTH</span>
    </div>
);

const Navbar = () => (
    <nav className="fixed top-0 w-full z-50 glass-panel border-b-0 border-b-white/5">
        <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
            <Logo />
            <div className="hidden md:flex items-center gap-8 text-sm font-medium text-gray-400">
                <a href="#manifesto" className="hover:text-violet-ghost transition-colors">Manifesto</a>
                <a href="#protocol" className="hover:text-violet-ghost transition-colors">Protocol</a>
                <a href="#pricing" className="hover:text-violet-ghost transition-colors">Pricing</a>
            </div>
            <div className="flex items-center gap-4">
                <button className="hidden md:block text-sm text-gray-400 hover:text-white transition-colors">Login</button>
                <button className="glass-btn px-6 py-2 rounded-sm text-sm text-white font-medium flex items-center gap-2 group">
                    <span>Install Auditor</span>
                    <span className="group-hover:translate-x-1 transition-transform">→</span>
                </button>
            </div>
        </div>
    </nav>
);

const CodeDemo = () => {
    return (
        <div className="relative rounded-lg overflow-hidden border border-violet-spectral/20 bg-charcoal shadow-2xl shadow-violet-glow/10 max-w-2xl mx-auto mt-16 font-mono text-sm">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/5 bg-obsidian">
                <div className="flex gap-2">
                    <div className="w-3 h-3 rounded-full bg-red-500/20 border border-red-500/50"></div>
                    <div className="w-3 h-3 rounded-full bg-yellow-500/20 border border-yellow-500/50"></div>
                    <div className="w-3 h-3 rounded-full bg-green-500/20 border border-green-500/50"></div>
                </div>
                <div className="text-xs text-gray-500">UserService.test.ts</div>
                <div className="text-xs text-violet-spectral flex items-center gap-1">
                    <span className="animate-pulse">●</span> AUDITING
                </div>
            </div>

            {/* Code Body */}
            <div className="p-6 text-gray-400 leading-relaxed overflow-x-auto text-left">
                <div className="mb-4 text-gray-500">// <span className="text-violet-spectral">Quoth Analysis:</span> 1 Violation Detected</div>
                
                <div><span className="text-pink-400">import</span> {'{'} describe, it, expect {'}'} <span className="text-pink-400">from</span> <span className="text-green-400">'vitest'</span>;</div>
                <div><span className="text-pink-400">import</span> {'{'} UserService {'}'} <span className="text-pink-400">from</span> <span className="text-green-400">'./UserService'</span>;</div>
                <br/>
                
                {/* The Drift */}
                <div className="opacity-50">describe(<span className="text-green-400">'UserService'</span>, () ={'>'} {'{'}</div>
                <div className="pl-4 opacity-50">it(<span className="text-green-400">'should fetch user'</span>, <span className="text-pink-400">async</span> () ={'>'} {'{'}</div>
                
                {/* The Violation */}
                <div className="pl-8 py-1 my-1 drift-highlight">
                    <span className="text-pink-400">const</span> mock = jest.fn(); <span className="text-xs uppercase tracking-widest text-violet-ghost ml-4 font-sans border border-violet-spectral/50 px-2 py-0.5 rounded bg-violet-spectral/20">Violation</span>
                </div>
                
                <div className="pl-8 opacity-50">...</div>
                
                {/* The Fix */}
                <div className="mt-4 p-3 bg-violet-spectral/5 border-l-2 border-violet-spectral rounded-r">
                    <div className="text-xs text-violet-spectral mb-1 font-sans font-bold">QUOTH SUGGESTION</div>
                    <div className="text-white">
                        <span className="text-pink-400">const</span> mock = vi.fn();
                    </div>
                    <div className="text-xs text-gray-500 mt-2 font-sans italic">
                        "According to 'patterns/backend-unit-vitest.md', Jest globals are forbidden. Use Vitest native utilities."
                    </div>
                </div>
            </div>
        </div>
    );
};

const FeatureCard = ({ title, description, icon, delay = 0 }: { title: string, description: string, icon: string, delay?: number }) => (
    <div className={`glass-panel card-glow p-8 rounded-lg group animate-fade-in-delay-${delay}`}>
        <div className="icon-container w-12 h-12 rounded bg-white/5 flex items-center justify-center mb-6 transition-all duration-300">
            <Icon name={icon} className="text-gray-400 transition-all duration-300" />
        </div>
        <h3 className="font-serif text-xl font-medium text-white mb-3" style={{ fontFamily: 'var(--font-cinzel), serif' }}>{title}</h3>
        <p className="text-gray-400 leading-relaxed font-light text-sm">{description}</p>
    </div>
);

const Hero = () => (
    <section className="relative pt-32 pb-20 px-6 overflow-hidden">
        {/* Background Glow */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-violet-spectral/5 rounded-full blur-[100px] -z-10"></div>
        
        <div className="max-w-4xl mx-auto text-center relative z-10">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-white/10 bg-white/5 text-xs text-violet-ghost mb-8 tracking-widest uppercase">
                <span className="w-1 h-1 rounded-full bg-violet-spectral animate-pulse"></span>
                Model Context Protocol Server
            </div>
            
            <h1 className="font-serif text-5xl md:text-7xl font-medium text-white leading-tight mb-8" style={{ fontFamily: 'var(--font-cinzel), serif' }}>
                Nevermore Guess. <br/>
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-violet-spectral to-white">Always Know.</span>
            </h1>
            
            <p className="font-light text-lg md:text-xl text-gray-400 max-w-2xl mx-auto mb-10 leading-relaxed">
                The AI-driven auditor that aligns your codebase with your documentation. 
                Stop hallucinations. Enforce your architecture.
            </p>
            
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                <button className="glass-btn bg-violet-spectral/10 border-violet-spectral/50 text-white px-8 py-4 rounded-sm hover:bg-violet-spectral/20 w-full sm:w-auto">
                    Deploy Quoth Server
                </button>
                <button className="px-8 py-4 text-gray-400 hover:text-white transition-colors text-sm tracking-wide uppercase border-b border-transparent hover:border-white w-full sm:w-auto">
                    Read the Protocol
                </button>
            </div>

            <CodeDemo />
        </div>
    </section>
);

const Features = () => (
    <section className="py-24 px-6 bg-charcoal/30">
        <div className="max-w-7xl mx-auto">
            <div className="text-center mb-16">
                <h2 className="font-serif text-3xl md:text-4xl text-white mb-4" style={{ fontFamily: 'var(--font-cinzel), serif' }}>The Digital Scriptorium</h2>
                <p className="text-gray-500 font-light">Architecture as Code. Documentation as Law.</p>
            </div>
            
            <div className="grid md:grid-cols-3 gap-6">
                <FeatureCard
                    title="Semantic Indexing"
                    description="Quoth creates a semantic map of your contracts and patterns. It doesn't just read files; it understands architectural intent."
                    icon="database"
                    delay={1}
                />
                <FeatureCard
                    title="Active Auditor"
                    description="The 'Auditor Persona' actively monitors PRs. It detects when new code deviates from established patterns like 'backend-unit-vitest'."
                    icon="shield-alert"
                    delay={2}
                />
                <FeatureCard
                    title="Drift Prevention"
                    description="Documentation usually dies the day it's written. Quoth forces a 'Read-Contrast-Update' loop to keep it alive forever."
                    icon="history"
                    delay={3}
                />
            </div>
        </div>
    </section>
);

const Footer = () => (
    <footer className="border-t border-white/5 py-12 px-6 bg-obsidian">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center gap-6">
            <Logo />
            <div className="text-gray-600 text-sm font-mono">
                © 2025 Quoth Labs. "Wisdom over Guesswork."
            </div>
            <div className="flex gap-6">
                <Icon name="github" className="text-gray-600 hover:text-white cursor-pointer transition-colors" />
                <Icon name="twitter" className="text-gray-600 hover:text-white cursor-pointer transition-colors" />
            </div>
        </div>
    </footer>
);

export default function Home() {
    return (
        <div className="min-h-screen animate-page-fade-in">
            <Navbar />
            <Hero />
            <Features />
            <Footer />
        </div>
    );
}
