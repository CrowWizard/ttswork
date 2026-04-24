import { mkdirSync, existsSync } from "node:fs";

const OUTDIR = "./dist";
if (!existsSync(OUTDIR)) mkdirSync(OUTDIR);

const proc = Bun.spawn([
  "bun",
  "build",
  "--compile",
  "--minify",
  "--sourcemap=external",
  "--target=bun",
  "--outfile=./voice-mvp-api",
  "./src/index.ts",
], {
  cwd: import.meta.dir,
  stdout: "inherit",
  stderr: "inherit",
});

const exitCode = await proc.exited;

if (exitCode !== 0) {
  console.error(`\n❌ 构建失败 (exit code: ${exitCode})`);
  process.exit(exitCode);
}

const { statSync } = await import("node:fs");
const size = statSync("./voice-mvp-api").size;
console.info(`\n✅ 单可执行文件已生成: ./voice-mvp-api (${(size / 1024 / 1024).toFixed(1)} MB)`);
