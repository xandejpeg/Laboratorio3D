/** Terminate owned workers and their descendants; no command shell interpolation. */
export function stopProcessTree(pid: number): void {
  if (!Number.isSafeInteger(pid) || pid <= 0 || pid === process.pid) return;
  try {
    if (process.platform === "win32") {
      Bun.spawnSync(["taskkill.exe", "/PID", String(pid), "/T", "/F"], {
        stdout: "ignore", stderr: "ignore", timeout: 10_000,
      });
    } else {
      // Descendants first, so the parent cannot orphan them before enumeration.
      const children = Bun.spawnSync(["pgrep", "-P", String(pid)], {
        stdout: "pipe", stderr: "ignore", timeout: 5_000,
      });
      for (const child of children.stdout.toString().trim().split(/\s+/)) {
        if (/^\d+$/.test(child)) stopProcessTree(Number(child));
      }
    }
  } catch { /* A missing helper must not prevent direct process termination. */ }
  try { process.kill(pid, "SIGKILL"); } catch { /* Already exited. */ }
}
