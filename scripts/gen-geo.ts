import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const fastapiDirectory = join(root, "apps", "fastapi");
const python = [
  join(fastapiDirectory, ".venv", "bin", "python"),
  join(fastapiDirectory, ".venv", "Scripts", "python.exe"),
].find(existsSync);

if (!python) {
  throw new Error(
    "Python virtual environment not found. Run `just geo-setup` first.",
  );
}

async function run(command: string[], cwd: string) {
  const process = Bun.spawn(command, {
    cwd,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });

  const exitCode = await process.exited;
  if (exitCode !== 0) {
    globalThis.process.exit(exitCode);
  }
}

await run([python, "export_openapi.py"], fastapiDirectory);
await run(
  ["bun", "run", "--cwd", "packages/api", "gen:geo"],
  root,
);
