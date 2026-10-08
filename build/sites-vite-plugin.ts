/**
 * Local stand-in for the ChatGPT Sites build plugin.
 *
 * The original ships with the Sites control plane and was excluded from this
 * source handoff (see SOURCE_HANDOFF.md). `vite.config.ts` imports `sites()`
 * at config load, so the build cannot start without it.
 *
 * Reconstructed to the only contract observable from this repo: the packaged
 * artifact must contain `dist/.openai/hosting.json` (scripts/validate-artifact.sh).
 * This copies the source manifest there after the bundle is written.
 */
import { mkdir, copyFile } from "node:fs/promises";
import path from "node:path";
import type { Plugin } from "vite";

export function sites(): Plugin {
  let root = process.cwd();

  return {
    name: "sites-manifest",
    configResolved(config) {
      root = config.root ?? root;
    },
    // Runs per build environment; writing the same manifest twice is harmless.
    async closeBundle() {
      const src = path.join(root, ".openai", "hosting.json");
      const destDir = path.join(root, "dist", ".openai");
      await mkdir(destDir, { recursive: true });
      await copyFile(src, path.join(destDir, "hosting.json"));
    },
  };
}
