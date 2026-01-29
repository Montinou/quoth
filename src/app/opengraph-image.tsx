import { ImageResponse } from 'next/og';

export const runtime = 'edge';
export const alt = 'Quoth v2.0 - AI Memory for Claude';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default async function Image() {
  // Load Cinzel font from Google Fonts
  const cinzelFont = await fetch(
    'https://fonts.gstatic.com/s/cinzel/v23/8vIU7ww63mVu7gtR-kwKxNvkNOjw-tbnfY3lCA.ttf'
  ).then((res) => res.arrayBuffer());

  return new ImageResponse(
    (
      <div
        style={{
          background: '#050505',
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        {/* Background gradient - subtle violet glow at top */}
        <div
          style={{
            position: 'absolute',
            top: '-200px',
            left: '50%',
            transform: 'translateX(-50%)',
            width: '800px',
            height: '600px',
            background: 'radial-gradient(ellipse at center, rgba(139, 92, 246, 0.15) 0%, transparent 70%)',
            filter: 'blur(60px)',
          }}
        />

        {/* Secondary glow orbs */}
        <div
          style={{
            position: 'absolute',
            top: '40%',
            left: '-100px',
            width: '400px',
            height: '400px',
            background: 'radial-gradient(circle, rgba(124, 58, 237, 0.1) 0%, transparent 70%)',
            filter: 'blur(80px)',
          }}
        />
        <div
          style={{
            position: 'absolute',
            bottom: '20%',
            right: '-50px',
            width: '300px',
            height: '300px',
            background: 'radial-gradient(circle, rgba(139, 92, 246, 0.08) 0%, transparent 70%)',
            filter: 'blur(60px)',
          }}
        />

        {/* Subtle grid pattern overlay */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundImage: `
              linear-gradient(rgba(139, 92, 246, 0.03) 1px, transparent 1px),
              linear-gradient(90deg, rgba(139, 92, 246, 0.03) 1px, transparent 1px)
            `,
            backgroundSize: '60px 60px',
            opacity: 0.5,
          }}
        />

        {/* Main content */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1,
            padding: '0 60px',
          }}
        >
          {/* Badge - Claude Plugin - MCP Server */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '8px 20px',
              borderRadius: '999px',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              background: 'rgba(255, 255, 255, 0.05)',
              marginBottom: '40px',
            }}
          >
            <div
              style={{
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                background: '#8B5CF6',
                boxShadow: '0 0 10px rgba(139, 92, 246, 0.8)',
              }}
            />
            <span
              style={{
                fontSize: '14px',
                color: '#DDD6FE',
                letterSpacing: '0.15em',
                textTransform: 'uppercase',
                fontFamily: 'system-ui, sans-serif',
              }}
            >
              Model Context Protocol Server
            </span>
          </div>

          {/* Main Title - "AI Memory." */}
          <div
            style={{
              fontSize: '72px',
              fontWeight: 500,
              color: '#FFFFFF',
              fontFamily: 'Cinzel',
              letterSpacing: '0.02em',
              lineHeight: 1.1,
              textAlign: 'center',
            }}
          >
            AI Memory.
          </div>

          {/* Second line - "Not Just Search." with gradient */}
          <div
            style={{
              fontSize: '72px',
              fontWeight: 500,
              fontFamily: 'Cinzel',
              letterSpacing: '0.02em',
              lineHeight: 1.1,
              textAlign: 'center',
              marginBottom: '32px',
              background: 'linear-gradient(135deg, #8B5CF6 0%, #DDD6FE 50%, #A78BFA 100%)',
              backgroundClip: 'text',
              color: 'transparent',
            }}
          >
            Not Just Search.
          </div>

          {/* Subtitle */}
          <div
            style={{
              fontSize: '24px',
              color: '#9CA3AF',
              maxWidth: '700px',
              textAlign: 'center',
              lineHeight: 1.5,
              fontFamily: 'system-ui, sans-serif',
              fontWeight: 300,
            }}
          >
            Give Claude persistent memory that learns as you work.
          </div>

          {/* Secondary tagline */}
          <div
            style={{
              fontSize: '18px',
              color: '#6B7280',
              marginTop: '16px',
              fontFamily: 'system-ui, sans-serif',
              fontWeight: 300,
            }}
          >
            Local-first storage. Bidirectional learning. Session logging.
          </div>
        </div>

        {/* Decorative border */}
        <div
          style={{
            position: 'absolute',
            top: '24px',
            left: '24px',
            right: '24px',
            bottom: '24px',
            border: '1px solid rgba(139, 92, 246, 0.15)',
            borderRadius: '16px',
          }}
        />

        {/* Bottom brand mark */}
        <div
          style={{
            position: 'absolute',
            bottom: '40px',
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
          }}
        >
          <div
            style={{
              fontSize: '20px',
              color: '#8B5CF6',
              fontFamily: 'Cinzel',
              fontWeight: 600,
            }}
          >
            Quoth
          </div>
          <div
            style={{
              width: '1px',
              height: '16px',
              background: 'rgba(139, 92, 246, 0.3)',
            }}
          />
          <div
            style={{
              fontSize: '14px',
              color: '#6B7280',
              fontFamily: 'system-ui, sans-serif',
              fontStyle: 'italic',
            }}
          >
            Wisdom over Guesswork
          </div>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        {
          name: 'Cinzel',
          data: cinzelFont,
          style: 'normal',
          weight: 500,
        },
      ],
    }
  );
}
