import assert from "node:assert/strict";
import { test } from "node:test";
import {
  codeNavigation,
  entryPoint,
  JS_EDITED,
  JS_ONLY_IN_SRC,
  JS_REMOVED,
  JS_SKIPPED,
  JS_WRAPPER,
  jsChangedLines,
  jsLayout,
  jsRemovedFiles,
  jsSkippedFiles,
  navigationContext,
} from "../navigation.ts";
import { countLibraryLines } from "../lines.ts";
import { newScan, scanFiles } from "../source.ts";
import type { Target } from "../web/types.ts";

const root = "sdk/x/x";

test("the package layout decides how JavaScript code is judged", () => {
  assert.equal(jsLayout(root, [`${root}/src/index.ts`]), "none");
  assert.equal(jsLayout(root, [`${root}/src/generated/a.ts`, `${root}/src/a.ts`]), "wrapper");
  assert.equal(jsLayout(root, [`${root}/generated/a.ts`, `${root}/src/a.ts`]), "merge");
  const none = navigationContext("javascript", [`${root}/src/client.ts`], root);
  assert.equal(entryPoint("javascript", `${root}/src/client.ts`, none), "");
  const wrapper = navigationContext(
    "javascript",
    [`${root}/src/generated/a.ts`, `${root}/src/blob.ts`],
    root,
  );
  assert.equal(entryPoint("javascript", `${root}/src/generated/a.ts`, wrapper), "");
  assert.equal(entryPoint("javascript", `${root}/src/blob.ts`, wrapper), JS_WRAPPER);
  const merge = { ...navigationContext("javascript", [`${root}/generated/a.ts`], root) };
  merge.jsSkipped = ["src/index.ts"];
  assert.equal(entryPoint("javascript", `${root}/src/a.ts`, merge), JS_EDITED);
  assert.equal(entryPoint("javascript", `${root}/src/index.ts`, merge), JS_SKIPPED);
  assert.equal(entryPoint("javascript", `${root}/generated/a.ts`, merge), "");
});

test("--skip files are read from customization apply scripts", () => {
  assert.deepEqual(
    jsSkippedFiles(
      JSON.stringify({
        scripts: {
          "generate:client":
            "tsp-client update && dev-tool customization apply -s ./generated --skip index.ts --skip=src/odata.ts",
          other: "echo --skip nope.ts",
        },
      }),
    ),
    ["src/index.ts", "src/odata.ts"],
  );
  assert.deepEqual(jsSkippedFiles("not json"), []);
});

test("only real edits to a generated file count, not lint or formatting", () => {
  const generated = [
    "// Copyright (c) Microsoft Corporation.",
    'import { Client } from "@azure-rest/core-client";',
    'import { KeyItem } from "./models.js";',
    "export function list(client: Client) {",
    '  const userAgent = "azsdk-js-keyvault-keys/4.9.0";',
    "  return client.path('/keys').get();",
    "}",
    "export function remove(client: Client) {",
    "  return client.path('/keys').delete();",
    "}",
    "",
  ].join("\n");
  const lintOnly = generated
    .replace(
      "// Copyright (c) Microsoft Corporation.",
      "// Copyright (c) Microsoft.\n/* eslint-disable */",
    )
    .replace("import { KeyItem }", "import type { KeyItem }")
    .replace("4.9.0", "4.10.0-beta.1")
    .replace("  return client.path('/keys').get();", "    return client.path('/keys').get();");
  assert.deepEqual(jsChangedLines(lintOnly, generated), { added: [], removedAt: [] });
  const edited = generated
    .replace(
      "  return client.path('/keys').get();",
      "  return client.path('/keys').get({ maxresults: 25 });",
    )
    .replace(
      "export function remove(client: Client) {\n  return client.path('/keys').delete();\n}\n",
      "",
    );
  const { added, removedAt } = jsChangedLines(edited, generated);
  assert.deepEqual(added, [6]);
  assert.equal(removedAt.length, 1);
  const context = navigationContext("javascript", [`${root}/generated/keys.ts`], root);
  const link = codeNavigation("javascript", `${root}/src/keys.ts`, edited, generated, context);
  assert.ok(link?.provenance.startsWith(JS_EDITED));
  assert.equal(link?.startLine, 6);
  assert.equal(
    codeNavigation("javascript", `${root}/src/keys.ts`, lintOnly, generated, context),
    null,
  );
  const only = codeNavigation(
    "javascript",
    `${root}/src/odata.ts`,
    "export const odata = 1;\n",
    undefined,
    context,
  );
  assert.equal(only?.provenance, JS_ONLY_IN_SRC);
});

