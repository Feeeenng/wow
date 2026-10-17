const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");
const cache = new Map();

// 使用项目现有 TypeScript 编译器加载纯函数，测试不引入新的运行时依赖。
exports.loadSource = function loadSource(relativePath) {
  const filename = path.resolve(__dirname, "..", relativePath);
  if (cache.has(filename)) return cache.get(filename).exports;
  const instance = new Module(filename, module);
  instance.filename = filename;
  instance.paths = Module._nodeModulePaths(path.dirname(filename));
  cache.set(filename, instance);
  const nativeRequire = instance.require.bind(instance);
  instance.require = (specifier) => specifier.startsWith("@/shared/")
    ? loadSource(`../shared/${specifier.slice(9)}.ts`) : specifier.startsWith("@/")
      ? loadSource(`src/${specifier.slice(2)}.ts`) : nativeRequire(specifier);
  const output = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  });
  instance._compile(output.outputText, filename);
  return instance.exports;
};
