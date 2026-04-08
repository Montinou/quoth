import { motion } from 'framer-motion';
import { TrendingUp, TrendingDown, ArrowUpRight, ArrowDownRight } from 'lucide-react';

const fadeUp = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5 } },
};

const stagger = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.12 } },
};

const thresholds = [
  { label: 'Promotion', rule: '> 0.8 confidence + > 10 uses', color: 'bg-green-500/20 text-green-400 border-green-500/30' },
  { label: 'Active', rule: '0.1 - 0.8', color: 'bg-accent-400/20 text-accent-300 border-accent-400/30' },
  { label: 'Archival', rule: '< 0.1 confidence', color: 'bg-text-muted/20 text-text-muted border-text-muted/30' },
];

const decayTiers = [
  { tier: 'Never-exposed 30d', desc: 'Archive' },
  { tier: 'Exposed patterns', desc: 'Soft-negative on ignore' },
  { tier: '600 cap', desc: 'Oldest archived' },
];

export default function BayesianScoring() {
  return (
    <div className="slide-page">
      {/* Background decorations */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-1/3 left-1/4 w-80 h-80 bg-primary-500/5 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 right-1/5 w-64 h-64 bg-accent-400/5 rounded-full blur-3xl" />
      </div>

      {/* Header */}
      <header className="relative z-10 mb-6 shrink-0">
        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
          <h1 className="text-vw-3xl font-bold gradient-text mb-1">Bayesian Confidence Scoring</h1>
          <p className="text-vw-base text-text-secondary">Beta Distribution Model</p>
        </motion.div>
      </header>

      {/* Content */}
      <div className="slide-content relative z-10 flex gap-6 min-h-0">
        {/* Left side — 60% */}
        <motion.div
          className="flex-[3] flex flex-col gap-4"
          variants={stagger}
          initial="hidden"
          animate="show"
        >
          {/* Formula */}
          <motion.div variants={fadeUp} className="glass rounded-vw-xl p-vw-4 border border-primary-500/20">
            <p className="text-vw-xs text-text-muted uppercase tracking-wider mb-2">Formula</p>
            <p className="text-vw-lg font-mono text-text-primary">
              confidence = <span className="text-primary-400">alpha</span> / (
              <span className="text-primary-400">alpha</span> + <span className="text-accent-400">beta</span>)
            </p>
          </motion.div>

          {/* New pattern */}
          <motion.div variants={fadeUp} className="glass rounded-vw-xl p-vw-3 border border-border-default">
            <div className="flex items-center gap-3 mb-2">
              <span className="text-vw-xs text-text-muted">New pattern:</span>
              <span className="font-mono text-vw-sm text-text-primary">Beta(1, 1) = 0.5</span>
            </div>
            <div className="w-full h-3 bg-bg-elevated rounded-full overflow-hidden">
              <div className="h-full w-1/2 bg-gradient-to-r from-primary-500 to-accent-400 rounded-full" />
            </div>
          </motion.div>

          {/* Success */}
          <motion.div variants={fadeUp} className="glass rounded-vw-xl p-vw-3 border border-green-500/20">
            <div className="flex items-center gap-3">
              <span className="bg-green-500/15 w-8 h-8 rounded-lg flex items-center justify-center">
                <ArrowUpRight className="w-4 h-4 text-green-400" />
              </span>
              <div className="flex-1">
                <p className="text-vw-sm text-text-primary">
                  <span className="font-mono text-green-400">alpha += 1</span>
                  <span className="text-text-muted mx-2">&rarr;</span>
                  confidence rises
                </p>
              </div>
              <TrendingUp className="w-5 h-5 text-green-400" />
            </div>
          </motion.div>

          {/* Failure */}
          <motion.div variants={fadeUp} className="glass rounded-vw-xl p-vw-3 border border-red-500/20">
            <div className="flex items-center gap-3">
              <span className="bg-red-500/15 w-8 h-8 rounded-lg flex items-center justify-center">
                <ArrowDownRight className="w-4 h-4 text-red-400" />
              </span>
              <div className="flex-1">
                <p className="text-vw-sm text-text-primary">
                  <span className="font-mono text-red-400">beta += 1</span>
                  <span className="text-text-muted mx-2">&rarr;</span>
                  confidence drops
                </p>
              </div>
              <TrendingDown className="w-5 h-5 text-red-400" />
            </div>
          </motion.div>
        </motion.div>

        {/* Right side — 40% */}
        <motion.div
          className="flex-[2]"
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.3, duration: 0.5 }}
        >
          <div className="glass rounded-vw-xl p-vw-4 border border-border-default h-full flex flex-col">
            <h3 className="text-vw-lg font-semibold text-text-primary mb-4">Lifecycle Thresholds</h3>

            {/* Threshold badges */}
            <div className="flex flex-col gap-3 mb-6">
              {thresholds.map((t) => (
                <div key={t.label} className="flex items-center gap-3">
                  <span className={`px-3 py-1 rounded-full text-vw-xs font-semibold border ${t.color}`}>
                    {t.label}
                  </span>
                  <span className="text-vw-xs text-text-secondary font-mono">{t.rule}</span>
                </div>
              ))}
            </div>

            {/* Decay tiers */}
            <div className="mt-auto">
              <p className="text-vw-xs text-text-muted uppercase tracking-wider mb-2">Exposure-Based Lifecycle</p>
              <div className="flex flex-col gap-2">
                {decayTiers.map((d) => (
                  <div key={d.tier} className="flex items-center justify-between glass rounded-vw p-vw-2">
                    <span className="text-vw-xs text-text-secondary">{d.tier}</span>
                    <span className="text-vw-xs text-primary-300 font-mono">{d.desc}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
