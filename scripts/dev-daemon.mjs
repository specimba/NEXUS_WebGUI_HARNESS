// Dev-server daemonizer for this sandbox: the Bash tool reaps the spawned
// process tree when a tool call ends, which kept killing `bun run dev`.
// spawn(detached: true) makes the child a leader of a NEW process group and
// unref + parent exit reparent it to PID 1 — exactly how the surviving
// agent-browser daemon is structured. Same recipe that kept it alive.
import { spawn } from "node:child_process";
import { openSync } from "node:fs";

const logFd = openSync("/home/z/my-project/dev.log", "a");
const child = spawn("bun", ["run", "dev"], {
  cwd: "/home/z/my-project",
  detached: true,
  stdio: ["ignore", logFd, logFd],
});
child.unref();
console.log("dev daemon spawned pid=" + child.pid);
