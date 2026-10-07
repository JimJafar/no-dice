/**
 * Which file a request may have out of the directory the console serves.
 *
 * Every case is run against a real directory tree in a temp directory, with the
 * file outside it actually present: a refusal that only passed because the file
 * was missing would prove nothing about the rule.
 */
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { contentTypeOf, resolveStatic } from "./static.ts";

let root: string;
let outside: string;
let temp: string;

beforeEach(() => {
  temp = mkdtempSync(join(tmpdir(), "nd-ui-static-"));
  root = join(temp, "dist");
  outside = join(temp, "outside.txt");
  mkdirSync(join(root, "assets"), { recursive: true });
  writeFileSync(join(root, "index.html"), "<!doctype html>");
  writeFileSync(join(root, "assets", "app.js"), "export const drawn = true;\n");
  writeFileSync(outside, "not for the page\n");
});

afterEach(() => {
  rmSync(temp, { recursive: true, force: true });
});

describe("resolveStatic", () => {
  it("serves a file inside the directory, at the top and nested", () => {
    expect(resolveStatic(root, "/index.html")).toBe(join(root, "index.html"));
    expect(resolveStatic(root, "/assets/app.js")).toBe(join(root, "assets", "app.js"));
    // The same file named with a redundant `.` in its path is the same file.
    expect(resolveStatic(root, "/assets/./app.js")).toBe(join(root, "assets", "app.js"));
  });

  it("refuses a path that climbs out of the directory, in every spelling", () => {
    // The file is really there, one level up: this is the rule being tested, not
    // the absence of a file.
    expect(resolveStatic(root, "/../outside.txt")).toBeNull();
    expect(resolveStatic(root, "/%2e%2e/outside.txt")).toBeNull();
    expect(resolveStatic(root, "/assets/../../outside.txt")).toBeNull();
    expect(resolveStatic(root, "/..")).toBeNull();
    expect(resolveStatic(root, "/assets/..")).toBeNull();
  });

  it("refuses an absolute path, which names nothing inside the directory it is served from", () => {
    expect(resolveStatic(root, "/etc/passwd")).toBeNull();
    expect(resolveStatic(root, "//etc/passwd")).toBeNull();
  });

  it("refuses a symlink that leads out of the directory", () => {
    const link = join(root, "escape.js");
    symlinkSync(outside, link);
    expect(resolveStatic(root, "/escape.js")).toBeNull();
  });

  it("serves a symlink that stays inside the directory", () => {
    const link = join(root, "assets", "copy.js");
    symlinkSync(join(root, "assets", "app.js"), link);
    expect(resolveStatic(root, "/assets/copy.js")).toBe(join(root, "assets", "app.js"));
  });

  it("names no file for the directory itself, for a path that is not there, or for a root that is not", () => {
    expect(resolveStatic(root, "/")).toBeNull();
    expect(resolveStatic(root, "/assets")).toBeNull();
    expect(resolveStatic(root, "/nope.js")).toBeNull();
    expect(resolveStatic(join(temp, "not-built"), "/index.html")).toBeNull();
  });

  it("names no file for a path it cannot decode, or one with a NUL in it", () => {
    expect(resolveStatic(root, "/%zz.html")).toBeNull();
    expect(resolveStatic(root, "/index.html%00.js")).toBeNull();
  });
});

describe("contentTypeOf", () => {
  it("types what a built app is made of, so a browser runs its script and styles its page", () => {
    expect(contentTypeOf("/assets/app.js")).toBe("text/javascript; charset=utf-8");
    expect(contentTypeOf("/index.html")).toBe("text/html; charset=utf-8");
    expect(contentTypeOf("/assets/app.css")).toBe("text/css; charset=utf-8");
    expect(contentTypeOf("/series.json")).toBe("application/json; charset=utf-8");
  });

  it("types anything else as bytes, which a browser will not run as a script", () => {
    expect(contentTypeOf("/notes.md")).toBe("application/octet-stream");
    expect(contentTypeOf("/no-extension")).toBe("application/octet-stream");
  });
});
