"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Course, rpc } from "@/lib/supabase";
import { formatSeoul } from "@/lib/validation";

type Group = { name: string; courses: Course[] };
type StatusData = { categories: Group[]; maxCourses: number };
type Modal = "enroll" | "my" | "status" | "cancel" | null;
type Student = { studentId: string; name: string; code: string };

const emptyStudent = (): Student => ({ studentId: "", name: "", code: "" });

export default function Home() {
  const [data, setData] = useState<StatusData>({ categories: [], maxCourses: 4 });
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [modal, setModal] = useState<Modal>(null);
  const [activeCourse, setActiveCourse] = useState<Course | null>(null);
  const [student, setStudent] = useState<Student>(emptyStudent());
  const [courseCode, setCourseCode] = useState("");
  const [proof, setProof] = useState("");
  const [step, setStep] = useState<"course-code" | "student">("course-code");
  const [mine, setMine] = useState<{ registrationId: string; courseId: string; category: string; courseName: string; createdAt: string; endsAt: string }[]>([]);
  const [statusCategory, setStatusCategory] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [success, setSuccess] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const result = await rpc<StatusData>("public_status");
      setData(result);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "과목 정보를 불러오지 못했습니다.");
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  const courses = useMemo(
    () => data.categories.find((category) => category.name === selectedCategory)?.courses ?? [],
    [data.categories, selectedCategory],
  );
  const categoriesWithCourses = data.categories.filter((category) => category.courses.length > 0);

  function closeModal() {
    setModal(null);
    setActiveCourse(null);
    setStudent(emptyStudent());
    setCourseCode("");
    setProof("");
    setStep("course-code");
    setMessage("");
    setSuccess(false);
    setStatusCategory(null);
  }

  function openCourse(course: Course) {
    if (course.state === "upcoming") {
      setModal("enroll");
      setActiveCourse(course);
      setMessage("아직 수강신청 시간이 아닙니다");
      return;
    }
    if (course.state === "closed") {
      setModal("enroll");
      setActiveCourse(course);
      setMessage("신청 마감 시한이 지났습니다.");
      return;
    }
    if (course.state === "full") {
      setModal("enroll");
      setActiveCourse(course);
      setMessage("해당 과목은 신청이 마감되었습니다.");
      return;
    }
    setModal("enroll");
    setActiveCourse(course);
    setMessage("");
  }

  async function checkCourseCode(event: React.FormEvent) {
    event.preventDefault();
    if (!activeCourse) return;
    setBusy(true);
    setMessage("");
    try {
      const result = await rpc<{ ok: boolean; proof?: string; message?: string }>("verify_course_code", {
        p_course_id: activeCourse.id, p_code: courseCode,
      });
      if (!result.ok || !result.proof) {
        setMessage(result.message ?? "과목 코드를 확인해주세요.");
        return;
      }
      setProof(result.proof);
      setCourseCode("");
      setStudent(emptyStudent());
      setStep("student");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "요청을 처리하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function submitEnrollment(event: React.FormEvent) {
    event.preventDefault();
    if (!activeCourse) return;
    setBusy(true);
    setMessage("");
    try {
      const result = await rpc<{ ok: boolean; courseName?: string; message?: string }>("register_student", {
        p_course_id: activeCourse.id, p_proof: proof, p_student_id: student.studentId,
        p_name: student.name, p_code: student.code,
      });
      if (!result.ok) {
        setMessage(result.message ?? "신청하지 못했습니다.");
        return;
      }
      setSuccess(true);
      setMessage(`${result.courseName} 신청이 완료되었습니다.`);
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "신청하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function verifyStudent(event: React.FormEvent, mode: "my" | "cancel" | "status") {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const result = await rpc<{ ok: boolean; items?: typeof mine; message?: string }>("student_registrations", {
        p_student_id: student.studentId, p_name: student.name, p_code: student.code,
      });
      if (!result.ok) {
        setMessage(result.message ?? "학생 정보를 확인해주세요.");
        return;
      }
      setMine(result.items ?? []);
      setSuccess(true);
      if (mode === "status") {
        setStatusCategory(null);
        await refresh();
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "요청을 처리하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function cancelCourse(courseId: string) {
    const item = mine.find((registration) => registration.courseId === courseId);
    if (!item) return;
    if (new Date() >= new Date(item.endsAt)) {
      setMessage("신청 마감 이후에는 취소할 수 없습니다.");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const result = await rpc<{ ok: boolean; message?: string }>("cancel_student_registration", {
        p_course_id: courseId, p_student_id: student.studentId, p_name: student.name, p_code: student.code,
      });
      if (!result.ok) {
        setMessage(result.message ?? "취소하지 못했습니다.");
        return;
      }
      setMine((current) => current.filter((registration) => registration.courseId !== courseId));
      setMessage("수강 신청을 취소했습니다.");
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "취소하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <header className="header"><div className="shell row space-between" style={{ width: "100%" }}>
        <Link className="brand" href="/">Course registration</Link><span className="header-note">수강신청 플랫폼</span>
      </div></header>
      <main className="shell">
        <section className="hero">
          <p className="eyebrow">새로운 배움의 시작</p>
          <h1>나의 가능성을 발견하는 시간</h1>
          <p>새로운 배움. 나의 선택으로.</p>
        </section>
        <div className="section-title"><h2>{selectedCategory ? selectedCategory : "수강과목 살펴보기"}</h2>
          {selectedCategory && <button className="button ghost" onClick={() => setSelectedCategory(null)}>범주 전체</button>}
        </div>
        {selectedCategory ? (
          <div className="grid">
            {courses.length === 0 && <div className="card empty">등록된 과목이 없습니다.</div>}
            {courses.map((course) => <CourseCard key={course.id} course={course} onSelect={openCourse} />)}
          </div>
        ) : (
          <div className="grid">
            {categoriesWithCourses.length === 0 && <div className="card empty">현재 등록된 과목이 없습니다.</div>}
            {categoriesWithCourses.map((group) => <button key={group.name} className="card category-card" onClick={() => setSelectedCategory(group.name)}>
              <span>{group.name}<small className="muted" style={{ display: "block", marginTop: 6 }}>{group.courses.length}개 과목</small></span><span aria-hidden="true">→</span>
            </button>)}
          </div>
        )}
        {message && !modal && <p className="message" role="status">{message}</p>}
        <div className="footer-actions">
          <button className="button secondary" onClick={() => { setModal("my"); setSuccess(false); setMessage(""); }}>내가 신청한 과목 조회하기</button>
          <button className="button secondary" onClick={() => { setModal("cancel"); setSuccess(false); setMessage(""); }}>기존 수강과목 취소하기</button>
          <button className="button secondary" onClick={() => { setModal("status"); setSuccess(false); setMessage(""); }}>현재 수강현황 조회하기</button>
          <Link className="button ghost" href="/admin">관리자</Link>
        </div>
      </main>
      {modal && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeModal(); }}>
        <section className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
          <div className="row space-between"><h2 id="modal-title">{modal === "enroll" ? activeCourse?.name : modal === "my" ? "내가 신청한 과목" : modal === "cancel" ? "기존 수강과목 취소하기" : "현재 수강현황"}</h2>
            <button className="button ghost" onClick={closeModal} aria-label="닫기">닫기</button></div>
          {modal === "enroll" && activeCourse && <EnrollContent
            course={activeCourse} step={step} student={student} setStudent={setStudent}
            courseCode={courseCode} setCourseCode={setCourseCode} busy={busy} message={message} success={success}
            onCode={checkCourseCode} onSubmit={submitEnrollment}
          />}
          {(modal === "my" || modal === "cancel") && (success ? <>
            <div className="field"><label htmlFor="student-id-readonly">학번</label><input id="student-id-readonly" value={student.studentId} readOnly /></div>
            {message && <p className={message.includes("완료") ? "message success" : "message"} role="status">{message}</p>}
            <div className="table-wrap"><table><thead><tr><th>범주</th><th>과목</th><th>신청 시각</th>{modal === "cancel" && <th>취소</th>}</tr></thead><tbody>
              {mine.map((item) => <tr key={item.registrationId}><td>{item.category}</td><td>{item.courseName}</td><td>{formatSeoul(item.createdAt)}</td>
                {modal === "cancel" && <td><button className="button danger" disabled={busy || new Date() >= new Date(item.endsAt)} onClick={() => void cancelCourse(item.courseId)}>취소하기</button></td>}</tr>)}
              {mine.length === 0 && <tr><td colSpan={modal === "cancel" ? 4 : 3} className="empty">현재 신청한 과목이 없습니다.</td></tr>}
            </tbody></table></div>
            {modal === "cancel" && <p className="muted">마감 시각 이후에는 취소할 수 없습니다.</p>}
            {modal === "my" && <p className="muted">신청 시각은 한국 시간 기준입니다.</p>}
          </> : <StudentForm student={student} setStudent={setStudent} busy={busy} message={message} onSubmit={(event) => void verifyStudent(event, modal)} submitLabel="본인 확인" />)}
          {modal === "status" && <StatusContent data={data} busy={busy} message={message} student={student} setStudent={setStudent}
            success={success} verify={(event) => void verifyStudent(event, "status")} selected={statusCategory} setSelected={setStatusCategory}
            refresh={() => void refresh()} />}
        </section>
      </div>}
    </>
  );
}

