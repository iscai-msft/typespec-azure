import assert from "node:assert/strict";
import { test } from "node:test";
import { deprecationIn, findDeprecations } from "../deprecation.ts";
import { libraryVariant, mergeLibraries } from "../web/data.ts";
import type { Inventory } from "../web/types.ts";

test("deprecation notices are read from READMEs and manifests", () => {
  assert.match(
    deprecationIn(
      "README.md",
      "# Azure X\n\n**Deprecation Notice**\n\nPlease note, this package has been deprecated and will no longer be maintained after 2026-03-13.\n",
    )!,
    /this package has been deprecated/,
  );
  assert.ok(deprecationIn("README.md", "> **DEPRECATED**: The service will be retired.\n"));
  // Mentions of other packages or retired models are not a notice.
  assert.equal(
    deprecationIn(
      "README.md",
      "Please note, this package is a replacement for `azure-cosmosdb-tables` which is now deprecated.\n",
    ),
    null,
  );
  assert.equal(
    deprecationIn("README.md", "> Please rely on the older library for retired models.\n"),
    null,
  );
  assert.ok(deprecationIn("setup.py", '    "Development Status :: 7 - Inactive",\n'));
  assert.equal(
    deprecationIn("setup.py", '    "Development Status :: 5 - Production/Stable",\n'),
    null,
  );
  assert.ok(deprecationIn("go.mod", "// Deprecated: use other instead.\nmodule x\n"));
  assert.ok(
    deprecationIn("pom.xml", "<description>This package has been deprecated.</description>"),
  );
  assert.ok(deprecationIn("package.json", '{"deprecated": "use @azure/x"}'));
  assert.equal(deprecationIn("package.json", "{}"), null);
});

test("deprecations are found per library and from npm", async () => {
  const inventory = {
    libraries: [
      { language: "python", package: "azure-x", repo: "a/py", root: "sdk/x/azure-x" },
      { language: "javascript", package: "@azure/y", repo: "a/js", root: "sdk/y/y" },
      { language: "javascript", package: "@azure/z", repo: "a/js", root: "sdk/z/z" },
    ],
  } as unknown as Inventory;
  const files: Record<string, Record<string, string>> = {
    "a/py": {
      "sdk/x/azure-x/setup.py": '"Development Status :: 7 - Inactive"',
      "sdk/x/azure-x/samples/README.md": "this package has been deprecated",
    },
    "a/js": { "sdk/y/y/package.json": "{}", "sdk/z/z/package.json": "{}" },
  };
  const repositoryFor = (repo: string) => ({
    sync: async () => "c",
    entries: async (_commit: string, prefix: string) =>
      Object.keys(files[repo])
        .filter((path) => path.startsWith(`${prefix}/`))
        .map((path) => ({ path, sha: path, mode: "100644", type: "blob" })),
    read: async (shas: string[]) => new Map(shas.map((sha) => [sha, files[repo][sha]])),
  });
  const fakeFetch = (async (url: string) =>
    String(url).endsWith("%2fy")
      ? new Response(
          JSON.stringify({
            "dist-tags": { latest: "2.0.0" },
            versions: { "2.0.0": { deprecated: "Use @azure/w" } },
          }),
        )
      : new Response("{}", { status: 404 })) as typeof fetch;
  const store = await findDeprecations(inventory, repositoryFor, { fetch: fakeFetch });
  assert.deepEqual(Object.keys(store.libraries), ["a/py:sdk/x/azure-x", "a/js:sdk/y/y"]);
  assert.equal(store.libraries["a/py:sdk/x/azure-x"].file, "setup.py");
  assert.equal(store.libraries["a/js:sdk/y/y"].file, "npm (2.0.0)");
  const rows = mergeLibraries(null, [], inventory, store);
  assert.deepEqual(
    rows.map((row) => Boolean(row.deprecated)),
    [true, true, false],
  );
});

test("a package published from two folders shows its folder", () => {
  assert.equal(
    libraryVariant({ id: "java:azure-security-keyvault-keys:module-v1:keyvault-v2" }),
    "keyvault-v2",
  );
  assert.equal(libraryVariant({ id: "java:azure-x:module-v1" }), null);
  assert.equal(libraryVariant({ id: "library:a/b:sdk/x" }), null);
});
