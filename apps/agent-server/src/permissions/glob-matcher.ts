/** Minimal glob matcher supporting `*` (single segment wildcard) and `**` (any depth), sufficient for path-prefix style permission rules. */
export function matchesGlob(pattern: string, value: string): boolean {
  const normalizedPattern = pattern.replace(/\\/g, "/");
  const normalizedValue = value.replace(/\\/g, "/");

  const regex = globToRegExp(normalizedPattern);
  return regex.test(normalizedValue);
}

function globToRegExp(pattern: string): RegExp {
  let result = "^";
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i];
    if (char === "*" && pattern[i + 1] === "*") {
      result += ".*";
      i++;
      if (pattern[i + 1] === "/") i++;
    } else if (char === "*") {
      result += "[^/]*";
    } else if (char === "?") {
      result += "[^/]";
    } else if (".+^${}()|[]\\".includes(char!)) {
      result += `\\${char}`;
    } else {
      result += char;
    }
  }
  result += "$";
  return new RegExp(result);
}
