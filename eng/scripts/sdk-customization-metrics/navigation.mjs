export function entryPoint(language, path) {
  if (/(?:^|\/)(?:generated|tests?|samples?[^/]*|GeneratorStubs|Properties)(?:\/|$)/i.test(path))
    return "";
  if (language === "python" && /(?:^|\/)_patch\.py$/.test(path)) return "Python patch";
  if (language === "java" && /\/customizations?\/.*\.java$/.test(path))
    return "Java customization script";
  if (language === "dotnet" && /\/src\/.*\.cs$/.test(path) && !/GlobalSuppressions\.cs$/.test(path))
    return "C# handwritten source candidate";
  if (language === "javascript" && /\/src\/.*\.[jt]s$/.test(path))
    return "JavaScript source overlay candidate";
  if (language === "go" && /\/custom[^/]*\.go$/.test(path) && !/_test\.go$/.test(path))
    return "Go custom source";
  return "";
}

export function codeNavigation(language, path, text, baseline) {
  const provenance = entryPoint(language, path);
  if (
    !provenance ||
    /auto[- ]generated|automatically generated|code generated|@Generated\b/i.test(
      text.slice(0, 6000),
    )
  )
    return null;
  const strip = (value) =>
    value
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*(?:\/\/|#).*$/gm, "")
      .trim();
  const code = strip(text);
  const comparable = (value) =>
    strip(value)
      .replace(/\bextends\s*\|/g, "extends ")
      .replace(/([:=<(,])\s*\|/g, "$1")
      .replace(/azsdk-js-[\w-]+\/[\d.]+(?:-[\w.]+)?/g, "azsdk-js-PACKAGE/VERSION")
      .replace(/\s/g, "");
  if (baseline !== undefined && comparable(text) === comparable(baseline)) return null;
  const pythonCode = code.replace(/"""[\s\S]*?"""|'''[\s\S]*?'''/g, "");
  const hasPythonBody =
    /^[ \t]*(?:async\s+)?def\s+\w+\([\s\S]*?\)(?:[ \t]*->[^\n:]+)?[ \t]*:[ \t]*\n(?:[ \t]*\n)*[ \t]+(?!pass\b|return[ \t]*(?:None)?[ \t]*$)\S/m.test(
      pythonCode,
    );
  const substantive =
    language === "python"
      ? hasPythonBody
      : language === "java"
        ? /\.\s*(?:replaceBody|addMethod|addClass|addAnnotation|rename|removeMethod|setReturnType|insertBefore|insertAfter|customize)\s*\(/.test(
            code,
          )
        : language === "dotnet"
          ? /\b(?:class|struct|enum|interface)\s+\w+/.test(code)
          : language === "go"
            ? /\b(?:func|type)\s+\w+/.test(code)
            : /\b(?:function|class|const|interface|type)\s+\w+/.test(code);
  if (!substantive) return null;
  return {
    path,
    startLine: 1,
    endLine: text.split("\n").length - (text.endsWith("\n") ? 1 : 0),
    provenance,
  };
}
