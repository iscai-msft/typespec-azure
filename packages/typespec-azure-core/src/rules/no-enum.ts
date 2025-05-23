import {
  CodeFix,
  Enum,
  createRule,
  getPositionBeforeTrivia,
  getSourceLocation,
  paramMessage,
} from "@typespec/compiler";
import {
  type EnumMemberNode,
  type EnumSpreadMemberNode,
  EnumStatementNode,
  type Node,
  SyntaxKind,
  type TypeSpecScriptNode,
} from "@typespec/compiler/ast";
import { getVersionsForEnum } from "@typespec/versioning";
export const noEnumRule = createRule({
  name: "no-enum",
  description: "Azure services should not use enums.",
  severity: "warning",
  url: "https://azure.github.io/typespec-azure/docs/libraries/azure-core/rules/no-enum",
  messages: {
    default: paramMessage`Azure services should not use the enum keyword. Extensible enums should be defined as unions with "string" as an accepted variant (ex: \`union Choice { Yes: "yes", No: "no", string };\`).`,
  },
  create(context) {
    return {
      enum: (en: Enum) => {
        const [_, versions] = getVersionsForEnum(context.program, en);
        if (versions !== undefined && versions.getVersions()[0].enumMember.enum === en) {
          return;
        }

        if (en.node === undefined) {
          return;
        }

        context.reportDiagnostic({
          format: { enumName: en.name },
          target: en,
          codefixes: [createEnumToExtensibleUnionCodeFix(en as Enum & { node: EnumStatementNode })],
        });
      },
    };
  },
});

function createEnumToExtensibleUnionCodeFix(en: Enum & { node: EnumStatementNode }): CodeFix {
  function convertEnumMemberToUnionVariant(node: EnumMemberNode | EnumSpreadMemberNode) {
    switch (node.kind) {
      case SyntaxKind.EnumSpreadMember:
        return getSourceLocation(node.target).file.text.slice(node.target.pos, node.target.end);
      case SyntaxKind.EnumMember:
        return node.value
          ? `${node.id.sv}: ${
              node.value.kind === SyntaxKind.NumericLiteral
                ? node.value.value
                : `"${node.value.value}"`
            }`
          : `${node.id.sv}: "${node.id.sv}"`;
    }
  }

  return {
    id: "enum-to-extensible-union",
    label: "Convert to extensible union",
    fix(context) {
      const type = typeof [...en.members.values()][0].value === "number" ? "number" : "string";
      const indent = getIndent(en.node);
      const script = getTypeSpecScript(en.node);
      if (script === undefined) {
        return [];
      }
      return [
        context.replaceText(
          getSourceLocation(en.node),
          [
            getNodeAnnotations(en.node),
            `union ${en.name} {\n`,
            `${indent}  `,
            `${type},\n`,
            ...en.node.members.map((member) => {
              return `${getNodeTrivia(script, member)}${getNodeAnnotations(
                member,
              )}${convertEnumMemberToUnionVariant(member)},`;
            }),
            getNodeTrivia(script, en.node.end - 1),
            "}",
          ].join(""),
        ),
      ];
    },
  };
}

function getIndent(node: Node) {
  const source = getSourceLocation(node).file.text;
  const start = source.lastIndexOf("\n", node.pos);
  return source.slice(start + 1, node.pos);
}

function getTypeSpecScript(node: Node): TypeSpecScriptNode | undefined {
  let root = node;

  while (root.parent !== undefined) {
    root = root.parent;
  }
  if (root.kind !== SyntaxKind.TypeSpecScript) {
    return undefined;
  }
  return root;
}

function getNodeTrivia(root: TypeSpecScriptNode, node: Node | number): string {
  const end = typeof node === "number" ? node : node.pos;
  const pos = getPositionBeforeTrivia(root, end);
  return root.file.text.slice(pos, end);
}

function getNodeAnnotations(node: Node): string {
  const source = getSourceLocation(node).file.text;

  let endOfTrivia = node.pos;
  for (const directive of node.directives ?? []) {
    if (directive.end > endOfTrivia) {
      endOfTrivia = directive.end;
    }
  }
  for (const doc of node.docs ?? []) {
    if (doc.end > endOfTrivia) {
      endOfTrivia = doc.end;
    }
  }
  if ("decorators" in node) {
    for (const dec of node.decorators ?? []) {
      if (dec.end > endOfTrivia) {
        endOfTrivia = dec.end;
      }
    }
  }

  for (let i = endOfTrivia; i < node.end; i++) {
    if (source[i] === " " || source[i] === "\n") {
      endOfTrivia = i + 1;
    } else {
      break;
    }
  }

  return getSourceLocation(node).file.text.slice(node.pos, endOfTrivia);
}
