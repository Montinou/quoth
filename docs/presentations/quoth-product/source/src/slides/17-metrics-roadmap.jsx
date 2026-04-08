import { motion } from 'framer-motion';
import { CheckCircle, ArrowRight } from 'lucide-react';

const fadeUp = (delay = 0) => ({
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.5, delay, ease: 'easeOut' },
});

const stats = [
  { value: 'v3.4.0', label: 'Plugin' },
  { value: '22', label: 'MCP Tools' },
  { value: '26', label: 'DB Tables' },
  { value: '9', label: 'Hook Bindings' },
  { value: '246', label: 'Tests' },
  { value: '5', label: 'Skills' },
];

const done = [
  'Managed mode (SaaS-ready)',
  'CLI onboarding wizard',
  'Unified injection (patterns + docs)',
  'V2 hierarchical Thompson sampling',
  'Graded reward signal + SNIPS feedback',
  'Auto doc re-indexing (watcher + SIGUSR2)',
  'Local MiniLM-L6 embeddings (384d, $0)',
  'Batch JUDGE (Gemini 2.5 Flash, 30/batch)',
];

const next = [
  'Usage dashboard',
  'Tier system (free/pro/team)',
  'npx quoth init',
  'Cross-org pattern sharing',
  'Pattern marketplace',
];

export default function MetricsRoadmapSlide() {
  return (
    <div className="slide-page">
      {/* Background decorations */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div
          className="absolute top-[5%] right-[10%] w-[40%] h-[40%] rounded-full opacity-12"
          style={{
            background: 'radial-gradient(circle, #7c1fff 0%, transparent 70%)',
          }}
        />
        <div
          className="absolute bottom-[20%] left-[5%] w-[30%] h-[30%] rounded-full opacity-10"
          style={{
            background: 'radial-gradient(circle, #00e5ff 0%, transparent 70%)',
          }}
        />
      </div>

      {/* Header */}
      <header className="relative z-10 mb-6 shrink-0">
        <motion.h2 {...fadeUp(0.1)} className="text-vw-4xl font-bold gradient-text">
          Key Metrics &amp; Roadmap
        </motion.h2>
        <motion.div
          {...fadeUp(0.2)}
          className="w-20 h-1 rounded-full mt-2 bg-primary-500"
        />
      </header>

      {/* Content */}
      <div className="slide-content relative z-10 flex flex-col gap-vw-5">
        {/* Top section - stat cards */}
        <motion.div {...fadeUp(0.25)} className="flex gap-vw-3 justify-between">
          {stats.map((s, i) => (
            <motion.div
              key={s.label}
              {...fadeUp(0.3 + i * 0.05)}
              className="glass rounded-vw-lg p-vw-3 flex-1 text-center"
            >
              <p className="text-vw-2xl font-bold gradient-text">{s.value}</p>
              <p className="text-vw-xs text-text-muted mt-1">{s.label}</p>
            </motion.div>
          ))}
        </motion.div>

        {/* Bottom section - two columns */}
        <div className="flex gap-vw-5 flex-1">
          {/* Done in v3.4.0 */}
          <motion.div {...fadeUp(0.5)} className="flex-1 glass rounded-vw-lg p-vw-5">
            <h3 className="text-vw-lg font-semibold text-green-400 mb-vw-3">
              Done in v3.4.0
            </h3>
            <div className="flex flex-col gap-vw-2">
              {done.map((item, i) => (
                <motion.div
                  key={item}
                  {...fadeUp(0.6 + i * 0.05)}
                  className="flex items-center gap-vw-2"
                >
                  <CheckCircle
                    style={{ width: '1.2vw', height: '1.2vw' }}
                    className="text-green-400 shrink-0"
                  />
                  <span className="text-vw-sm text-text-secondary">{item}</span>
                </motion.div>
              ))}
            </div>
          </motion.div>

          {/* What's Next */}
          <motion.div {...fadeUp(0.55)} className="flex-1 glass rounded-vw-lg p-vw-5">
            <h3 className="text-vw-lg font-semibold text-accent-400 mb-vw-3">
              What's Next
            </h3>
            <div className="flex flex-col gap-vw-2">
              {next.map((item, i) => (
                <motion.div
                  key={item}
                  {...fadeUp(0.65 + i * 0.05)}
                  className="flex items-center gap-vw-2"
                >
                  <ArrowRight
                    style={{ width: '1.2vw', height: '1.2vw' }}
                    className="text-accent-400 shrink-0"
                  />
                  <span className="text-vw-sm text-text-secondary">{item}</span>
                </motion.div>
              ))}
            </div>
          </motion.div>
        </div>
      </div>
    </div>
  );
}
