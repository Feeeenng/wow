const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");
const cache = new Map();

/** 使用已锁定TS编译器加载纯模块，构建环境变量由测试窗口来源提供。 */
exports.load = function load(relative) {
  const filename = path.resolve(__dirname, "..", relative);
  if (cache.has(filename)) return cache.get(filename).exports;
  const instance = new Module(filename, module); instance.filename = filename;
  instance.paths = Module._nodeModulePaths(path.dirname(filename)); cache.set(filename, instance);
  const native = instance.require.bind(instance);
  instance.require = (name) => name.startsWith("@/shared/") ? load("../shared/" + name.slice(9) + ".ts")
    : name.startsWith("@/") ? load("src/" + name.slice(2) + ".ts") : native(name);
  const source = fs.readFileSync(filename, "utf8").replaceAll("import.meta.env.VITE_API_URL", "undefined");
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  instance._compile(output.outputText, filename); return instance.exports;
};
