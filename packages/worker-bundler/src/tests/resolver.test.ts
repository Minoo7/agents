import { describe, expect, it } from "vitest";
import { InMemoryFileSystem } from "../file-system";
import { resolveModule } from "../resolver";

const root = "node_modules/fixture";
const manifest = (entry: Record<string, unknown>) => JSON.stringify(entry);

describe("directory package manifests", () => {
  it.each([
    { module: "./esm/entry", main: "./cjs/entry" },
    { main: "./esm/entry" }
  ])("resolves nested module and main entries: %j", (entry) => {
    const files = new InMemoryFileSystem({
      [`${root}/package.json`]: manifest({ name: "fixture", main: "index.js" }),
      [`${root}/index.js`]: "export default 'root';",
      [`${root}/constants/package.json`]: manifest(entry),
      [`${root}/constants/esm/entry.js`]: "export default 'esm';",
      [`${root}/constants/cjs/entry.js`]: "export default 'cjs';",
      [`${root}/constants/index.js`]: "export default 'index';"
    });
    expect(resolveModule("fixture/constants", { files })).toEqual({
      path: `${root}/constants/esm/entry.js`,
      external: false
    });
  });

  it.each([
    { module: "../dist/es2015/constants", main: "../dist/es5/constants.js" },
    { main: "../dist/es2015/constants" }
  ])(
    "resolves parent-relative targets and chained directory manifests: %j",
    (entry) => {
      const files = new InMemoryFileSystem({
        [`${root}/package.json`]: manifest({ name: "fixture" }),
        [`${root}/constants/package.json`]: manifest(entry),
        [`${root}/dist/es2015/constants/package.json`]: manifest({
          main: "./value"
        }),
        [`${root}/dist/es2015/constants/value.js`]: "export default 'esm';",
        [`${root}/dist/es5/constants.js`]: "export default 'cjs';"
      });
      expect(resolveModule("fixture/constants", { files })).toEqual({
        path: `${root}/dist/es2015/constants/value.js`,
        external: false
      });
    }
  );

  it.each(["", ".js"])(
    "prefers a file with suffix '%s' over a directory",
    (suffix) => {
      const files = new InMemoryFileSystem({
        [`${root}/package.json`]: manifest({ name: "fixture" }),
        [`${root}/constants${suffix}`]: "export default 'file';",
        [`${root}/constants/package.json`]: manifest({ main: "./entry.js" }),
        [`${root}/constants/entry.js`]: "export default 'directory';"
      });
      expect(resolveModule("fixture/constants", { files }).path).toBe(
        `${root}/constants${suffix}`
      );
    }
  );

  it("falls back to index when the manifest target is missing", () => {
    const files = new InMemoryFileSystem({
      [`${root}/package.json`]: manifest({ name: "fixture" }),
      [`${root}/constants/package.json`]: manifest({ main: "./missing" }),
      [`${root}/constants/index.js`]: "export default 'index';"
    });
    expect(resolveModule("fixture/constants", { files })).toEqual({
      path: `${root}/constants/index.js`,
      external: false
    });
  });

  it.each([".", "./loop/..", "../other"])(
    "terminates manifest cycles through %s",
    (main) => {
      const files = new InMemoryFileSystem({
        [`${root}/package.json`]: manifest({ name: "fixture" }),
        [`${root}/constants/package.json`]: manifest({ main }),
        [`${root}/other/package.json`]: manifest({ main: "../constants" })
      });
      expect(resolveModule("fixture/constants", { files })).toEqual({
        path: "fixture/constants",
        external: true
      });
      files.write(`${root}/constants/index.js`, "export default 'index';");
      expect(resolveModule("fixture/constants", { files }).path).toBe(
        `${root}/constants/index.js`
      );
    }
  );

  it.each([
    { ".": "./index.js" },
    { "./constants": null },
    { "./constants": "./public.js" }
  ])("keeps parent exports authoritative: %j", (exports) => {
    const files = new InMemoryFileSystem({
      [`${root}/package.json`]: manifest({ name: "fixture", exports }),
      [`${root}/constants/package.json`]: manifest({ main: "./private.js" }),
      [`${root}/constants/private.js`]: "export default 'private';",
      [`${root}/public.js`]: "export default 'public';"
    });
    expect(resolveModule("fixture/constants", { files })).toEqual(
      exports["./constants"] === "./public.js"
        ? { path: `${root}/public.js`, external: false }
        : { path: "fixture/constants", external: true }
    );
  });

  it("uses style entries only under the style condition", () => {
    const files = new InMemoryFileSystem({
      [`${root}/package.json`]: manifest({ name: "fixture" }),
      [`${root}/constants/package.json`]: manifest({
        style: "../style.css",
        module: "./entry.js"
      }),
      [`${root}/style.css`]: "body {}",
      [`${root}/constants/entry.js`]: "export default 'js';"
    });
    expect(resolveModule("fixture/constants", { files }).path).toBe(
      `${root}/constants/entry.js`
    );
    expect(
      resolveModule("fixture/constants", {
        files,
        conditions: ["style", "browser"]
      }).path
    ).toBe(`${root}/style.css`);
  });

  it("applies directory manifests to relative imports with custom extensions", () => {
    const files = new InMemoryFileSystem({
      "src/constants/package.json": manifest({ main: "../styles/constants" }),
      "src/styles/constants.css": "body {}"
    });
    expect(
      resolveModule("./constants", {
        files,
        importer: "src/main.js",
        extensions: [".css"]
      })
    ).toEqual({ path: "src/styles/constants.css", external: false });
  });
});
