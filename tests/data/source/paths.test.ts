import { describe, expect, it } from "vitest";
import { resolvePath } from "../../../srcs/index.js";

describe("resolvePath", () => {
  it.each([
    ["main.hueke", "2026.hueke", "2026.hueke"],
    ["main.hueke", "./2026.hueke", "2026.hueke"],
    ["years/main.hueke", "../2026.hueke", "2026.hueke"],
    ["years/main.hueke", "2026/10.hueke", "years/2026/10.hueke"],
    ["years/main.hueke", "/2026/10.hueke", "2026/10.hueke"],
    ["a/b/main.hueke", "..//./c.hueke", "a/c.hueke"],
    ["main.hueke", "a/..//./b.hueke", "b.hueke"],
  ])("from %s, %s is %s", (from, written, path) => {
    expect(resolvePath(from, written)).toEqual({ path });
  });
  it.each([
    ["2026/", "path.invalid"],
    ["2026/..", "path.invalid"],
    ["", "path.invalid"],
    ["a/..", "path.invalid"],
    ["a/.", "path.invalid"],
    [".", "path.invalid"],
    ["..", "path.invalid"],
    ["C:x", "path.invalid"],
    ["https://example.com/x.hueke", "path.invalid"],
    ["file:x.hueke", "path.invalid"],
    ["../x.hueke", "path.outside-root"],
    ["/../x.hueke", "path.outside-root"],
  ])("%s is %s", (written, error) => {
    const resolved = resolvePath("main.hueke", written);
    expect(resolved).toMatchObject({ error });
    expect(resolved).toHaveProperty("message", expect.any(String));
  });
  it("compares paths after NFC normalization", () => {
    expect(resolvePath("main.hueke", "café.hueke")).toEqual({ path: "café.hueke" });
  });
});
