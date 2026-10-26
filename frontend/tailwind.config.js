import colors from 'tailwindcss/colors';
import plugin from 'tailwindcss/plugin';

/**
 * Chế độ Sáng/Tối dùng biến CSS: mọi class màu (slate-*, cyan-*, white...) đọc từ
 * `--c-<màu>-<cấp>`. `:root` giữ đúng màu gốc của Tailwind (bản Tối),
 * `html.light` đổi giá trị biến nên không phải sửa từng class trong component.
 */
const SHADES = ['50', '100', '200', '300', '400', '500', '600', '700', '800', '900', '950'];

const ACCENTS = [
  'red', 'orange', 'amber', 'yellow', 'lime', 'green', 'emerald', 'teal', 'cyan',
  'sky', 'blue', 'indigo', 'violet', 'purple', 'fuchsia', 'pink', 'rose',
];

// Accent ở chế độ Sáng: đảo cấp nhạt/đậm, giữ 500-700 để nút màu đặc vẫn đậm
const ACCENT_LIGHT_MAP = {
  50: '950', 100: '900', 200: '800', 300: '700', 400: '600',
  500: '500', 600: '600', 700: '700',
  800: '200', 900: '100', 950: '50',
};

// Slate ở chế độ Sáng: nền trang/thẻ thành trắng, chữ phụ thành xám đậm
const SLATE_LIGHT = {
  50: colors.slate[950],
  100: colors.slate[900],
  200: colors.slate[800],
  300: colors.slate[700],
  400: colors.slate[600],
  500: colors.slate[500],
  600: colors.slate[400],
  700: colors.slate[300],
  800: '#e9eef5',
  900: '#ffffff',
  950: colors.slate[50],
};

const toRgb = (hex) => {
  const h = hex.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)).join(' ');
};

const varColor = (name) => `rgb(var(--c-${name}) / <alpha-value>)`;

const palette = (name) =>
  Object.fromEntries(SHADES.map((s) => [s, varColor(`${name}-${s}`)]));

// Màu nền ngữ nghĩa: [Tối, Sáng]
const SEMANTIC = {
  app: ['#070b13', '#f5f7fb'],
  surface: ['#0c1220', '#ffffff'],
  card: ['#0b1325', '#ffffff'],
  'surface-2': ['#0d1527', '#ffffff'],
  white: ['#ffffff', colors.slate[900]],
};

const themeVars = plugin(({ addBase }) => {
  const dark = {};
  const light = {};

  for (const s of SHADES) {
    dark[`--c-slate-${s}`] = toRgb(colors.slate[s]);
    light[`--c-slate-${s}`] = toRgb(SLATE_LIGHT[s]);
    for (const name of ACCENTS) {
      dark[`--c-${name}-${s}`] = toRgb(colors[name][s]);
      light[`--c-${name}-${s}`] = toRgb(colors[name][ACCENT_LIGHT_MAP[s]]);
    }
  }
  for (const [name, [d, l]] of Object.entries(SEMANTIC)) {
    dark[`--c-${name}`] = toRgb(d);
    light[`--c-${name}`] = toRgb(l);
  }

  addBase({ ':root': dark, 'html.light': light });
});

/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        slate: palette('slate'),
        ...Object.fromEntries(ACCENTS.map((name) => [name, palette(name)])),
        ...Object.fromEntries(Object.keys(SEMANTIC).map((name) => [name, varColor(name)])),
        'on-accent': '#ffffff',
        radiant: {
          50: '#f0f7ff',
          100: '#e0effe',
          200: '#bae0fd',
          300: '#7cc7fb',
          400: '#36abf7',
          500: '#0c8fe9',
          600: '#0272c7',
          700: '#035ba1',
          800: '#074e85',
          900: '#0c416e',
          950: '#082a4a',
        },
      },
    },
  },
  plugins: [themeVars],
};
