import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { viteStaticCopy } from "vite-plugin-static-copy";

export default defineConfig({
  plugins: [
    vue(),
    viteStaticCopy({
      targets: [
        {
          src: "node_modules/@ricky0123/vad-web/dist/vad.worklet.bundle.min.js",
          dest: "vad",
        },
        {
          src: "node_modules/@ricky0123/vad-web/dist/*.onnx",
          dest: "vad",
        },
        {
          src: "node_modules/onnxruntime-web/dist/*.wasm",
          dest: "vad",
        },
        {
          src: "node_modules/onnxruntime-web/dist/*.mjs",
          dest: "vad",
        },
      ],
    }),
  ],
  build: {
    target: "esnext",
  },
  server: {
    port: 3000,
  },
});
