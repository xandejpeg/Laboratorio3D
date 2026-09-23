export type DiagnosisValidation =
  | { valid: true; hasHigh: boolean }
  | { valid: false; reason: string };

/** A missing/partial critic response must never count as a clean review. */
export function validateDiagnosis(text: string): DiagnosisValidation {
  const sections = /^SUMMARY:[ \t]*([^\r\n]+)\r?\n[ \t\r\n]*ISSUES:[ \t]*([\s\S]*)$/i.exec(text.trim());
  const issues = sections?.[2]?.trim();
  if (!sections?.[1]?.trim() || !issues) {
    return { valid: false, reason: "Critic response is missing a non-empty SUMMARY or ISSUES section." };
  }
  // Match an explicit clean declaration, never arbitrary prose beginning
  // with 'none' (e.g. 'none of the geometry matches the reference').
  if (/^(?:none|\(none\)|\(none[ \t]*[—–-][ \t]*current build matches the reference within tolerance\))\.?$/i.test(issues)) {
    return { valid: true, hasHigh: false };
  }
  const entries = issues.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  let hasHigh = false;
  for (const line of entries) {
    // Validate every nonempty line so a complete MED entry cannot hide a
    // later truncated HIGH entry. The prompt requests one line per issue.
    const entry = /^(?:\d+[.)]|[-*])?[ \t]*\[(HIGH|MED|LOW)\][ \t]*\[modules:[ \t]*([^\]]+)\][ \t]*(.+?)[ \t]+FIX:[ \t]*(\S.*)$/i.exec(line);
    if (!entry || !entry[2]?.trim() || !entry[3]?.trim()) {
      return { valid: false, reason: "Critic response must explicitly declare no issues or supply severity, modules and FIX for each issue." };
    }
    hasHigh ||= entry[1]?.toUpperCase() === "HIGH";
  }
  return { valid: true, hasHigh };
}
