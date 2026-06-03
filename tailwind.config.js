module.exports = {
  content: ['./src/renderer/**/*.{ts,tsx,html}'],
  theme: {
    extend: {
      colors: {
        brand: {
          navy: '#0F172A',
          indigo: '#4F46E5',
          success: '#10B981',
          warning: '#F59E0B',
          danger: '#EF4444',
          bg: '#F8FAFC',
          card: '#FFFFFF',
          sidebar: '#111827',
        },
      },
      fontFamily: {
        sans: ['Inter', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
      boxShadow: {
        soft: '0 10px 30px rgba(15, 23, 42, 0.08)',
      },
    },
  },
  plugins: [],
};
