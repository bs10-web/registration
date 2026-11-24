"use client";

import { ChangeEvent, FormEvent, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Course, rpc, supabase } from "@/lib/supabase";
import { formatSeoul, parseStudentWorkbook, seoulInputToIso } from "@/lib/validation";

type CategoryLimit = { name: string; limit: number };
type AdminCourse = Course & { count: number };
type ArchiveCourse = { id: string; category: string; name: string; deletedAt: string; count: number };
type Dashboard = {
  courses: number; students: number; registrations: number; maxCourses: number;
  categories: CategoryLimit[]; courseList: AdminCourse[]; archive: ArchiveCourse[];
};
type RosterRow = { number: number; studentId: string; name: string; createdAt: string; cancelledAt?: string | null };
type StudentResult = { student: { studentId: string; name: string } | null; registrations: { id: string; category: string; courseName: string; createdAt: string }[] };
type Tab = "overview" | "courses" | "registrations" | "archive" | "students" | "limits" | "account";
type Confirmation = { title: string; description: string; phrase?: string; action: (typed: string) => void | Promise<void> };
const emptyDashboard: Dashboard = { courses: 0, students: 0, registrations: 0, maxCourses: 4, categories: [], courseList: [], archive: [] };

export default function AdminPage() {
  const [sessionReady, setSessionReady] = useState(false);
  const [admin, setAdmin] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [dashboard, setDashboard] = useState(emptyDashboard);
  const [tab, setTab] = useState<Tab>("overview");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [courseForm, setCourseForm] = useState({ category: "주제선택", name: "", code: "", capacity: "30", startsAt: "", endsAt: "" });
  const [selectedCourse, setSelectedCourse] = useState("");
  const [roster, setRoster] = useState<RosterRow[]>([]);
  const [selectedArchive, setSelectedArchive] = useState("");
  const [archiveRoster, setArchiveRoster] = useState<RosterRow[]>([]);
  const [studentId, setStudentId] = useState("");
  const [studentResult, setStudentResult] = useState<StudentResult | null>(null);
  const [resetPhrase, setResetPhrase] = useState("");
  const [limits, setLimits] = useState({ maxCourses: 4, categories: [] as CategoryLimit[] });
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [confirmationText, setConfirmationText] = useState("");

  const reload = useCallback(async () => {
    if (!supabase) return;
    try {
      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        setAdmin(false);
        setSessionReady(true);
        return;
      }
      const result = await rpc<Dashboard & { message?: string }>("admin_dashboard");
      if (result.message) throw new Error(result.message);
      setDashboard(result);
      setLimits({ maxCourses: result.maxCourses, categories: result.categories });
      setAdmin(true);
      setSessionReady(true);
    } catch (error) {
      await supabase.auth.signOut();
      setAdmin(false);
      setSessionReady(true);
      setMessage(error instanceof Error ? error.message : "관리자 권한을 확인할 수 없습니다.");
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void reload(), 0);
    return () => window.clearTimeout(timer);
  }, [reload]);

  async function login(event: FormEvent) {
    event.preventDefault();
    if (!supabase) return setMessage("Supabase 설정을 확인해주세요.");
    setBusy(true);
    setMessage("");
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setMessage("이메일 또는 비밀번호를 확인해주세요.");
      setBusy(false);
      return;
    }
    setPassword("");
    await reload();
    setBusy(false);
  }

  async function logout() {
    if (supabase) await supabase.auth.signOut();
    setAdmin(false);
  }

  async function createCourse(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const result = await rpc<{ ok: boolean; message?: string }>("admin_save_course", {
        p_id: null, p_category: courseForm.category.trim(), p_name: courseForm.name.trim(), p_code: courseForm.code,
        p_capacity: Number(courseForm.capacity), p_starts_at: seoulInputToIso(courseForm.startsAt), p_ends_at: seoulInputToIso(courseForm.endsAt),
      });
      if (!result.ok) throw new Error(result.message ?? "과목을 등록하지 못했습니다.");
      setCourseForm((current) => ({ ...current, name: "", code: "" }));
      setMessage("과목을 등록했습니다.");
      await reload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "과목을 등록하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function deleteCourse(id: string) {
    setBusy(true);
    try {
      const result = await rpc<{ ok: boolean; message?: string }>("admin_delete_course", { p_course_id: id });
      if (!result.ok) throw new Error(result.message ?? "과목을 삭제하지 못했습니다.");
      if (selectedCourse === id) { setSelectedCourse(""); setRoster([]); }
      setMessage("과목을 삭제 과목 보관함으로 이동했습니다.");
      await reload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "과목을 삭제하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function purgeCourse(course: ArchiveCourse, phrase: string) {
    setBusy(true);
    try {
      const result = await rpc<{ ok: boolean; message?: string }>("admin_purge_course", { p_course_id: course.id, p_confirm: phrase });
      if (!result.ok) throw new Error(result.message ?? "영구 삭제하지 못했습니다.");
      setSelectedArchive("");
      setArchiveRoster([]);
      setMessage("보관된 과목과 신청 내역을 영구 삭제했습니다.");
      await reload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "영구 삭제하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function loadRoster(courseId: string) {
    setSelectedCourse(courseId);
    setBusy(true);
    try {
      const result = await rpc<RosterRow[]>("admin_course_roster", { p_course_id: courseId, p_include_cancelled: false });
      setRoster(result);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "신청 명단을 불러오지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function loadArchiveRoster(courseId: string) {
    setSelectedArchive(courseId);
    setBusy(true);
    try {
      const result = await rpc<RosterRow[]>("admin_course_roster", { p_course_id: courseId, p_include_cancelled: true });
      setArchiveRoster(result);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "보관 명단을 불러오지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function searchStudent(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const result = await rpc<StudentResult & { ok: boolean }>("admin_search_student", { p_student_id: studentId });
      setStudentResult(result);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "학생 정보를 불러오지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function cancelRegistration(id: string) {
    setBusy(true);
    try {
      const result = await rpc<{ ok: boolean; message?: string }>("admin_cancel_registration", { p_registration_id: id });
      if (!result.ok) throw new Error(result.message ?? "신청을 삭제하지 못했습니다.");
      await searchStudent(new Event("submit") as unknown as FormEvent);
      await reload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "신청을 삭제하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function importWorkbook(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setBusy(true);
    setMessage("");
    try {
      const { rows, errors } = await parseStudentWorkbook(file);
      if (errors.length) {
        setMessage(errors.slice(0, 20).map((error) => `엑셀 ${error.row}행: ${error.message}`).join("\n") +
          (errors.length > 20 ? `\n외 ${errors.length - 20}건의 오류` : ""));
        return;
      }
      const result = await rpc<{ ok: boolean; count?: number; message?: string }>("admin_import_students", { p_rows: rows });
      if (!result.ok) throw new Error(result.message ?? "명단을 저장하지 못했습니다.");
      setMessage(`${result.count}명의 학생 명단을 저장했습니다.`);
      await reload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "엑셀을 처리하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function resetStudents() {
    if (resetPhrase !== "전체 삭제") return;
    setBusy(true);
    try {
      const result = await rpc<{ ok: boolean; message?: string }>("admin_reset_students", { p_confirm: resetPhrase });
      if (!result.ok) throw new Error(result.message ?? "초기화하지 못했습니다.");
      setResetPhrase("");
      setStudentResult(null);
      setMessage("학생 및 신청 내역을 초기화했습니다.");
      await reload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "초기화하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function saveLimits(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const result = await rpc<{ ok: boolean; message?: string }>("admin_set_limits", {
        p_max_courses: limits.maxCourses, p_categories: limits.categories,
      });
      if (!result.ok) throw new Error(result.message ?? "한도를 저장하지 못했습니다.");
      setMessage("신청 한도를 저장했습니다.");
      await reload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "한도를 저장하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  if (!sessionReady) return <main className="shell admin-page"><p className="empty">관리자 권한을 확인하고 있습니다…</p></main>;
  if (!admin) return <main className="shell admin-page">
    <header className="header"><div className="row space-between" style={{ width: "100%" }}><Link href="/" className="brand">Course registration</Link><span className="header-note">관리자 로그인</span></div></header>
    <section className="modal" style={{ margin: "48px auto" }}><h1>관리자 로그인</h1><p className="muted">승인된 관리자 계정으로 로그인하세요.</p>
      <form onSubmit={(event) => void login(event)}>
        <div className="field"><label htmlFor="admin-email">이메일</label><input id="admin-email" type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} required /></div>
        <div className="field"><label htmlFor="admin-password">비밀번호</label><input id="admin-password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required /></div>
        {message && <p className="message" role="status">{message}</p>}
        <button className="button" disabled={busy}>{busy ? "로그인 중…" : "로그인"}</button>
      </form>
    </section>
  </main>;

  return <main className="shell admin-page">
    <header className="header"><div className="row space-between" style={{ width: "100%" }}><Link href="/" className="brand">Course registration</Link><div className="row"><span className="header-note">관리자</span><button className="button ghost" onClick={() => void logout()}>로그아웃</button></div></div></header>
    <div className="section-title"><h1>관리자 대시보드</h1></div>
    {message && <p className={`message ${message.includes("저장했습니다") || message.includes("등록했습니다") || message.includes("이동했습니다") ? "success" : ""}`} role="status" style={{ whiteSpace: "pre-line" }}>{message}</p>}
    <nav className="subnav" aria-label="관리자 메뉴">
      {([
        ["overview", "요약"], ["courses", "과목 관리"], ["registrations", "등록 현황"],
        ["archive", "삭제 과목 보관함"], ["students", "학생 명단"], ["limits", "신청 한도"], ["account", "계정 설정"],
      ] as [Tab, string][]).map(([id, label]) => <button key={id} className={`button ${tab === id ? "" : "ghost"}`} onClick={() => { setTab(id); setMessage(""); }}>{label}</button>)}
    </nav>
    {tab === "overview" && <><div className="stats">
      <Stat label="운영 중인 과목" value={dashboard.courses} /><Stat label="등록 학생" value={dashboard.students} /><Stat label="현재 신청 건수" value={dashboard.registrations} />
    </div><div className="card"><strong>운영 안내</strong><p className="muted">학생 명단과 신청 기록은 비공개 데이터베이스에 저장됩니다. 신청 시간과 한도는 데이터베이스에서 검증됩니다.</p></div></>}
    {tab === "courses" && <section>
      <div className="card"><h2>과목 등록</h2><form onSubmit={(event) => void createCourse(event)} className="inline-form">
        <TextField label="범주" id="course-category" value={courseForm.category} onChange={(value) => setCourseForm({ ...courseForm, category: value })} list="categories" required />
        <datalist id="categories">{dashboard.categories.map((category) => <option key={category.name} value={category.name} />)}</datalist>
        <TextField label="과목명" id="course-name" value={courseForm.name} onChange={(value) => setCourseForm({ ...courseForm, name: value })} maxLength={100} required />
        <TextField label="과목 코드" id="course-code" type="password" value={courseForm.code} onChange={(value) => setCourseForm({ ...courseForm, code: value })} maxLength={72} required />
        <TextField label="제한 인원" id="course-capacity" type="number" value={courseForm.capacity} onChange={(value) => setCourseForm({ ...courseForm, capacity: value })} min={1} max={3000} required />
        <TextField label="신청 시작 일시 (한국 시간)" id="course-start" type="datetime-local" value={courseForm.startsAt} onChange={(value) => setCourseForm({ ...courseForm, startsAt: value })} required />
        <TextField label="신청 마감 일시 (한국 시간)" id="course-end" type="datetime-local" value={courseForm.endsAt} onChange={(value) => setCourseForm({ ...courseForm, endsAt: value })} required />
        <div className="wide"><button className="button" disabled={busy}>과목 등록</button></div>
      </form></div>
      <h2 className="section-title">운영 중인 과목</h2>
      <CourseTable courses={dashboard.courseList} onDelete={(course) => setConfirmation({
        title: "과목 삭제", description: `${course.name} 과목은 학생 화면에서 제외되고 신청 명단은 보관함에 유지됩니다.`,
        action: () => deleteCourse(course.id),
      })} />
    </section>}
    {tab === "registrations" && <section className="card">
      <h2>과목별 등록 현황</h2><div className="field"><label htmlFor="roster-course">과목 선택</label><select id="roster-course" value={selectedCourse} onChange={(event) => void loadRoster(event.target.value)}>
        <option value="">과목을 선택하세요</option>{dashboard.courseList.map((course) => <option key={course.id} value={course.id}>{course.category} · {course.name}</option>)}
      </select></div>
      {selectedCourse && <><div className="row space-between"><span className="muted">접수 순서대로 표시</span><div className="row"><button className="button ghost" onClick={() => void loadRoster(selectedCourse)}>새로고침</button><button className="button secondary" onClick={() => downloadRoster(roster, "수강신청명단.xlsx")}>엑셀 다운로드</button></div></div><RosterTable rows={roster} /></>}
    </section>}
    {tab === "archive" && <section className="card">
      <h2>삭제 과목 보관함</h2><p className="muted">삭제된 과목과 명단은 보관되며, 영구 삭제 후에는 복구할 수 없습니다.</p>
      {dashboard.archive.length === 0 ? <p className="empty">보관 중인 과목이 없습니다.</p> : <div className="table-wrap"><table><thead><tr><th>범주</th><th>과목</th><th>신청 명단</th><th>삭제 시각</th><th>관리</th></tr></thead><tbody>
        {dashboard.archive.map((course) => <tr key={course.id}><td>{course.category}</td><td>{course.name}</td><td>{course.count}명</td><td>{formatSeoul(course.deletedAt)}</td><td><button className="button ghost" onClick={() => void loadArchiveRoster(course.id)}>명단 보기</button> <button className="button danger" disabled={busy} onClick={() => setConfirmation({
          title: "과목 영구 삭제", description: `${course.name} 과목, 신청 명단 및 인증 증표는 복구할 수 없습니다.`,
          phrase: "과목 영구 삭제", action: (typed) => purgeCourse(course, typed),
        })}>과목 영구 삭제</button></td></tr>)}
      </tbody></table></div>}
      {selectedArchive && <><h3>신청 명단</h3><RosterTable rows={archiveRoster} archived />
        <button className="button secondary" onClick={() => void downloadRoster(archiveRoster, "보관과목_신청명단.xlsx")}>엑셀 다운로드</button></>}
    </section>}
    {tab === "students" && <section>
      <div className="card"><h2>학생 명단 엑셀 관리</h2><p className="muted">.xlsx · 최대 2MB · 최대 3,000명. 기존 학번은 정보만 갱신되고 신청 내역은 유지됩니다.</p>
        <div className="row"><button className="button ghost" onClick={downloadTemplate}>엑셀 양식 다운로드</button><label className="button secondary" htmlFor="roster-upload">학생 명단 업로드</label><input id="roster-upload" type="file" accept=".xlsx" onChange={(event) => void importWorkbook(event)} style={{ position: "absolute", width: 1, height: 1, clip: "rect(0,0,0,0)" }} /></div>
      </div>
      <div className="card" style={{ marginTop: 16 }}><h2>학생별 신청 관리</h2><form onSubmit={(event) => void searchStudent(event)} className="row">
        <div className="field" style={{ minWidth: 220, margin: 0 }}><label htmlFor="search-student-id">학번 (숫자 5자리)</label><input id="search-student-id" inputMode="numeric" maxLength={5} value={studentId} onChange={(event) => setStudentId(event.target.value.replace(/\D/g, "").slice(0, 5))} /></div>
        <button className="button" disabled={busy || studentId.length !== 5}>검색</button>
      </form>
      {studentResult && (studentResult.student ? <><p><strong>{studentResult.student.studentId} · {studentResult.student.name}</strong> — 현재 신청 {studentResult.registrations.length}과목</p>
        <div className="table-wrap"><table><thead><tr><th>범주</th><th>과목명</th><th>신청 시각</th><th></th></tr></thead><tbody>
          {studentResult.registrations.map((registration) => <tr key={registration.id}><td>{registration.category}</td><td>{registration.courseName}</td><td>{formatSeoul(registration.createdAt)}</td><td><button className="button danger" disabled={busy} onClick={() => setConfirmation({
            title: "학생 신청 삭제", description: "해당 학생의 활성 신청만 취소 처리합니다. 취소 기록은 보존됩니다.",
            action: () => cancelRegistration(registration.id),
          })}>신청 삭제</button></td></tr>)}
          {studentResult.registrations.length === 0 && <tr><td colSpan={4}>활성 신청이 없습니다.</td></tr>}
        </tbody></table></div></> : <p className="muted">해당 학번의 학생을 찾을 수 없습니다.</p>)}</div>
      <div className="danger-zone"><h2>위험 영역</h2><p>모든 학생 정보와 활성·취소된 신청 내역, 학생 요청 제한 기록을 삭제합니다. 과목과 범주 및 신청 한도는 유지됩니다.</p>
        <div className="field"><label htmlFor="reset-phrase">실행하려면 “전체 삭제”를 입력하세요.</label><input id="reset-phrase" value={resetPhrase} onChange={(event) => setResetPhrase(event.target.value)} /></div>
        <button className="button danger" disabled={busy || dashboard.students === 0 || resetPhrase !== "전체 삭제"} onClick={() => void resetStudents()}>전체 학생 및 신청 내역 초기화</button>
      </div>
    </section>}
    {tab === "limits" && <section className="card"><h2>신청 제한 설정</h2><form onSubmit={(event) => void saveLimits(event)}>
      <TextField label="학생당 전체 신청 한도 (1~20)" id="max-courses" type="number" value={String(limits.maxCourses)} min={1} max={20} onChange={(value) => setLimits({ ...limits, maxCourses: Number(value) })} required />
      <h3>범주별 신청 한도 (1~5)</h3>{limits.categories.map((category, index) => <div key={category.name} className="row space-between" style={{ borderBottom: "1px solid var(--line)", padding: "8px 0" }}>
        <label htmlFor={`limit-${index}`}>{category.name}</label><input id={`limit-${index}`} type="number" min={1} max={5} value={category.limit}
          onChange={(event) => setLimits({ ...limits, categories: limits.categories.map((item, i) => i === index ? { ...item, limit: Number(event.target.value) } : item) })} />
      </div>)}
      <p className="muted">새 범주의 기본 한도는 1개입니다. 범주는 과목 등록 시 추가됩니다.</p>
      <button className="button" disabled={busy}>한도 저장</button>
    </form></section>}
    {tab === "account" && <AccountSettings email={email} setEmail={setEmail} setMessage={setMessage} />}
    {confirmation && <div className="modal-backdrop" role="presentation">
      <section className="modal" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title">
        <h2 id="confirm-title">{confirmation.title}</h2><p>{confirmation.description}</p>
        {confirmation.phrase && <div className="field"><label htmlFor="confirmation-phrase">확인 문구: {confirmation.phrase}</label>
          <input id="confirmation-phrase" value={confirmationText} onChange={(event) => setConfirmationText(event.target.value)} autoComplete="off" /></div>}
        <div className="row"><button className="button ghost" onClick={() => { setConfirmation(null); setConfirmationText(""); }}>취소</button>
          <button className="button danger" disabled={busy || (confirmation.phrase !== undefined && confirmationText !== confirmation.phrase)}
            onClick={() => { const action = confirmation.action; const typed = confirmationText; setConfirmation(null); setConfirmationText(""); void action(typed); }}>확인 후 실행</button></div>
      </section>
    </div>}
  </main>;
}

function CourseTable({ courses, onDelete }: { courses: AdminCourse[]; onDelete: (course: AdminCourse) => void }) {
  if (!courses.length) return <div className="card empty">운영 중인 과목이 없습니다.</div>;
  return <div className="table-wrap"><table><thead><tr><th>범주</th><th>과목명</th><th>신청 인원 / 제한</th><th>상태</th><th>신청 시작</th><th>신청 마감</th><th></th></tr></thead><tbody>
    {courses.map((course) => <tr key={course.id}><td>{course.category}</td><td>{course.name}</td><td>{course.count} / {course.capacity}</td>
      <td>{new Date() < new Date(course.startsAt) ? "신청 예정" : new Date() >= new Date(course.endsAt) ? "마감" : "신청 가능"}</td>
      <td>{formatSeoul(course.startsAt)}</td><td>{formatSeoul(course.endsAt)}</td><td><button className="button danger" onClick={() => onDelete(course)}>과목 삭제</button></td></tr>)}
  </tbody></table></div>;
}

function RosterTable({ rows, archived = false }: { rows: RosterRow[]; archived?: boolean }) {
  return <div className="table-wrap"><table><thead><tr><th>순번</th><th>학번</th><th>이름</th><th>등록 시간</th>{archived && <th>상태</th>}</tr></thead><tbody>
    {rows.map((row) => <tr key={`${row.number}-${row.studentId}-${row.createdAt}`}><td>{row.number}</td><td>{row.studentId}</td><td>{row.name}</td><td>{formatSeoul(row.createdAt)}</td>{archived && <td>{row.cancelledAt ? `취소 · ${formatSeoul(row.cancelledAt)}` : "신청 중"}</td>}</tr>)}
    {rows.length === 0 && <tr><td colSpan={archived ? 5 : 4} className="empty">신청 내역이 없습니다.</td></tr>}
  </tbody></table></div>;
}

function Stat({ label, value }: { label: string; value: number }) {
  return <div className="stat"><span className="muted">{label}</span><strong>{value.toLocaleString("ko-KR")}</strong></div>;
}

function TextField({ label, id, value, onChange, type = "text", required, maxLength, min, max, list }: {
  label: string; id: string; value: string; onChange: (value: string) => void;
  type?: string; required?: boolean; maxLength?: number; min?: number; max?: number; list?: string;
}) {
  return <div className="field"><label htmlFor={id}>{label}</label><input id={id} type={type} value={value}
    onChange={(event) => onChange(event.target.value)} required={required} maxLength={maxLength} min={min} max={max} list={list} /></div>;
}

async function downloadTemplate() {
  const ExcelJS = await import("exceljs");
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet("학생 등록");
  sheet.addRow(["학번", "이름", "전용코드"]);
  await saveWorkbook(book, "학생명단_양식.xlsx");
}

async function downloadRoster(rows: RosterRow[], filename: string) {
  const ExcelJS = await import("exceljs");
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet("신청 명단");
  sheet.addRow(["순번", "학번", "이름", "등록 시간", "상태"]);
  rows.forEach((row) => sheet.addRow([row.number, row.studentId, row.name, formatSeoul(row.createdAt), row.cancelledAt ? `취소 · ${formatSeoul(row.cancelledAt)}` : "신청 중"]));
  await saveWorkbook(book, filename);
}

async function saveWorkbook(book: import("exceljs").Workbook, filename: string) {
  const buffer = await book.xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([new Uint8Array(buffer)], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function AccountSettings({ email, setEmail, setMessage }: { email: string; setEmail: (value: string) => void; setMessage: (value: string) => void }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void supabase?.auth.getUser().then(({ data }) => setEmail(data.user?.email ?? ""));
  }, [setEmail]);
  async function changePassword(event: FormEvent) {
    event.preventDefault();
    if (!supabase) return;
    setBusy(true);
    setMessage("");
    try {
      const { error: verifyError } = await supabase.auth.signInWithPassword({ email, password: currentPassword });
      if (verifyError) throw new Error("현재 비밀번호가 올바르지 않습니다.");
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw new Error("비밀번호를 변경하지 못했습니다.");
      setMessage("비밀번호를 변경했습니다.");
      setCurrentPassword("");
      setNewPassword("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "비밀번호를 변경하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }
  async function changeEmail(event: FormEvent) {
    event.preventDefault();
    if (!supabase) return;
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ email: newEmail });
    setMessage(error ? "이메일 변경 요청을 처리하지 못했습니다." : "새 이메일 주소로 확인 링크를 보냈습니다.");
    setBusy(false);
  }
  return <section className="card"><h2>관리자 계정 설정</h2><p className="muted">현재 로그인 이메일: {email}</p>
    <form onSubmit={(event) => void changePassword(event)}><h3>비밀번호 변경</h3>
      <TextField label="현재 비밀번호 확인" id="current-password" type="password" value={currentPassword} onChange={setCurrentPassword} required />
      <TextField label="새 비밀번호" id="new-password" type="password" value={newPassword} onChange={setNewPassword} min={8} required />
      <button className="button" disabled={busy || newPassword.length < 8}>비밀번호 변경</button>
    </form>
    <form onSubmit={(event) => void changeEmail(event)} style={{ marginTop: 24 }}><h3>로그인 이메일 변경</h3>
      <TextField label="새 이메일" id="new-email" type="email" value={newEmail} onChange={setNewEmail} required />
      <button className="button secondary" disabled={busy}>이메일 변경 요청</button>
    </form>
  </section>;
}
