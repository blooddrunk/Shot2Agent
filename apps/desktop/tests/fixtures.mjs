import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
export function makeCli(base, provider) {
  const pkgName =
    provider === "codex" ? "@openai/codex" : "@anthropic-ai/claude-code";
  const entryRelative = provider === "codex" ? "bin/codex.js" : "cli.js";
  const shimName = provider === "codex" ? "codex.cmd" : "claude.cmd";
  const shim = join(base, "npm", shimName);
  const packageRoot = join(base, "npm", "node_modules", ...pkgName.split("/"));
  const entry = join(packageRoot, entryRelative);
  mkdirSync(join(packageRoot, entryRelative, ".."), { recursive: true });
  writeFileSync(shim, "synthetic npm shim; never executed\n");
  writeFileSync(
    join(packageRoot, "package.json"),
    JSON.stringify({ name: pkgName, bin: { [provider]: entryRelative } }),
  );
  const flags =
    provider === "codex"
      ? [
          "--image",
          "--output-last-message",
          "--sandbox",
          "--ignore-user-config",
          "--ignore-rules",
          "--ephemeral",
        ]
      : [
          "--input-format",
          "--output-format",
          "--tools",
          "--disallowedTools",
          "--restricted",
          "--safe-mode",
          "--no-session-persistence",
          "--strict-mcp-config",
          "--mcp-config",
          "--settings",
          "--setting-sources",
        ];
  const version =
    provider === "codex" ? "codex-cli m7-test" : "2.1.305 (Claude Code)";
  const code = `const a=process.argv.slice(2); if(a[0]==='--version') console.log(${JSON.stringify(version)}); else if((a[0]==='exec'&&a.includes('--help'))||a[0]==='--help') console.log(${JSON.stringify(flags.join(" "))}); else process.exit(0);\n`;
  writeFileSync(entry, code);
  return shim;
}

export function credentialStore(seed = {}) {
  const values = new Map(Object.entries(seed));
  const deleted = [];
  return {
    values,
    deleted,
    async save(reference, token) {
      values.set(reference, token);
    },
    async read(reference) {
      if (!values.has(reference))
        throw new Error("GATEWAY_CREDENTIAL_UNAVAILABLE");
      return values.get(reference);
    },
    async delete(reference) {
      deleted.push(reference);
      values.delete(reference);
    },
  };
}
