import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  // ビルド時刻を entry に埋め込む。①デプロイごとに必ず entry ハッシュが変わり
  // 新バージョン検知バナー(UpdateBanner)が確実に発火する ②端末のコンソールで
  // window.__AKUTO_BUILD を見れば「どのビルドが動いているか」を特定できる。
  define: {
    __AKUTO_BUILD_TIME__: JSON.stringify(new Date().toISOString())
  },
  plugins: [react()],
  server: {
    // デプロイ環境では firebase.json の rewrites が /api/** を Cloud Functions へ中継する。
    // ローカル vite にはその中継が無く顧客導線(bootstrap等)が 404 になるため、
    // dev Hosting 経由で同じ rewrite に乗せる。
    proxy: {
      '/api': {
        target: 'https://mobile-order-dev-5f7fd.web.app',
        changeOrigin: true
      }
    }
  },
  build: {
    reportCompressedSize: false,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('firebase')) return 'firebase';
          if (id.includes('framer-motion')) return 'motion';
          if (id.includes('lucide-react')) return 'icons';
          if (id.includes('react') || id.includes('scheduler')) return 'react-vendor';
          return 'vendor';
        }
      }
    }
  },
})
