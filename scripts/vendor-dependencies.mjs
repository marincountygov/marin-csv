#!/usr/bin/env node

import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const target = join(root, "vendor", "third-party");

const dependencies = [
  {
    packageName: "papaparse",
    expectedVersion: "5.7.0",
    files: [
      ["papaparse.min.js", "papaparse.min.js"],
      ["LICENSE", "PAPAPARSE_LICENSE.txt"],
    ],
  },
  {
    packageName: "tabulator-tables",
    expectedVersion: "6.6.1",
    files: [
      ["dist/js/tabulator.min.js", "tabulator.min.js"],
      ["dist/css/tabulator.min.css", "tabulator.min.css"],
      ["LICENSE", "TABULATOR_LICENSE.txt"],
    ],
  },
];

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function sha256(path) {
  const bytes = await readFile(path);
  return { bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
}

await mkdir(target, { recursive: true });
const manifest = { schema: 1, status: "vendored", generatedBy: "scripts/vendor-dependencies.mjs", dependencies: {} };

for (const dependency of dependencies) {
  const packageRoot = join(root, "node_modules", dependency.packageName);
  let packageMetadata;
  try {
    packageMetadata = await readJson(join(packageRoot, "package.json"));
  } catch (error) {
    throw new Error(`Missing ${dependency.packageName}. Run npm install first. (${error.message})`);
  }
  if (packageMetadata.version !== dependency.expectedVersion) {
    throw new Error(
      `${dependency.packageName} must be exactly ${dependency.expectedVersion}; found ${packageMetadata.version}.`,
    );
  }

  const fileRecords = {};
  for (const [sourceRelative, targetName] of dependency.files) {
    const source = join(packageRoot, sourceRelative);
    const destination = join(target, targetName);
    await copyFile(source, destination);
    fileRecords[targetName] = await sha256(destination);
  }
  manifest.dependencies[dependency.packageName] = {
    version: dependency.expectedVersion,
    installed: true,
    files: fileRecords,
  };
}

await writeFile(
  join(target, "vendor-status.js"),
  `/* Generated. Do not edit by hand. */\nwindow.MarinCsvVendor = Object.freeze(${JSON.stringify({
    phase: "vendored",
    papaParse: "5.7.0",
    tabulator: "6.6.1",
  }, null, 2)});\n`,
  "utf8",
);
manifest.files = {
  "vendor-status.js": await sha256(join(target, "vendor-status.js")),
};
await writeFile(join(target, "vendor-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log("Vendored Papa Parse 5.7.0 and Tabulator 6.6.1 with SHA-256 records.");
