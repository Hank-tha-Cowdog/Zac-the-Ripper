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
        'fade-in': 'fadeIn 0.2s ease-in-out',
        'spin-slow': 'spin-slow 2s linear infinite',
        'status-pulse': 'status-pulse 1.5s ease-in-out infinite',
        'status-glow': 'status-glow 1.5s ease-in-out infinite',
        'progress-stripe': 'progress-stripe 1s linear infinite'
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' }
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
        }
      }
    }
  },
  plugins: []
}

export default config