function CourseCard({ course, onSelect }: { course: Course; onSelect: (course: Course) => void }) {
  const upcoming = course.state === "upcoming";
  const closed = course.state === "closed" || course.state === "full";
  const status = upcoming ? "신청 예정" : course.state === "closed" ? "마감" : course.state === "full" ? "정원 마감" : "신청 가능";
  return <article className="card course-card">
    <div className="row space-between"><h3>{course.name}</h3><span className={`pill ${closed ? "closed" : ""}`}>{status}</span></div>
    <p>{upcoming ? "신청 시작" : "신청 마감"} · {formatSeoul(upcoming ? course.startsAt : course.endsAt)}</p>
    <button className={`button ${closed ? "ghost" : ""}`} onClick={() => onSelect(course)}>
      {upcoming ? "신청 예정" : closed ? "신청 마감" : "수강 신청하기"}
    </button>
  </article>;
}

function StudentForm({ student, setStudent, busy, message, onSubmit, submitLabel }: {
  student: Student; setStudent: (value: Student) => void; busy: boolean; message: string;
  onSubmit: (event: React.FormEvent) => void; submitLabel: string;
}) {
  return <form onSubmit={onSubmit}>
    <Field label="학번" id="student-id" type="text" inputMode="numeric" maxLength={5} value={student.studentId}
      onChange={(value) => setStudent({ ...student, studentId: value.replace(/\D/g, "").slice(0, 5) })} placeholder="숫자 5자리" required />
    <Field label="이름" id="student-name" value={student.name} onChange={(value) => setStudent({ ...student, name: value })} maxLength={50} required />
    <Field label="학생 전용 코드" id="student-code" type="password" value={student.code} onChange={(value) => setStudent({ ...student, code: value })} maxLength={72} required />
    {message && <p className="message" role="status">{message}</p>}
    <button className="button" disabled={busy || student.studentId.length !== 5}>{busy ? "확인 중…" : submitLabel}</button>
  </form>;
}

