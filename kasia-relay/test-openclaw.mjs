// 测试 OpenClaw Gateway 方法名
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

const TOKEN = process.env.OPENCLAW_TOKEN || "88d16c353db3406b89a9dd89818a361b";
const SESSION = "agent:main:main";

async function call(method, params = {}) {
  try {
    const { stdout, stderr } = await exec(
      "openclaw",
      ["gateway", "call", method,
       "--params", JSON.stringify(params),
       "--token", TOKEN,
       "--expect-final",
       "--json",
       "--timeout", "30000"],
      { timeout: 35000 }
    );
    console.log(`\n✓ ${method}:`);
    console.log(stdout.slice(0, 300));
  } catch (e) {
    console.log(`\n✗ ${method}: ${(e.stderr || e.message || "").split("\n")[0]}`);
  }
}

const candidates = [
  ["agent.turn",    { session: SESSION, message: "hello" }],
  ["agent.run",     { session: SESSION, message: "hello" }],
  ["agent.message", { session: SESSION, message: "hello" }],
  ["agent.chat",    { session: SESSION, message: "hello" }],
  ["session.send",  { session: SESSION, message: "hello" }],
];

for (const [method, params] of candidates) {
  await call(method, params);
}
