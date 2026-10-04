/**
 * 站点图标的断言。
 *
 *   npm test
 *
 * 盯的是几个错了不显眼的地方：什么字节才算 ICO（认错了会把一张 PNG 存成图标，
 * 页面上一直空白）、什么形状的值才算「设置过图标」（认松了，一条手改过的库记录
 * 会变成链接的 href）、以及上限两边用的是不是同一个数。
 * 没有测试框架 —— node 自己剥掉类型，失败时退出码非零。
 */
import assert from "node:assert/strict";
import {
  FAVICON_PREFIX,
  MAX_FAVICON_BYTES,
  icoToDataUrl,
  isFaviconDataUrl,
  looksLikeIco,
} from "./favicon.ts";

let passed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    passed += 1;
  } catch (error) {
    console.error(`\n✗ ${name}\n`, error);
    process.exit(1);
  }
}

/** 一个 16×16 单图 ICO 的前 22 字节（含目录项），够表头与像素数据各占一点。 */
const ICO = new Uint8Array([
  0, 0, 1, 0, 1, 0, 16, 16, 0, 0, 1, 0, 32, 0, 40, 0, 0, 0, 0, 0, 255, 255,
]);

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

test("only the ICO magic counts", () => {
  assert.equal(looksLikeIco(ICO), true);
  assert.equal(looksLikeIco(PNG), false, "PNG 的文件头不是 ICO");
  assert.equal(looksLikeIco(new Uint8Array([])), false, "空文件");
  assert.equal(looksLikeIco(new Uint8Array([0, 0, 1])), false, "比文件头还短");
  // 第 3 个字节是类型：2 是光标（.cur），不是图标。
  assert.equal(looksLikeIco(new Uint8Array([0, 0, 2, 0])), false);
});

test("an ICO round-trips through the data URL", () => {
  const dataUrl = icoToDataUrl(ICO);
  assert.ok(dataUrl, "这批字节是 ICO");
  assert.ok(dataUrl.startsWith(FAVICON_PREFIX));
  const payload = Buffer.from(dataUrl.slice(FAVICON_PREFIX.length), "base64");
  assert.deepEqual(new Uint8Array(payload), ICO, "编出来的 base64 要能原样解回去");
});

test("a non-ICO is refused rather than stored", () => {
  assert.equal(icoToDataUrl(PNG), null);
});

test("a stored value is a data URL of the exact shape written", () => {
  assert.equal(isFaviconDataUrl(icoToDataUrl(ICO)), true);
  assert.equal(isFaviconDataUrl(`${FAVICON_PREFIX}`), true, "退化的空图标也仍是这个形状");
  assert.equal(isFaviconDataUrl("https://example.com/favicon.ico"), false, "外链不是上传的图标");
  assert.equal(isFaviconDataUrl("data:image/svg+xml;base64,PHN2Zy8+"), false, "只认写入的那种 MIME");
  assert.equal(isFaviconDataUrl(""), false);
  assert.equal(isFaviconDataUrl(null), false);
  assert.equal(isFaviconDataUrl({ favicon: FAVICON_PREFIX }), false);
  assert.equal(
    isFaviconDataUrl(FAVICON_PREFIX + "A".repeat(64 * 1024)),
    false,
    "超过 hub 请求上限长度的值不认",
  );
});

test("the byte cap fits the hub's request body", () => {
  // base64 膨胀 4/3，加上 JSON 外壳仍要落在 hub 的 64 KiB 之内。
  assert.ok(MAX_FAVICON_BYTES * (4 / 3) < 64 * 1024);
});

console.log(`favicon: ${passed} tests passed`);
