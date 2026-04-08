import { motion } from 'framer-motion';
import { Bot, Sparkles, Database, ArrowRight } from 'lucide-react';

const stagger = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.15 } },
};

const fadeUp = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5 } },
};

const cards = [
  {
    stage: '1',
    title: 'JUDGE',
    model: 'Gemini 2.5 Flash (batch 30)',
    icon: Bot,
    desc: 'Batch-evaluate effectiveness + domain classify',
    output: 'Verdict + agent type tag',
    accent: 'primary',
    border: 'border-primary-500/30',
    glow: 'shadow-primary-500/10',
    iconBg: 'bg-primary-500/15',
    iconColor: 'text-primary-400',
  },
  {
    stage: '2',
    title: 'DISTILL',
    model: 'Gemini 2.5 Flash Lite + MiniLM-L6',
    icon: Sparkles,
    desc: 'Extract reusable pattern',
    output: 'Name, tags, 384d embedding',
    accent: 'gradient',
    border: 'border-primary-400/20',
    glow: 'shadow-accent-400/10',
    iconBg: 'bg-gradient-to-br from-primary-500/20 to-accent-400/20',
    iconColor: 'text-accent-300',
  },
  {
    stage: '3',
    title: 'CONSOLIDATE',
    model: 'Claude Haiku 4.5 (CLI)',
    icon: Database,
    desc: 'Merge or create new',
    output: 'Bayesian update or new entry',
    accent: 'accent',
    border: 'border-accent-400/30',
    glow: 'shadow-accent-400/10',
    iconBg: 'bg-accent-400/15',
    iconColor: 'text-accent-400',
  },
];

function GradientArrow() {
  return (
    <div className="flex items-center justify-center shrink-0 px-1">
      <div className="relative">
        <div className="w-8 h-0.5 bg-gradient-to-r from-primary-500 to-accent-400 rounded-full" />
        <ArrowRight className="absolute -right-3 -top-[7px] w-4 h-4 text-accent-400" />
      </div>
    </div>
  );
}

export default function DaemonPipeline() {
  return (
    <div className="slide-page">
      {/* Background decorations */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-1/4 left-1/6 w-64 h-64 bg-primary-500/5 rounded-full blur-3xl" />
        <div className="absolute bottom-1/3 right-1/6 w-72 h-72 bg-accent-400/5 rounded-full blur-3xl" />
      </div>

      {/* Header */}
      <header className="relative z-10 mb-6 shrink-0">
        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
          <h1 className="text-vw-3xl font-bold gradient-text mb-1">Daemon Pipeline</h1>
          <p className="text-vw-base text-text-secondary">Three-Stage LLM Processing</p>
        </motion.div>
      </header>

      {/* Content */}
      <div className="slide-content relative z-10 flex flex-col gap-4">
        {/* Pipeline flow — 3 cards with arrows */}
        <motion.div
          className="flex items-stretch gap-2 flex-1 min-h-0"
          variants={stagger}
          initial="hidden"
          animate="show"
        >
          {cards.map((card, i) => (
            <div key={card.title} className="contents">
              <motion.div
                variants={fadeUp}
                className={`glass rounded-vw-xl p-vw-4 flex-1 flex flex-col ${card.border} ${card.glow} shadow-lg`}
              >
                {/* Stage badge */}
                <div className="flex items-center gap-2 mb-3">
                  <span className={`${card.iconBg} ${card.iconColor} w-8 h-8 rounded-lg flex items-center justify-center`}>
                    <card.icon className="w-4 h-4" />
                  </span>
                  <span className="text-vw-xs text-text-muted font-mono">Stage {card.stage}</span>
                </div>

                {/* Title */}
                <h3 className="text-vw-lg font-bold text-text-primary mb-1">{card.title}</h3>
                <p className="text-vw-xs text-text-muted mb-1 font-mono">{card.model}</p>

                {/* Description */}
                <p className="text-vw-sm text-text-secondary mb-3 flex-1">{card.desc}</p>

                {/* Output */}
                <div className="glass rounded-vw p-vw-2 mt-auto">
                  <p className="text-vw-xs text-text-muted mb-0.5 uppercase tracking-wider">Output</p>
                  <p className="text-vw-xs text-accent-300 font-mono">{card.output}</p>
                </div>
              </motion.div>

              {i < cards.length - 1 && <GradientArrow />}
            </div>
          ))}
        </motion.div>

        {/* Session Batch Distill section */}
        <motion.div
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.6, duration: 0.5 }}
          className="glass rounded-vw-xl p-vw-3 border border-accent-400/20 shrink-0"
        >
          <div className="flex items-center gap-3">
            <span className="bg-accent-400/15 text-accent-400 px-3 py-1 rounded-full text-vw-xs font-mono font-semibold">
              v3.4.0
            </span>
            <div>
              <h4 className="text-vw-sm font-semibold text-text-primary">Session Batch Distill</h4>
              <p className="text-vw-xs text-text-secondary">
                Groups all session <span className="font-mono text-accent-300">tool_use</span> entries
                &rarr; 1 LLM call &rarr; 1-3 higher-quality patterns
              </p>
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
