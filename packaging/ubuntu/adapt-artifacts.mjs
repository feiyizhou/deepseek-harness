/** Apply the pinned Linux account mapping to compiled output, with structural drift detection. */

/**
 * Replace the account view's macOS fallback with the existing web platform value on Linux.
 * @param {string} code - Official desktop main bundle.
 * @param {typeof import('typescript')} ts - Upstream compiler's syntax parser.
 * @returns {string} Adapted bundle; rejects missing, changed or duplicate account constructors.
 */
export function adaptLinuxAccountPlatform(code, ts) {
  const file = ts.createSourceFile('main.js', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
  const matches = []
  function visit(node) {
    if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'DesktopPlatformView') {
      const argument = node.arguments?.[2]
      if (node.arguments?.length !== 3 || !argument || !ts.isConditionalExpression(argument)
        || argument.condition.getText(file).replace(/\s+/gu, '') !== 'process.platform==="win32"'
        || !ts.isStringLiteral(argument.whenTrue) || argument.whenTrue.text !== 'win32'
        || !ts.isStringLiteral(argument.whenFalse) || argument.whenFalse.text !== 'darwin') {
        throw new Error('Linux account adapter: upstream platform expression changed; review before packaging')
      }
      matches.push({ start: argument.whenFalse.getStart(file), end: argument.whenFalse.end })
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  if (matches.length !== 1) throw new Error(`Linux account adapter: expected one constructor, found ${matches.length}`)
  const { start, end } = matches[0]
  return `${code.slice(0, start)}process.platform === "darwin" ? "darwin" : null${code.slice(end)}`
}
