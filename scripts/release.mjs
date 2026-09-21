// Cuts a MakiNuki mekuri release locally. Validates the tree, runs the
// typecheck, test, and build gates, folds the changelog Unreleased section
// into a dated version section, bumps package.json, then creates the release
// commit and an annotated vX.Y.Z tag. Nothing is pushed; the script prints
// the push command. Pushing the tag triggers the publishing workflow.
//
// usage: pnpm release <patch|minor|major>
//        pnpm release <x.y.z>
import { execSync } from "node:child_process";
import fs from "node:fs";

function fail(message) {
  console.error(`error: ${message}`);
  process.exit(1);
}

const git = (args) => execSync(`git ${args}`, { encoding: "utf8" }).trim();

const arg = process.argv[2];
const isBump = ["patch", "minor", "major"].includes(arg);

// Strict x.y.z: exactly three dot-separated numeric components without
// leading zeros. Returns [major, minor, patch] or null.
function parseVersion(value) {
  const parts = String(value ?? "").split(".");
  if (parts.length !== 3 || parts.some((p) => !/^(0|[1-9][0-9]*)$/.test(p))) {
    return null;
  }
  return parts.map(Number);
}

function compareVersions(a, b) {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1;
  }
  return 0;
}

let bump = null;
let explicit = null;
if (isBump) {
  bump = arg;
} else {
  explicit = parseVersion(arg);
  if (!explicit) {
    console.error("usage: pnpm release <patch|minor|major|x.y.z>");
    process.exit(2);
  }
}

if (git("rev-parse --abbrev-ref HEAD") !== "master") {
  fail("releases are cut from master");
}
if (git("status --porcelain") !== "") {
  fail("working tree is not clean");
}

execSync("pnpm run typecheck", { stdio: "inherit" });
execSync("pnpm run test:run", { stdio: "inherit" });
execSync("pnpm run build", { stdio: "inherit" });

const raw = JSON.parse(fs.readFileSync("package.json", "utf8"));
const current = parseVersion(raw.version);
if (!current) {
  fail(`unsupported version format '${raw.version}'`);
}

let major;
let minor;
let patch;
let next;
if (explicit) {
  if (compareVersions(explicit, current) <= 0) {
    fail(`new version ${arg} must be greater than current ${raw.version}`);
  }
  [major, minor, patch] = explicit;
} else {
  [major, minor, patch] = current;
  if (bump === "major") {
    major += 1;
    minor = 0;
    patch = 0;
  } else if (bump === "minor") {
    minor += 1;
    patch = 0;
  } else {
    patch += 1;
  }
}
next = `${major}.${minor}.${patch}`;

const changelog = fs.readFileSync("CHANGELOG.md", "utf8");
if (!/^## \[Unreleased\]/m.test(changelog)) {
  fail("CHANGELOG.md has no [Unreleased] section");
}
const today = new Date().toISOString().slice(0, 10);
fs.writeFileSync(
  "CHANGELOG.md",
  changelog.replace(/^## \[Unreleased\]/m, `## [${next}] - ${today}`),
);

// One targeted edit keeps the rest of package.json byte-identical,
// including formatting and field order.
raw.version = next;
fs.writeFileSync("package.json", `${JSON.stringify(raw, null, 2)}\n`);

git("add package.json CHANGELOG.md");
execSync(`git commit -m "chore(release): ${next}"`, { stdio: "inherit" });
execSync(`git tag -a v${next} -m "v${next}"`);

console.log("");
console.log(`release ${next} committed and tagged locally.`);
console.log("publish when ready (pushing the tag runs the release workflow):");
console.log("  git push --follow-tags origin master");
