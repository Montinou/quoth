import { motion } from 'framer-motion';
import { Heart, ShieldCheck, Trash2, RefreshCw, Clock, Timer, FileText } from 'lucide-react';

const fadeUp = (delay = 0) => ({
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.5, delay, ease: 'easeOut' },
});

const features = [
  {
    icon: ShieldCheck,
    title: 'Exception Handling',
    desc: 'Daemon catches errors, never crashes',
  },
  {
    icon: Trash2,
    title: 'Stale Lock Cleanup',
    desc: 'Auto-cleaned from previous crashes',
  },
  {
    icon: RefreshCw,
    title: 'HNSW Rebuild',
    desc: 'Reconstructs from DB on corruption',
  },
  {
    icon: Clock,
    title: 'Exposure-Based Decay',
    desc: 'Never-exposed archived after 30d, 600 cap',
  },
  {
    icon: Timer,
    title: 'Stale Session Detector',
    desc: 'Every 10min, synthetic summaries for orphaned sessions',
  },
  {
    icon: FileText,
    title: 'Auto Doc Maintenance',
    desc: 'Nightly content hash scan + LLM update + git push',
  },
];

export default function SelfHealingSlide() {
  return (
    <div className="slide-page">
      {/* Background decorations */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div
          className="absolute top-[5%] right-[10%] w-[40%] h-[40%] rounded-full opacity-15"
          style={{
            background: 'radial-gradient(circle, #22c55e 0%, transparent 70%)',
          }}
        />
        <div
          className="absolute bottom-[15%] left-[5%] w-[35%] h-[35%] rounded-full opacity-10"
          style={{
            background: 'radial-gradient(circle, #00e5ff 0%, transparent 70%)',
          }}
        />
      </div>

      {/* Header */}
      <header className="relative z-10 mb-6 shrink-0">
        <motion.div {...fadeUp(0.1)} className="flex items-center gap-vw-3">
          <Heart style={{ width: '2.4vw', height: '2.4vw' }} className="text-green-400" />
          <h2 className="text-vw-4xl font-bold gradient-text">
            Self-Healing &amp; Reliability
          </h2>
        </motion.div>
        <motion.div
          {...fadeUp(0.2)}
          className="w-20 h-1 rounded-full mt-2 bg-green-400"
        />
      </header>

      {/* Content - 2x3 grid */}
      <div className="slide-content relative z-10 grid grid-cols-3 grid-rows-2 gap-vw-4">
        {features.map((item, i) => (
          <motion.div
            key={item.title}
            {...fadeUp(0.3 + i * 0.08)}
            className="glass rounded-vw-lg p-vw-4 flex flex-col gap-vw-3"
          >
            <div className="flex items-center gap-vw-3">
              <div
                className="shrink-0 w-[2.8vw] h-[2.8vw] rounded-vw flex items-center justify-center"
                style={{ background: 'rgba(34, 197, 94, 0.12)' }}
              >
                <item.icon
                  style={{ width: '1.5vw', height: '1.5vw' }}
                  className="text-green-400"
                />
              </div>
              {/* Green operational dot */}
              <div className="ml-auto">
                <motion.div
                  className="w-[0.6vw] h-[0.6vw] rounded-full bg-green-400"
                  animate={{ opacity: [0.4, 1, 0.4] }}
                  transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
                />
              </div>
            </div>
            <div>
              <p className="text-vw-base font-semibold text-text-primary">{item.title}</p>
              <p className="text-vw-sm text-text-secondary mt-1">{item.desc}</p>
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
