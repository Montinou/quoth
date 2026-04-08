import { motion } from 'framer-motion';
import { Webhook, Wrench, Cpu, Database, GitBranch, BookOpen } from 'lucide-react';

const capabilities = [
  {
    icon: Webhook,
    title: '9 Hook Bindings',
    desc: '8 lifecycle events',
    accent: 'primary',
  },
  {
    icon: Wrench,
    title: '22 MCP Tools',
    desc: 'Patterns, Intelligence, Agents, Skills',
    accent: 'cyan',
  },
  {
    icon: Cpu,
    title: 'Background Daemon',
    desc: '3-stage LLM pipeline',
    accent: 'primary',
  },
  {
    icon: Database,
    title: 'SQLite + HNSW',
    desc: '384d vector index (MiniLM-L6)',
    accent: 'cyan',
  },
  {
    icon: GitBranch,
    title: 'Project-Aware',
    desc: 'Auto-namespacing via git remote',
    accent: 'primary',
  },
  {
    icon: BookOpen,
    title: '5 Built-in Skills',
    desc: 'Genesis, Learn, Patterns, Help, Init',
    accent: 'cyan',
  },
];

const accentColors = {
  primary: { bg: 'rgba(124, 31, 255, 0.15)', color: '#7c1fff' },
  cyan: { bg: 'rgba(0, 229, 255, 0.15)', color: '#00e5ff' },
};

export default function PluginCapabilitiesSlide() {
  return (
    <div className="slide-page">
      {/* Background decorations */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div
          className="absolute top-[5%] right-[10%] w-[30%] h-[30%] rounded-full opacity-10"
          style={{
            background: 'radial-gradient(circle, #7c1fff 0%, transparent 70%)',
          }}
        />
        <div
          className="absolute bottom-[10%] left-[5%] w-[25%] h-[25%] rounded-full opacity-10"
          style={{
            background: 'radial-gradient(circle, #00e5ff 0%, transparent 70%)',
          }}
        />
      </div>

      {/* Header */}
      <header className="relative z-10 mb-6 shrink-0">
        <motion.h2
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="text-vw-4xl font-bold text-text-primary"
        >
          Plugin Capabilities
        </motion.h2>
        <motion.div
          initial={{ opacity: 0, scaleX: 0 }}
          animate={{ opacity: 1, scaleX: 1 }}
          transition={{ duration: 0.5, delay: 0.1 }}
          className="w-24 h-1 rounded-full mt-2 origin-left"
          style={{ background: 'linear-gradient(90deg, #7c1fff, #00e5ff)' }}
        />
      </header>

      {/* Content: 2x3 grid */}
      <div className="slide-content relative z-10">
        <div className="grid-auto-fit grid-2x3 h-full">
          {capabilities.map((cap, i) => {
            const colors = accentColors[cap.accent];
            return (
              <motion.div
                key={cap.title}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: 0.15 + i * 0.08 }}
                className="glass rounded-vw-xl p-vw-4 flex flex-col items-start gap-vw-3 card-fit"
              >
                <div
                  className="w-[3vw] h-[3vw] rounded-full flex items-center justify-center shrink-0"
                  style={{ background: colors.bg }}
                >
                  <cap.icon
                    style={{ width: '1.4vw', height: '1.4vw', color: colors.color }}
                  />
                </div>
                <div>
                  <h3 className="text-vw-lg font-bold text-text-primary">{cap.title}</h3>
                  <p className="text-vw-sm text-text-secondary mt-1">{cap.desc}</p>
                </div>
              </motion.div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
