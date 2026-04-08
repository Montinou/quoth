import { motion } from 'framer-motion';
import { DollarSign, CheckCircle, ArrowRight } from 'lucide-react';

const fadeUp = (delay = 0) => ({
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.5, delay, ease: 'easeOut' },
});

const llmUsage = [
  { task: 'Trajectory judging', model: 'Gemini 2.5 Flash', cost: 'Free tier' },
  { task: 'Pattern distillation', model: 'Gemini 2.5 Flash Lite', cost: 'Free tier' },
  { task: 'Pattern consolidation', model: 'Claude Haiku 4.5', cost: '$0.80/MTok' },
  { task: 'Embeddings', model: 'MiniLM-L6-v2 (local)', cost: '$0' },
  { task: 'Doc updates', model: 'Claude Sonnet 4.6', cost: 'Sparingly' },
  { task: 'Skill extraction', model: 'Claude Sonnet 4.6', cost: 'Sparingly' },
];

const fallbacks = [
  { from: 'Gemini API down', to: 'Outcome-based judging' },
  { from: 'Embedding model fail', to: 'Keyword matching' },
  { from: 'Cloud unavailable', to: 'Local learning continues' },
  { from: 'Redis unavailable', to: 'Rate limiting disabled' },
  { from: 'Reranker down', to: 'Vector similarity order' },
];

export default function CostOptimizationSlide() {
  return (
    <div className="slide-page">
      {/* Background decorations */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div
          className="absolute top-[5%] left-[10%] w-[45%] h-[45%] rounded-full opacity-15"
          style={{
            background: 'radial-gradient(circle, #22c55e 0%, transparent 70%)',
          }}
        />
        <div
          className="absolute bottom-[10%] right-[5%] w-[35%] h-[35%] rounded-full opacity-10"
          style={{
            background: 'radial-gradient(circle, #7c1fff 0%, transparent 70%)',
          }}
        />
      </div>

      {/* Header */}
      <header className="relative z-10 mb-6 shrink-0">
        <motion.div {...fadeUp(0.1)} className="flex items-center gap-vw-3">
          <DollarSign style={{ width: '2.4vw', height: '2.4vw' }} className="text-accent-400" />
          <h2 className="text-vw-4xl font-bold gradient-text">
            Cost-Optimized LLM Usage
          </h2>
        </motion.div>
        <motion.div
          {...fadeUp(0.2)}
          className="w-20 h-1 rounded-full mt-2 bg-accent-400"
        />
      </header>

      {/* Content */}
      <div className="slide-content relative z-10 flex gap-vw-6">
        {/* Left column - LLM Usage Table (55%) */}
        <motion.div {...fadeUp(0.3)} className="w-[55%]">
          <div className="glass rounded-vw-lg p-vw-5 h-full">
            <h3 className="text-vw-xl font-semibold text-text-primary mb-vw-4">
              LLM Usage Breakdown
            </h3>
            <table className="w-full">
              <thead>
                <tr className="border-b border-border-subtle">
                  <th className="text-left text-vw-sm text-text-muted pb-vw-2 font-medium">Task</th>
                  <th className="text-left text-vw-sm text-text-muted pb-vw-2 font-medium">Model</th>
                  <th className="text-right text-vw-sm text-text-muted pb-vw-2 font-medium">Cost</th>
                </tr>
              </thead>
              <tbody>
                {llmUsage.map((row, i) => (
                  <motion.tr
                    key={row.task}
                    {...fadeUp(0.4 + i * 0.06)}
                    className="border-b border-border-subtle/30"
                  >
                    <td className="text-vw-sm text-text-primary py-vw-2">{row.task}</td>
                    <td className="text-vw-sm text-accent-400 py-vw-2 font-mono">{row.model}</td>
                    <td className="text-right text-vw-sm text-green-400 py-vw-2 font-semibold">
                      {row.cost}
                    </td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          </div>
        </motion.div>

        {/* Right column - Graceful Degradation (45%) */}
        <motion.div {...fadeUp(0.4)} className="w-[45%]">
          <div className="glass rounded-vw-lg p-vw-5 h-full">
            <h3 className="text-vw-xl font-semibold text-text-primary mb-vw-4">
              Graceful Degradation
            </h3>
            <div className="flex flex-col gap-vw-3">
              {fallbacks.map((item, i) => (
                <motion.div
                  key={item.from}
                  {...fadeUp(0.5 + i * 0.07)}
                  className="flex items-center gap-vw-2"
                >
                  <CheckCircle
                    style={{ width: '1.3vw', height: '1.3vw' }}
                    className="text-green-400 shrink-0"
                  />
                  <span className="text-vw-sm text-red-400/80 line-through">{item.from}</span>
                  <ArrowRight
                    style={{ width: '1vw', height: '1vw' }}
                    className="text-text-muted shrink-0"
                  />
                  <span className="text-vw-sm text-green-400 font-medium">{item.to}</span>
                </motion.div>
              ))}
            </div>
            <motion.p
              {...fadeUp(0.9)}
              className="text-vw-xs text-text-muted mt-vw-4 italic"
            >
              System always operational -- no single point of failure
            </motion.p>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
