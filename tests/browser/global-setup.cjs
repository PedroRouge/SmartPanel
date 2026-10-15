const { spawn } = require("node:child_process");
const path = require("node:path");

module.exports = async function startStaticSite() {
  const root = path.resolve(__dirname, "../..");
  const child = spawn(process.execPath, [path.join(__dirname, "static-server.cjs")], {
    cwd: root,
    stdio: "ignore",
    windowsHide: true,
  });

  await new Promise((resolve, reject) => {
    const deadline = Date.now() + 15_000;
    const timer = setInterval(async () => {
      if (child.exitCode !== null) {
        clearInterval(timer);
        reject(new Error(`Static test server exited with ${child.exitCode}`));
        return;
      }
      try {
        const response = await fetch("http://127.0.0.1:4173/");
        if (response.ok) {
          clearInterval(timer);
          resolve();
          return;
        }
      } catch {}
      if (Date.now() > deadline) {
        clearInterval(timer);
        child.kill();
        reject(new Error("Static test server did not start"));
      }
    }, 100);
  });

  return async function stopStaticSite() {
    if (child.exitCode === null) child.kill();
    await Promise.race([
      new Promise((resolve) => child.once("exit", resolve)),
      new Promise((resolve) => setTimeout(resolve, 2_000)),
    ]);
  };
};
