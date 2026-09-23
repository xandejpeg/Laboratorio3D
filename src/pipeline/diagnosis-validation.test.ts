import { expect, test } from "bun:test";
import { validateDiagnosis } from "./diagnosis-validation.ts";

test("truncated and unstructured critic replies cannot approve geometry", () => {
  for (const response of ["Looks good.", "SUMMARY: all good", "SUMMARY: Fine\nISSUES:", "SUMMARY: unclear\nISSUES: see above", "SUMMARY: bad\nISSUES:\n1. [HIGH] missing hand"]) {
    expect(validateDiagnosis(response).valid).toBe(false);
  }
});

test("accepts the upstream explicit clean review and structured issues", () => {
  expect(validateDiagnosis("SUMMARY: matches\nISSUES: (none — current build matches the reference within tolerance)").valid).toBe(true);
  expect(validateDiagnosis("SUMMARY: hand missing\nISSUES:\n1. [HIGH] [modules: (new:hand) attach_to: arm] Hand absent. FIX: Attach a hand.").valid).toBe(true);
  expect(validateDiagnosis("SUMMARY: slight mismatch\nISSUES:\n1. [MED] [modules: foot] Toe long. FIX: Shorten toe.").valid).toBe(true);
});

test("contradictory clean review with HIGH entries is invalid", () => {
  expect(validateDiagnosis("SUMMARY: clean\nISSUES: none\n1. [HIGH] [modules: face] Face missing. FIX: Add face.").valid).toBe(false);
});

test("a negative sentence beginning with none cannot approve geometry", () => {
  expect(validateDiagnosis("SUMMARY: failed\nISSUES: none of the geometry resembles the reference").valid).toBe(false);
});

test("a valid lower severity issue cannot mask a truncated or malformed later issue", () => {
  const prefix = "SUMMARY: mismatches\nISSUES:\n1. [MED] [modules: foot] Toe long. FIX: Shorten toe.\n";
  for (const tail of ["2. [HIG", "2. HIGH missing hand", "2. [HIGH] [modules: ] Hand missing. FIX: Add hand.", "2. [HIGH] [modules: hand] Missing. FIX:"]) {
    expect(validateDiagnosis(prefix + tail).valid).toBe(false);
  }
});

test("severity comes from the validated section even when the first issue is inline", () => {
  expect(validateDiagnosis("SUMMARY: hand missing\nISSUES: [HIGH] [modules: arm] Hand absent. FIX: Attach a hand."))
    .toEqual({ valid: true, hasHigh: true });
  expect(validateDiagnosis("SUMMARY: toe long\r\n\r\nISSUES: 1. [MED] [modules: foot] Toe long. FIX: Shorten toe."))
    .toEqual({ valid: true, hasHigh: false });
});

test("the whole response must follow the summary and issues contract", () => {
  for (const response of [
    "SUMMARY: \nISSUES: none",
    "SUMMARY: clean\nISSUES: none\nSUMMARY: actually failed",
    "ISSUES: none\nSUMMARY: clean",
    "SUMMARY: clean\nextra warning\nISSUES: none",
  ]) expect(validateDiagnosis(response).valid).toBe(false);
});
