import path from 'path';
import cssInjectedByJsPlugin from 'vite-plugin-css-injected-by-js';

export default {
  build: {
    copyPublicDir: false,
    lib: {
      entry: path.resolve(__dirname, 'src', 'index.js'),
      name: 'SandboxTool',
      fileName: 'sandbox'
    }
  },
  plugins: [cssInjectedByJsPlugin()]
};