function EnrollContent({ course, step, student, setStudent, courseCode, setCourseCode, busy, message, success, onCode, onSubmit }: {
  course: Course; step: "course-code" | "student"; student: Student; setStudent: (value: Student) => void;
  courseCode: string; setCourseCode: (value: string) => void; busy: boolean; message: string; success: boolean;
  onCode: (event: React.FormEvent) => void; onSubmit: (event: React.FormEvent) => void;
}) {
  if (success) return <p className="message success" role="status">{message}</p>;
  if (course.state === "upcoming" || course.state === "closed" || course.state === "full") return <p className="message" role="alert">{message}</p>;
  return step === "course-code" ? <form onSubmit={onCode}>
    <p className="muted">과목 코드 확인 후 학생 본인 확인을 진행합니다.</p>
    <Field label="과목 코드" id="course-code" type="password" value={courseCode} onChange={setCourseCode} maxLength={72} required />
    {message && <p className="message" role="status">{message}</p>}
    <button className="button" disabled={busy}>{busy ? "확인 중…" : "과목 코드 확인"}</button>
  </form> : <form onSubmit={onSubmit}>
    <p className="muted">학번, 이름, 학생 전용 코드를 입력해주세요.</p>
    <Field label="학번" id="student-id" type="text" inputMode="numeric" maxLength={5} value={student.studentId}
      onChange={(value) => setStudent({ ...student, studentId: value.replace(/\D/g, "").slice(0, 5) })} placeholder="숫자 5자리" required />
    <Field label="이름" id="student-name" value={student.name} onChange={(value) => setStudent({ ...student, name: value })} maxLength={50} required />
    <Field label="학생 전용 코드" id="student-code" type="password" value={student.code} onChange={(value) => setStudent({ ...student, code: value })} maxLength={72} required />
    {message && <p className="message" role="status">{message}</p>}
    <button className="button" disabled={busy || student.studentId.length !== 5}>{busy ? "신청 중…" : "신청 완료"}</button>
  </form>;
}

