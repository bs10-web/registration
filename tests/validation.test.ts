import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { normalizeStudentId, parseStudentWorkbook, seoulDateInput, seoulInputToIso } from "../src/lib/validation";

async function workbookFile(rows: unknown[][], name = "students.xlsx") {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("학생 등록");
  rows.forEach((row) => sheet.addRow(row));
  const bytes = await workbook.xlsx.writeBuffer();
  const file = new Blob([new Uint8Array(bytes)], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  Object.defineProperty(file, "name", { value: name });
  return file as File;
}

describe("student roster validation", () => {
  it("preserves leading zeroes for numeric and text student IDs", () => {
    expect(normalizeStudentId(1234)).toBe("01234");
    expect(normalizeStudentId("01234")).toBe("01234");
    expect(normalizeStudentId(100000)).toBe("100000");
  });

  it("uses physical Excel row numbers and rejects duplicate IDs", async () => {
    const file = await workbookFile([
      ["학번", "이름", "전용코드"],
      [1234, "학생", "code-1"],
      [],
      [1234, "다른 학생", "code-2"],
      [100000, "학생", "code-3"],
    ]);
    const result = await parseStudentWorkbook(file);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].studentId).toBe("01234");
    expect(result.errors.map((error) => error.row)).toEqual([4, 5]);
  });

  it("rejects non-XLSX files", async () => {
    const file = await workbookFile([["학번", "이름", "전용코드"]], "students.csv");
    await expect(parseStudentWorkbook(file)).rejects.toThrow(".xlsx");
  });

  it("converts date-time inputs in Korea Standard Time", () => {
    expect(seoulInputToIso("2027-03-01T09:30")).toBe("2027-03-01T00:30:00.000Z");
    expect(seoulDateInput("2027-03-01T00:30:00.000Z")).toBe("2027-03-01T09:30");
  });
});
