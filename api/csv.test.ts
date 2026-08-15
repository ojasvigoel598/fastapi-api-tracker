import { describe, expect, it } from "vitest";
import { csvCell } from "./lib/csv";

describe("csvCell", () => {
  it("quotes fields containing commas, quotes, or newlines", () => {
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("line1\nline2")).toBe('"line1\nline2"');
    expect(csvCell("plain")).toBe("plain");
  });

  it("doubles embedded double quotes (RFC 4180)", () => {
    expect(csvCell('he said "no"')).toBe('"he said ""no"""');
  });

  it("neutralizes spreadsheet formula injection", () => {
    expect(csvCell("=SUM(A1:A9)")).toBe("'=SUM(A1:A9)");
    expect(csvCell("+cmd")).toBe("'+cmd");
    expect(csvCell("-1+1")).toBe("'-1+1");
    expect(csvCell("@import")).toBe("'@import");
  });

  it("handles empty and numeric values", () => {
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
    expect(csvCell(0)).toBe("0");
    expect(csvCell(42)).toBe("42");
  });
});
