import { defineConfig, type Plugin } from "vite";

/**
 * Library-mode build config.
 *
 * Usage:
 *   npm run build:lib
 *
 * Output (dist-lib/):
 *   ssml-editor.iife.js   —  usable via <script src>; window.SSMLEditor is the constructor
 *   ssml-editor.umd.cjs   —  UMD, CommonJS / global compatible
 *   style.css             —  styles (include via <link> in HTML)
 *   demo.html             —  generated usage example
 *
 * No Node.js built-ins are imported here, so no `@types/node` is required.
 */
function genDemoHtml(): Plugin {
  const demo = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>SSML Editor Vanilla — static HTML usage example</title>
  <!-- 1) Styles -->
  <link rel="stylesheet" href="./style.css" />
  <style>
    body { font-family: system-ui, sans-serif; margin: 24px; }
    #mount { max-width: 900px; height: 420px; border: 1px solid #ddd; }
  </style>
</head>
<body>
  <h3>SSML Editor (IIFE single-file include)</h3>
  <div id="mount"></div>
  <button id="dump">输出 SSML</button>
  <pre id="out"></pre>

  <!-- 2) Include the library: one <script src>, like jQuery -->
  <script src="./ssml-editor.iife.js"></script>
  <script>
    // SSMLEditor is attached to the global scope by the IIFE — use it directly,
    // no destructuring or namespace wrapper needed. Utility functions are exposed
    // as static methods on the constructor: SSMLEditor.modelToSSML / ssmlToModel / plainToModel ...
    const ed = new SSMLEditor({
      el: document.getElementById("mount"),
      value: SSMLEditor.plainToModel("你好，SSML 编辑器"),
      onChange: (next) => console.log("changed:", next),
    });
    document.getElementById("dump").onclick = () => {
      document.getElementById("out").textContent = SSMLEditor.modelToSSML(ed.getValue());
    };
  </script>
</body>
</html>
`;
  return {
    name: "gen-demo-html",
    apply: "build",
    generateBundle() {
      this.emitFile({ type: "asset", fileName: "demo.html", source: demo });
    },
  };
}

export default defineConfig({
  plugins: [genDemoHtml()],

  build: {
    outDir: "dist-lib",
    emptyOutDir: true,
    cssCodeSplit: false,
    sourcemap: true,
    lib: {
      entry: "src/components/SSML-Editor-Vanilla/entry.ts",
      name: "SSMLEditor",
      formats: ["iife", "umd"],
      fileName: (format) => (format === "umd" ? "ssml-editor.umd.cjs" : "ssml-editor.iife.js"),
    },
    rollupOptions: {
      // external: ["pinyin-pro"],
      output: {
        assetFileNames: "style.[ext]",
        globals: {
          "pinyin-pro": "pinyinPro",
        },
      },
    },
  },
});