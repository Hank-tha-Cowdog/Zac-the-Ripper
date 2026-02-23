import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './src/renderer/**/*.{js,ts,jsx,tsx}'
  ],
  theme: {
    extend: {
      colors: {
        void: '#09090b'
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
        display: ['Share Tech', 'Inter', 'system-ui', 'sans-serif']
      },
      animation: {
        'fade-in': 'fadeIn 0.3s ease-out',
        'slide-up': 'slideUp 0.35s ease-out',
        'spin-slow': 'spin-slow 2s linear infinite',
        'status-pulse': 'status-pulse 1.5s ease-in-out infinite',
        'status-glow': 'status-glow 1.5s ease-in-out infinite',
        'progress-stripe': 'progress-stripe 1s linear infinite',
        'glow-pulse': 'glowPulse 3s cubic-bezier(0.37, 0, 0.63, 1) infinite',
        'border-glow': 'borderGlow 2s cubic-bezier(0.37, 0, 0.63, 1) infinite',
        'shimmer': 'shimmer 2.5s ease-in-out infinite'
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0', transform: 'translateY(4px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' }
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(12px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' }
        },
        'spin-slow': {
          from: { transform: 'rotate(0deg)' },
          to: { transform: 'rotate(360deg)' }
        },
        'status-pulse': {
          '0%, 100%': { opacity: '1', transform: 'scale(1)' },
          '50%': { opacity: '0.5', transform: 'scale(0.95)' }
        },
        'status-glow': {
          '0%, 100%': { boxShadow: '0 0 4px currentColor' },
          '50%': { boxShadow: '0 0 12px currentColor, 0 0 20px currentColor' }
        },
        'progress-fill': {
          from: { width: '0%' }
        },
        'progress-stripe': {
          '0%': { backgroundPosition: '0 0' },
          '100%': { backgroundPosition: '40px 0' }
        },
        glowPulse: {
          '0%, 100%': { filter: 'drop-shadow(0 0 3px rgb(168 85 247 / 0.3))' },
          '50%': { filter: 'drop-shadow(0 0 8px rgb(168 85 247 / 0.6)) drop-shadow(0 0 16px rgb(168 85 247 / 0.2))' }
        },
        borderGlow: {
          '0%, 100%': { borderColor: 'rgb(168 85 247 / 0.3)' },
          '50%': { borderColor: 'rgb(168 85 247 / 0.6)' }
        },
        shimmer: {
          '0%, 100%': { opacity: '0.7' },
          '50%': { opacity: '1' }
        }
      }
    }
  },
  plugins: []
}

export default config
