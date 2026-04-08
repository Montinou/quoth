import { motion } from 'framer-motion';

const fadeUp = (delay = 0) => ({
  initial: { opacity: 0, y: 30 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.7, delay, ease: 'easeOut' },
});

export default function HeroSlide() {
  return (
    <div className="slide-page">
      {/* Background decorations */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        {/* Purple orb top-left */}
        <div
          className="absolute -top-[20%] -left-[15%] w-[60%] h-[60%] rounded-full opacity-30"
          style={{
            background: 'radial-gradient(circle, #7c1fff 0%, transparent 70%)',
          }}
        />
        {/* Cyan orb bottom-right */}
        <div
          className="absolute -bottom-[20%] -right-[15%] w-[60%] h-[60%] rounded-full opacity-25"
          style={{
            background: 'radial-gradient(circle, #00e5ff 0%, transparent 70%)',
          }}
        />
        {/* Subtle grid */}
        <div
          className="absolute inset-0 opacity-[0.04]"
          style={{
            backgroundImage:
              'linear-gradient(rgba(255,255,255,0.3) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.3) 1px, transparent 1px)',
            backgroundSize: '4vw 4vw',
          }}
        />
      </div>

      {/* Content */}
      <div className="slide-content relative z-10 flex flex-col items-center justify-center text-center">
        {/* Pulse ring */}
        <motion.div
          className="absolute rounded-full border border-primary-500/30"
          style={{ width: '28vw', height: '28vw' }}
          animate={{
            scale: [1, 1.08, 1],
            opacity: [0.3, 0.6, 0.3],
          }}
          transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
        />
        <motion.div
          className="absolute rounded-full border border-accent-400/20"
          style={{ width: '34vw', height: '34vw' }}
          animate={{
            scale: [1, 1.05, 1],
            opacity: [0.2, 0.4, 0.2],
          }}
          transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut', delay: 0.5 }}
        />

        {/* Title */}
        <motion.h1
          {...fadeUp(0.1)}
          className="text-vw-7xl font-bold gradient-text leading-tight"
        >
          Quoth
        </motion.h1>

        {/* Subtitle */}
        <motion.p
          {...fadeUp(0.3)}
          className="text-vw-2xl text-text-primary mt-4 font-light tracking-wide"
        >
          AI Memory &amp; Self-Learning Platform
        </motion.p>

        {/* Tagline */}
        <motion.p
          {...fadeUp(0.5)}
          className="text-vw-lg text-text-secondary italic mt-3"
        >
          Every session smarter than the last
        </motion.p>

        {/* Version */}
        <motion.p
          {...fadeUp(0.7)}
          className="text-vw-sm text-text-muted mt-8"
        >
          v3.4.0 | quoth.triqual.dev
        </motion.p>
      </div>
    </div>
  );
}
