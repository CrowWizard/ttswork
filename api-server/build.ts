import { build } from "bun";

const result = await build({
  entrypoints: ["./src/index.ts"],
  outdir: "./dist",
  naming: "[name]",
  target: "bun",
  minify: true,
  sourcemap: "external",
});

if (!result.success) {
  console.error("构建失败：");
  for (const log of result.logs) {
    console.error(log);
  }
  process.exit(1);
}

console.info("构建产物：");
for (const artifact of result.outputs) {
  console.info(`  ${artifact.path} (${(artifact.size / 1024).toFixed(1)} KB)`);
}

const compileResult = Bun.write(
  "./voice-mvp-api",
  Bun.file(result.outputs[0].path),
);

await compileResult;

const { chmod } = await import("node:fs/promises");
await chmod("./voice-mvp-api", 0o755);

console.info("\n✅ 单可执行文件已生成: ./voice-mvp-api");
