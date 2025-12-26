// Basic PineScript syntax validation
// Note: Full compilation requires TradingView's compiler (browser-based)

export interface PineSyntaxError {
  line: number;
  column: number;
  message: string;
  severity: "error" | "warning";
}

export interface PineSyntaxResult {
  valid: boolean;
  errors: PineSyntaxError[];
  warnings: PineSyntaxError[];
  version: number | null;
  type: "indicator" | "strategy" | "library" | null;
}

/**
 * Basic PineScript syntax validation
 * Checks for common issues without full compilation
 */
export function validatePineSyntax(code: string): PineSyntaxResult {
  const errors: PineSyntaxError[] = [];
  const warnings: PineSyntaxError[] = [];
  const lines = code.split("\n");

  // Detect version
  let version: number | null = null;
  const versionMatch = code.match(/\/\/@version=(\d+)/);
  if (versionMatch) {
    version = parseInt(versionMatch[1]);
  } else {
    warnings.push({
      line: 1,
      column: 1,
      message: "No @version directive found. Consider adding //@version=6",
      severity: "warning",
    });
  }

  // Detect script type
  let type: "indicator" | "strategy" | "library" | null = null;
  if (code.includes("indicator(")) type = "indicator";
  else if (code.includes("strategy(")) type = "strategy";
  else if (code.includes("library(")) type = "library";

  if (!type) {
    errors.push({
      line: 1,
      column: 1,
      message: "Missing script type declaration (indicator, strategy, or library)",
      severity: "error",
    });
  }

  // Check for common syntax issues
  lines.forEach((line, idx) => {
    const lineNum = idx + 1;
    const trimmed = line.trim();

    // Skip comments
    if (trimmed.startsWith("//")) return;

    // Check for mismatched parentheses
    const openParens = (line.match(/\(/g) || []).length;
    const closeParens = (line.match(/\)/g) || []).length;
    if (openParens !== closeParens) {
      // Only warn if significant mismatch and not a multi-line statement
      if (Math.abs(openParens - closeParens) > 2) {
        warnings.push({
          line: lineNum,
          column: 1,
          message: `Possible mismatched parentheses (${openParens} open, ${closeParens} close)`,
          severity: "warning",
        });
      }
    }

    // Check for mismatched brackets
    const openBrackets = (line.match(/\[/g) || []).length;
    const closeBrackets = (line.match(/\]/g) || []).length;
    if (openBrackets !== closeBrackets && Math.abs(openBrackets - closeBrackets) > 1) {
      warnings.push({
        line: lineNum,
        column: 1,
        message: `Possible mismatched brackets`,
        severity: "warning",
      });
    }

    // Check for deprecated Pine v4 syntax in v5+ code
    if (version && version >= 5) {
      if (/\bsecurity\s*\(/.test(line)) {
        warnings.push({
          line: lineNum,
          column: line.indexOf("security"),
          message: "security() is deprecated in Pine v5+. Use request.security()",
          severity: "warning",
        });
      }
      if (/\bstudy\s*\(/.test(line)) {
        warnings.push({
          line: lineNum,
          column: line.indexOf("study"),
          message: "study() is deprecated in Pine v5+. Use indicator()",
          severity: "warning",
        });
      }
    }

    // Check for common typos
    if (/\bcloce\b/.test(line)) {
      errors.push({
        line: lineNum,
        column: line.indexOf("cloce"),
        message: "Possible typo: 'cloce' should be 'close'",
        severity: "error",
      });
    }
    if (/\bopne\b/.test(line)) {
      errors.push({
        line: lineNum,
        column: line.indexOf("opne"),
        message: "Possible typo: 'opne' should be 'open'",
        severity: "error",
      });
    }

    // Check for empty plot() calls
    if (/\bplot\s*\(\s*\)/.test(line)) {
      errors.push({
        line: lineNum,
        column: line.indexOf("plot"),
        message: "plot() requires at least one argument",
        severity: "error",
      });
    }

    // Check for strategy-specific issues
    if (type === "strategy") {
      // Check for entry without exit
      if (/strategy\.(entry|close|exit)/.test(line)) {
        // Just note it exists
      }
    }
  });

  // Check for strategy without any entries
  if (type === "strategy" && !code.includes("strategy.entry") && !code.includes("strategy.order")) {
    warnings.push({
      line: 1,
      column: 1,
      message: "Strategy has no entry orders (strategy.entry or strategy.order)",
      severity: "warning",
    });
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    version,
    type,
  };
}

/**
 * Format PineScript code for better readability
 * (Basic formatting - indentation, spacing)
 */
export function formatPineScript(code: string): string {
  const lines = code.split("\n");
  let indentLevel = 0;
  const indentStr = "    "; // 4 spaces

  return lines.map(line => {
    const trimmed = line.trim();

    // Decrease indent for closing blocks
    if (/^(else|endif|endfor|endwhile)/.test(trimmed)) {
      indentLevel = Math.max(0, indentLevel - 1);
    }

    const formatted = indentStr.repeat(indentLevel) + trimmed;

    // Increase indent for opening blocks
    if (/\b(if|for|while)\s*$/.test(trimmed) || /=>\s*$/.test(trimmed)) {
      indentLevel++;
    }

    return formatted;
  }).join("\n");
}
