#!/usr/bin/env node
// 从 CHANGELOG.md 里取出某个版本那一节，release 工作流拿它当 release 说明。
//
//   node scripts/changelog.mjs 0.0.1            # 打到标准输出
//   node scripts/changelog.mjs 0.0.1 -o notes.md
//   node scripts/changelog.mjs 0.0.1 --check    # 只判断有没有，不打印
//
// 取不到就非零退出 —— 发布不该在缺说明的情况下发生。没有测试框架，
// 失败信息直接说明白哪一步缺了什么。

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CHANGELOG = resolve(root, "CHANGELOG.md");

const argv = process.argv.slice(2);
const version = argv.find((a) => !a.startsWith("-"));
const check = argv.includes("--check");
const outIndex = argv.indexOf("-o");
const outPath = outIndex === -1 ? null : argv[outIndex + 1];

if (!version) {
  console.error("用法: node scripts/changelog.mjs <版本号> [-o 输出文件] [--check]");
  process.exit(2);
}

const text = readFileSync(CHANGELOG, "utf8");
const lines = text.split("\n");

// 小节标题形如 `## [0.0.1] - 2026-09-30`，日期可省。
const heading = (line) => {
  const m = /^##\s+\[([^\]]+)\]/.exec(line);
  return m ? m[1] : null;
};

const start = lines.findIndex((line) => heading(line) === version);
if (start === -1) {
  console.error(`CHANGELOG.md 里没有 [${version}] 这一节。`);
  console.error(`发布前先在其中新开一节 \`## [${version}] - YYYY-MM-DD\`，把 [未发布] 里的内容挪进去。`);
  process.exit(1);
}

let end = lines.length;
for (let i = start + 1; i < lines.length; i += 1) {
  if (heading(lines[i])) {
    end = i;
    break;
  }
}

const body = lines
  .slice(start + 1, end)
  // 末尾的链接定义（`[x]: https://...`）属于整份文件，不属于这一节。
  .filter((line) => !/^\[[^\]]+\]:\s+\S+/.test(line))
  .join("\n")
  .trim();

if (!body) {
  console.error(`CHANGELOG.md 里 [${version}] 这一节是空的，没法拿来当 release 说明。`);
  process.exit(1);
}

if (check) {
  console.log(`CHANGELOG.md 里有 [${version}] 一节，共 ${body.split("\n").length} 行。`);
  process.exit(0);
}

if (outPath) {
  writeFileSync(resolve(root, outPath), `${body}\n`);
  console.log(`已写出 ${outPath}`);
} else {
  console.log(body);
}
