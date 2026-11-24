export type StudentRow = { studentId: string; name: string; code: string };
export type SpreadsheetError = { row: number; message: string };

export function normalizeStudentId(value: unknown): string {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 99999) {
    return String(value).padStart(5, "0");
  }
  const text = String(value ?? "").trim();
  return /^\d{1,5}$/.test(text) ? text.padStart(5, "0") : text;
}

export function parseStudentWorkbook(file: File): Promise<{ rows: StudentRow[]; errors: SpreadsheetError[] }> {
  if (!file.name.toLowerCase().endsWith(".xlsx")) return Promise.reject(new Error(".xlsx 파일만 업로드할 수 있습니다."));
  if (file.size > 2 * 1024 * 1024) return Promise.reject(new Error("엑셀 파일은 2MB 이하만 업로드할 수 있습니다."));
  return file.arrayBuffer().then(async (buffer) => {
    const ExcelJS = await import("exceljs");
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(buffer);
    const sheet = book.worksheets[0];
    if (!sheet) return { rows: [], errors: [{ row: 1, message: "시트를 찾을 수 없습니다." }] };
    const rows: StudentRow[] = [];
    const errors: SpreadsheetError[] = [];
    const seen = new Set<string>();
    const headers = [1, 2, 3].map((column) => sheet.getRow(1).getCell(column).text.trim());
    if (headers?.[0] !== "학번" || headers?.[1] !== "이름" || headers?.[2] !== "전용코드") {
      return { rows: [], errors: [{ row: 1, message: "열 제목은 학번, 이름, 전용코드 순서여야 합니다." }] };
    }
    sheet.eachRow((worksheetRow, rowNumber) => {
      if (rowNumber === 1) return;
      const cells = [1, 2, 3].map((column) => worksheetRow.getCell(column).text);
      if (cells.every((cell) => String(cell ?? "").trim() === "")) return;
      const studentId = normalizeStudentId(cells[0]);
      const name = String(cells[1] ?? "").trim();
      const code = String(cells[2] ?? "").trim();
      const row = rowNumber;
      let valid = true;
      if (!/^\d{5}$/.test(studentId)) {
        errors.push({ row, message: "학번은 숫자 5자리여야 합니다." });
        valid = false;
      } else if (seen.has(studentId)) {
        errors.push({ row, message: `중복 학번입니다 (${studentId}).` });
        valid = false;
      } else {
        seen.add(studentId);
      }
      if (name.length < 1 || name.length > 50) {
        errors.push({ row, message: "이름은 1~50자여야 합니다." });
        valid = false;
      }
      if (code.length < 1 || code.length > 72) {
        errors.push({ row, message: "전용코드는 1~72자여야 합니다." });
        valid = false;
      }
      if (valid) rows.push({ studentId, name, code });
    });
    if (rows.length > 3000) errors.push({ row: sheet.rowCount, message: "최대 3,000명까지 등록할 수 있습니다." });
    return { rows, errors };
  });
}

export function seoulDateInput(iso: string): string {
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(iso));
  return parts.replace(" ", "T");
}

export function seoulInputToIso(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) throw new Error("날짜와 시간을 확인해주세요.");
  return new Date(`${value}:00+09:00`).toISOString();
}

export function formatSeoul(iso: string): string {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(iso));
}
