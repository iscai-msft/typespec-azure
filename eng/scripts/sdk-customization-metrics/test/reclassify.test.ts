import assert from "node:assert/strict";
import { test } from "node:test";
import { readPatternAliases, reclassify } from "../store.ts";

const finding = (id: string, pattern: string, category: string, generatorAddressable = "yes") =>
  ({ id, pattern, category, generatorAddressable, finding: { pattern, category } }) as never;

test("pattern rules apply through catalog aliases; a finding's own entry wins", () => {
  const aliases = new Map([
    ["backward-compatibility-shim", "backward-compatibility-shim"],
    ["obsolete-empty-pageable", "backward-compatibility-shim"],
  ]);
  const files = [
    {
      patterns: [],
      findings: {
        b: { pattern: "obsolete-empty-pageable", reason: "r", note: "n", category: "Other" },
      },
      patternRules: {
        "backward-compatibility-shim": {
          reason: "backcompat",
          category: "Backward compatibility",
          generatorAddressable: "no" as const,
        },
      },
    },
  ];
  const [a, b, c, d] = reclassify(
    [
      finding("a", "obsolete-empty-pageable", "Pagination"),
      finding("b", "x", "Pagination"),
      finding("c", "lro-poller", "LRO / polling"),
      finding("d", "backward-compatibility-shim", "Backward compatibility", "no"),
    ],
    files,
    aliases,
  ) as unknown as { category: string; generatorAddressable: string; pattern: string }[];
  assert.deepEqual([a.category, a.generatorAddressable], ["Backward compatibility", "no"]);
  assert.deepEqual(
    [b.pattern, b.category, b.generatorAddressable],
    ["obsolete-empty-pageable", "Other", "no"],
  );
  assert.equal(c.category, "LRO / polling");
  assert.equal((d as { reclassified?: unknown }).reclassified, undefined);
});

test("no catalog id uses words the naming rule forbids, and old ids still resolve", async () => {
  const aliases = await readPatternAliases();
  const ids = new Set(aliases.values());
  assert.deepEqual(
    [...ids].filter((id) => /custom|handwritten|manual/.test(id)),
    [],
  );
  assert.equal(aliases.get("lro-custom-poller"), "lro-poller");
  assert.equal(aliases.get("handwritten-client-over-generated"), "client-over-generated");
});
