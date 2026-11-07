
import { defineConfig } from 'vite';

export default defineConfig({
    base: '/VIDLYRA-CHAT/',

    server: {
        host: '0.0.0.0',
        port: 5173,
        strictPort: true,
        hmr: {
            host: 'localhost',
            protocol: 'ws',
            clientPort: 5173
        }
    }
});
