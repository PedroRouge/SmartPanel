const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const iconDirectory = path.resolve(__dirname, "../html/icons");

async function renderMark(browser, source, outputName, size) {
  const dataUri = `data:image/svg+xml;base64,${source.toString("base64")}`;
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  await page.setContent(`<!doctype html><html><head><style>html,body{width:${size}px;height:${size}px;margin:0;overflow:hidden}img{display:block;width:100%;height:100%;object-fit:cover}</style></head><body><img src="${dataUri}" alt=""></body></html>`);
  await page.locator("img").screenshot({ path: path.join(iconDirectory, outputName), animations: "disabled" });
  await page.close();
}

function makeIco(entries) {
  const header = Buffer.alloc(6 + entries.length * 16);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(entries.length, 4);
  let offset = header.length;
  const images = entries.map(({ size, file }, index) => {
    const png = fs.readFileSync(path.join(iconDirectory, file));
    const entry = 6 + index * 16;
    header.writeUInt8(size === 256 ? 0 : size, entry);
    header.writeUInt8(size === 256 ? 0 : size, entry + 1);
    header.writeUInt8(0, entry + 2);
    header.writeUInt8(0, entry + 3);
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(png.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += png.length;
    return png;
  });
  return Buffer.concat([header, ...images]);
}

async function main() {
  const source = fs.readFileSync(path.join(iconDirectory, "smart-panel-mark.svg"));
  const browser = await chromium.launch({ headless: true });
  try {
    await renderMark(browser, source, "icon-192.png", 192);
    await renderMark(browser, source, "icon-512.png", 512);
    await renderMark(browser, source, "apple-touch-icon.png", 180);
    await renderMark(browser, source, "icon-512-dark.png", 512);
    await renderMark(browser, source, "icon-maskable.png", 512);
    await renderMark(browser, source, "favicon-16.png", 16);
    await renderMark(browser, source, "favicon-32.png", 32);
    await renderMark(browser, source, "favicon-48.png", 48);
    fs.writeFileSync(path.join(iconDirectory, "favicon.ico"), makeIco([
      { size: 16, file: "favicon-16.png" },
      { size: 32, file: "favicon-32.png" },
      { size: 48, file: "favicon-48.png" },
    ]));
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
