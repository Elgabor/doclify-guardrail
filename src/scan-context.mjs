function createFileScanContext({ absolutePath, relativePath, fileOptions, customRules }) {
  const options = Object.freeze({
    maxLineLength: fileOptions.maxLineLength,
    strict: fileOptions.strict,
    ignoreRules: new Set(fileOptions.ignoreRules),
    exclude: [...fileOptions.exclude],
    checkLinks: fileOptions.checkLinks,
    checkFreshness: fileOptions.checkFreshness,
    checkFrontmatter: fileOptions.checkFrontmatter,
    checkInlineHtml: fileOptions.checkInlineHtml,
    freshnessMaxDays: fileOptions.freshnessMaxDays,
    linkAllowList: [...fileOptions.linkAllowList],
    linkTimeoutMs: fileOptions.linkTimeoutMs,
    linkConcurrency: fileOptions.linkConcurrency,
    siteRoot: fileOptions.siteRoot
  });

  return Object.freeze({
    absolutePath,
    relativePath,
    options,
    customRules: Array.isArray(customRules) ? customRules : []
  });
}

export { createFileScanContext };
