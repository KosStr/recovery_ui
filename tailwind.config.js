/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{js,jsx,ts,tsx}', './src/**/*.{js,jsx,ts,tsx}'],
  presets: [require('nativewind/preset')],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // --- Base: true OLED black, so unlit pixels cost zero power ---
        void: '#000000',
        surface: '#0A0A0C',
        elevated: '#121216',
        hairline: '#1E1E24',

        // --- Muted accents (never saturated; these are lit at 2am) ---
        sage: {
          DEFAULT: '#7C9A83',
          dim: '#4E6354',
          glow: '#A3C4AB',
        },
        indigo: {
          DEFAULT: '#5A63A8',
          dim: '#343A63',
          glow: '#8790D6',
        },
        amber: {
          DEFAULT: '#D9A05B',
          dim: '#8A6537',
          glow: '#F0C68C',
        },

        // --- Type ramp ---
        ink: {
          DEFAULT: '#F2F2F0',
          soft: '#A1A1A6',
          mute: '#6B6B72',
          ghost: '#3A3A42',
        },
      },
      fontFamily: {
        sans: ['System'],
      },
      borderRadius: {
        card: '20px',
        pill: '999px',
      },
      spacing: {
        gutter: '20px',
      },
    },
  },
  plugins: [],
};
