/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // 管理画面(スタッフ側)の操作色=スチールブルー【AKUTOブランド基準 10-09】。お客様画面の店の色とは別
        ui: { DEFAULT: "#3B6E8F", 50: "#EEF3F6", 100: "#D6E2EA" },
      },
    },
  },
  plugins: [],
}