test("files only in generated/ are removals unless their users never reached src/", () => {
  const paths = [
    `${root}/generated/index.ts`,
    `${root}/generated/restorePollerHelpers.ts`,
    `${root}/generated/api/operations.ts`,
    `${root}/generated/static-helpers/getBinaryResponse.ts`,
    `${root}/generated/api/newFeature.ts`,
    `${root}/generated/static-helpers/newHelper.ts`,
    `${root}/src/index.ts`,
    `${root}/src/api/operations.ts`,
  ];
  const texts = new Map([
    [
      `${root}/generated/index.ts`,
      'export { restorePoller } from "./restorePollerHelpers.js";\nexport * from "./api/newFeature.js";\n',
    ],
    [
      `${root}/generated/api/operations.ts`,
      'import { getBinaryResponse } from "../static-helpers/getBinaryResponse.js";\n',
    ],
    [
      `${root}/generated/api/newFeature.ts`,
      'import { help } from "../static-helpers/newHelper.js";\n',
    ],
  ]);
  const { removed, gaps } = jsRemovedFiles(root, paths, texts);
  assert.deepEqual(removed.sort(), [
    `${root}/generated/api/newFeature.ts`,
    `${root}/generated/restorePollerHelpers.ts`,
    `${root}/generated/static-helpers/getBinaryResponse.ts`,
  ]);
  assert.deepEqual(gaps, [`${root}/generated/static-helpers/newHelper.ts`]);
});

test("a merge-flow scan records its layout, removals, gaps and changed-line evidence", async () => {
  const target = {
    language: "javascript",
    package: "@azure/x",
    repo: "Azure/azure-sdk-for-js",
    root,
    moduleMajor: 1,
  } as Target;
  const generated =
    "export function a() {\n  return 1;\n}\nexport function b() {\n  return 2;\n}\n";
  const src = "export function a() {\n  return 1;\n}\nexport function b() {\n  return 3;\n}\n";
  const contents: Record<string, string> = {
    [`${root}/package.json`]: JSON.stringify({
      scripts: { customize: "dev-tool customization apply --skip index.ts" },
    }),
    [`${root}/generated/ops.ts`]: generated,
    [`${root}/src/ops.ts`]: src,
    [`${root}/generated/index.ts`]: 'export * from "./ops.js";\nexport * from "./gone.js";\n',
    [`${root}/src/index.ts`]: 'export * from "./ops.js";\n',
    [`${root}/generated/gone.ts`]: "export const gone = 1;\n",
    [`${root}/src/extra.ts`]: "export const extra = 1;\n",
  };
  const files = Object.entries(contents).map(([path, text]) => ({
    path,
    sha: path,
    mode: "100644",
    size: Buffer.byteLength(text),
  }));
  const scan = newScan(target);
  await scanFiles(scan, files, async (file) => contents[file.path], {
    review: { budget: 40000, maxChunk: 24000 },
  });
  assert.equal(scan.provenance.jsGeneratedRule, "layout");
  assert.equal(scan.provenance.jsLayout, "merge");
  const byPath = new Map(scan.navigation!.map((link) => [link.path.slice(root.length + 1), link]));
  assert.ok(byPath.get("src/ops.ts")!.provenance.startsWith(JS_EDITED));
  assert.equal(byPath.get("src/index.ts")!.provenance, JS_SKIPPED);
  assert.equal(byPath.get("src/extra.ts")!.provenance, JS_ONLY_IN_SRC);
  assert.equal(byPath.get("generated/gone.ts")!.provenance, JS_REMOVED);
  assert.equal(scan.provenance.jsMergeGaps, undefined);
  const ops = scan.evidence.find((item) => item.path.endsWith("src/ops.ts"))!;
  assert.equal(ops.excerpt, true);
  assert.ok(ops.text.includes("return 3"));
  assert.notEqual(ops.kind, "generated");
  assert.ok(!scan.evidence.some((item) => item.path.includes("/generated/")));
  // Lines: one changed line in ops.ts, the --skip index.ts and extra.ts in full, none for gone.ts.
  const lines = countLibraryLines(target, new Map(Object.entries(contents)), scan.navigation!);
  assert.equal(lines.handwritten, 3);
});