function StatusContent({ data, busy, message, student, setStudent, success, verify, selected, setSelected, refresh }: {
  data: StatusData; busy: boolean; message: string; student: Student; setStudent: (value: Student) => void;
  success: boolean; verify: (event: React.FormEvent) => void; selected: string | null;
  setSelected: (value: string | null) => void; refresh: () => void;
}) {
  if (!success) return <StudentForm student={student} setStudent={setStudent} busy={busy} message={message} onSubmit={verify} submitLabel="현황 확인" />;
  const categoriesWithCourses = data.categories.filter((group) => group.courses.length > 0);
  const courses = categoriesWithCourses.find((group) => group.name === selected)?.courses ?? [];
  return <>
    <div className="row space-between"><p className="muted">범주별 신청 현황</p><button className="button ghost" onClick={refresh}>새로고침</button></div>
    {!selected ? <div className="grid">{categoriesWithCourses.map((group) =>
      <button key={group.name} className="card category-card" onClick={() => setSelected(group.name)}><span>{group.name}</span><span>→</span></button>)}</div>
      : <><div className="section-title"><h3>{selected}</h3><button className="button ghost" onClick={() => setSelected(null)}>범주 목록</button></div>
        <div className="table-wrap"><table><thead><tr><th>과목명</th><th>신청 인원 / 제한 인원</th><th>신청 상태</th><th>일시</th></tr></thead><tbody>
          {courses.map((course) => <tr key={course.id}><td>{course.name}</td><td>{course.count} / {course.capacity}</td>
            <td>{course.state === "upcoming" ? "신청 예정" : course.state === "closed" || course.state === "full" ? "마감" : "신청 가능"}</td>
            <td>{formatSeoul(course.state === "upcoming" ? course.startsAt : course.endsAt)}</td></tr>)}
          {courses.length === 0 && <tr><td colSpan={4}>등록된 과목이 없습니다.</td></tr>}
        </tbody></table></div></>}
  </>;
}

function Field({ label, id, value, onChange, type = "text", required, maxLength, inputMode, placeholder }: {
  label: string; id: string; value: string; onChange: (value: string) => void; type?: string;
  required?: boolean; maxLength?: number; inputMode?: "numeric" | "text"; placeholder?: string;
}) {
  return <div className="field"><label htmlFor={id}>{label}</label><input id={id} type={type} value={value}
    onChange={(event) => onChange(event.target.value)} required={required} maxLength={maxLength} inputMode={inputMode} placeholder={placeholder} autoComplete="off" /></div>;
}
