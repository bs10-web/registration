create extension if not exists pgcrypto with schema extensions;
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table private.settings (
  singleton boolean primary key default true check (singleton),
  max_courses integer not null default 4 check (max_courses between 1 and 20)
);
insert into private.settings(singleton) values (true) on conflict do nothing;

create table private.admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
create table private.categories (
  name text primary key check (length(name) between 1 and 60),
  course_limit integer not null default 1 check (course_limit between 1 and 5)
);
insert into private.categories(name) values ('주제선택'), ('예술체육'), ('진로탐색')
on conflict do nothing;
create table private.students (
  student_id text primary key check (student_id ~ '^[0-9]{5}$'),
  name text not null check (length(name) between 1 and 50),
  code_hash text not null,
  created_at timestamptz not null default now()
);
create table private.courses (
  id uuid primary key default gen_random_uuid(),
  category text not null references private.categories(name),
  name text not null check (length(name) between 1 and 100),
  code_hash text not null,
  capacity integer not null check (capacity between 1 and 3000),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  check (starts_at < ends_at)
);
create table private.registrations (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references private.courses(id) on delete cascade,
  student_id text not null references private.students(student_id) on delete cascade,
  created_at timestamptz not null default now(),
  cancelled_at timestamptz,
  cancelled_by uuid
);
create unique index registrations_one_active_per_course_student
  on private.registrations(course_id, student_id) where cancelled_at is null;
create index registrations_active_by_student on private.registrations(student_id, created_at)
  where cancelled_at is null;
create index registrations_active_by_course on private.registrations(course_id, created_at)
  where cancelled_at is null;
create table private.proofs (
  token uuid primary key default gen_random_uuid(),
  course_id uuid not null references private.courses(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '10 minutes'
);
create index proofs_expiration on private.proofs(course_id, expires_at);
create table private.attempts (
  id bigint generated always as identity primary key,
  action text not null,
  subject text not null,
  attempted_at timestamptz not null default now()
);
create index attempts_window on private.attempts(action, subject, attempted_at desc);
create index attempts_gc on private.attempts(attempted_at);

create or replace function private.hash_secret(p_secret text)
returns text language sql strict security definer
set search_path = pg_catalog, extensions
as $$
  select extensions.crypt(encode(extensions.digest(p_secret, 'sha256'), 'hex'), extensions.gen_salt('bf', 12))
$$;
create or replace function private.check_secret(p_secret text, p_hash text)
returns boolean language sql immutable strict security definer
set search_path = pg_catalog, extensions
as $$
  select extensions.crypt(encode(extensions.digest(p_secret, 'sha256'), 'hex'), p_hash) = p_hash
$$;

alter table private.settings enable row level security;
alter table private.admins enable row level security;
alter table private.categories enable row level security;
alter table private.students enable row level security;
alter table private.courses enable row level security;
alter table private.registrations enable row level security;
alter table private.proofs enable row level security;
alter table private.attempts enable row level security;
revoke all on all tables in schema private from public, anon, authenticated;
revoke all on all sequences in schema private from public, anon, authenticated;

create or replace function public.courses_public()
returns jsonb language sql stable security definer
set search_path = pg_catalog, private, public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', c.id, 'category', c.category, 'name', c.name, 'capacity', c.capacity,
    'startsAt', c.starts_at, 'endsAt', c.ends_at,
    'count', (select count(*) from private.registrations r where r.course_id = c.id and r.cancelled_at is null),
    'state', case when now() < c.starts_at then 'upcoming'
                  when now() >= c.ends_at then 'closed'
                  when (select count(*) from private.registrations r where r.course_id = c.id and r.cancelled_at is null) >= c.capacity then 'full'
                  else 'open' end
  ) order by c.category, c.name), '[]'::jsonb)
  from private.courses c where c.deleted_at is null
$$;

create or replace function public.verify_course_code(p_course_id uuid, p_code text)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, private, public, extensions
as $$
declare c private.courses%rowtype; tok uuid;
begin
  if p_course_id is null then return jsonb_build_object('ok', false, 'message', '과목 정보를 찾을 수 없습니다.'); end if;
  perform pg_advisory_xact_lock(hashtextextended('course-code:' || p_course_id::text, 0));
  if p_code is null or length(p_code) not between 1 and 72 then return jsonb_build_object('ok', false, 'message', '과목 코드가 일치하지 않습니다.'); end if;
  select * into c from private.courses where id = p_course_id and deleted_at is null;
  if not found then return jsonb_build_object('ok', false, 'message', '과목 정보를 찾을 수 없습니다.'); end if;
  if now() < c.starts_at then return jsonb_build_object('ok', false, 'message', '아직 수강신청 시간이 아닙니다'); end if;
  if now() >= c.ends_at then return jsonb_build_object('ok', false, 'message', '신청 마감 시한이 지났습니다.'); end if;
  if (select count(*) from private.attempts where action = 'course_code' and subject = p_course_id::text and attempted_at > now() - interval '1 minute') >= 15 then
    return jsonb_build_object('ok', false, 'message', '잠시 후 다시 시도해주세요.');
  end if;
  insert into private.attempts(action, subject) values ('course_code', p_course_id::text);
  if not private.check_secret(p_code, c.code_hash) then return jsonb_build_object('ok', false, 'message', '과목 코드가 일치하지 않습니다.'); end if;
  delete from private.proofs where course_id = p_course_id and expires_at <= now();
  insert into private.proofs(course_id) values (p_course_id) returning token into tok;
  return jsonb_build_object('ok', true, 'proof', tok);
end
$$;

create or replace function public.register_student(p_course_id uuid, p_proof uuid, p_student_id text, p_name text, p_code text)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, private, public, extensions
as $$
declare s private.students%rowtype; c private.courses%rowtype; total_count integer; category_count integer; max_count integer; cat_limit integer;
begin
  if p_student_id is null or p_student_id !~ '^[0-9]{5}$' or p_name is null or length(p_name) not between 1 and 50 or p_code is null or length(p_code) not between 1 and 72 then
    return jsonb_build_object('ok', false, 'message', '학번, 이름, 학생 전용 코드를 확인해주세요.');
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_student_id, 0));
  if (select count(*) from private.attempts where action = 'student_auth' and subject = p_student_id and attempted_at > now() - interval '1 minute') >= 10 then
    return jsonb_build_object('ok', false, 'message', '잠시 후 다시 시도해주세요.');
  end if;
  insert into private.attempts(action, subject) values ('student_auth', p_student_id);
  select * into s from private.students where student_id = p_student_id;
  if not found or s.name <> p_name or not private.check_secret(p_code, s.code_hash) then
    return jsonb_build_object('ok', false, 'message', '학번, 이름, 학생 전용 코드를 확인해주세요.');
  end if;
  select * into c from private.courses where id = p_course_id and deleted_at is null for update;
  if not found then return jsonb_build_object('ok', false, 'message', '과목 정보를 찾을 수 없습니다.'); end if;
  if now() < c.starts_at then return jsonb_build_object('ok', false, 'message', '아직 수강신청 시간이 아닙니다'); end if;
  if now() >= c.ends_at then return jsonb_build_object('ok', false, 'message', '신청 마감 시한이 지났습니다.'); end if;
  if not exists (select 1 from private.proofs where token = p_proof and course_id = p_course_id and expires_at > now()) then
    return jsonb_build_object('ok', false, 'message', '과목 코드를 다시 확인해주세요.');
  end if;
  if exists (select 1 from private.registrations where course_id = p_course_id and student_id = p_student_id and cancelled_at is null) then
    return jsonb_build_object('ok', false, 'message', '이미 신청하였습니다');
  end if;
  select count(*) into total_count from private.registrations r join private.courses active_course on active_course.id = r.course_id
    where r.student_id = p_student_id and r.cancelled_at is null and active_course.deleted_at is null;
  select max_courses into max_count from private.settings where singleton;
  if total_count >= max_count then return jsonb_build_object('ok', false, 'message', '최대 신청 가능 과목 수에 도달했습니다.'); end if;
  select count(*) into category_count from private.registrations r join private.courses cr on cr.id = r.course_id
    where r.student_id = p_student_id and r.cancelled_at is null and cr.category = c.category and cr.deleted_at is null;
  select course_limit into cat_limit from private.categories where name = c.category;
  if category_count >= cat_limit then return jsonb_build_object('ok', false, 'message', format('%s 범주에서는 최대 %s개 과목까지 신청할 수 있습니다.', c.category, cat_limit)); end if;
  if (select count(*) from private.registrations where course_id = p_course_id and cancelled_at is null) >= c.capacity then
    return jsonb_build_object('ok', false, 'message', '해당 과목은 신청이 마감되었습니다.');
  end if;
  insert into private.registrations(course_id, student_id) values (p_course_id, p_student_id);
  delete from private.proofs where token = p_proof;
  return jsonb_build_object('ok', true, 'courseName', c.name);
exception when unique_violation then
  return jsonb_build_object('ok', false, 'message', '이미 신청하였습니다');
end
$$;

create or replace function public.student_registrations(p_student_id text, p_name text, p_code text)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, private, public, extensions
as $$
declare s private.students%rowtype;
begin
  if p_student_id is null or p_student_id !~ '^[0-9]{5}$' then return jsonb_build_object('ok', false, 'message', '학번, 이름, 학생 전용 코드를 확인해주세요.'); end if;
  perform pg_advisory_xact_lock(hashtextextended(p_student_id, 0));
  if (select count(*) from private.attempts where action = 'student_auth' and subject = p_student_id and attempted_at > now() - interval '1 minute') >= 10 then
    return jsonb_build_object('ok', false, 'message', '잠시 후 다시 시도해주세요.');
  end if;
  insert into private.attempts(action, subject) values ('student_auth', p_student_id);
  select * into s from private.students where student_id = p_student_id;
  if not found or s.name <> p_name or not private.check_secret(p_code, s.code_hash) then
    return jsonb_build_object('ok', false, 'message', '학번, 이름, 학생 전용 코드를 확인해주세요.');
  end if;
  return jsonb_build_object('ok', true, 'items', coalesce((
    select jsonb_agg(jsonb_build_object('registrationId', r.id, 'courseId', c.id, 'category', c.category, 'courseName', c.name, 'createdAt', r.created_at, 'endsAt', c.ends_at) order by r.created_at)
    from private.registrations r join private.courses c on c.id = r.course_id
    where r.student_id = p_student_id and r.cancelled_at is null and c.deleted_at is null
  ), '[]'::jsonb));
end
$$;

create or replace function public.cancel_student_registration(p_course_id uuid, p_student_id text, p_name text, p_code text)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, private, public, extensions
as $$
declare s private.students%rowtype; c private.courses%rowtype;
begin
  if p_student_id is null or p_student_id !~ '^[0-9]{5}$' then return jsonb_build_object('ok', false, 'message', '학번, 이름, 학생 전용 코드를 확인해주세요.'); end if;
  perform pg_advisory_xact_lock(hashtextextended(p_student_id, 0));
  if (select count(*) from private.attempts where action = 'student_auth' and subject = p_student_id and attempted_at > now() - interval '1 minute') >= 10 then
    return jsonb_build_object('ok', false, 'message', '잠시 후 다시 시도해주세요.');
  end if;
  insert into private.attempts(action, subject) values ('student_auth', p_student_id);
  select * into s from private.students where student_id = p_student_id;
  if not found or s.name <> p_name or not private.check_secret(p_code, s.code_hash) then return jsonb_build_object('ok', false, 'message', '학번, 이름, 학생 전용 코드를 확인해주세요.'); end if;
  select * into c from private.courses where id = p_course_id and deleted_at is null for update;
  if not found then return jsonb_build_object('ok', false, 'message', '과목 정보를 찾을 수 없습니다.'); end if;
  if now() >= c.ends_at then return jsonb_build_object('ok', false, 'message', '신청 마감 이후에는 취소할 수 없습니다.'); end if;
  update private.registrations set cancelled_at = now() where course_id = p_course_id and student_id = p_student_id and cancelled_at is null;
  if not found then return jsonb_build_object('ok', false, 'message', '신청 내역을 찾을 수 없습니다.'); end if;
  return jsonb_build_object('ok', true);
end
$$;

create or replace function public.public_status()
returns jsonb language sql stable security definer
set search_path = pg_catalog, private, public
as $$
  select jsonb_build_object(
    'categories', coalesce((select jsonb_agg(jsonb_build_object('name', cat.name, 'courses', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'capacity', c.capacity,
        'count', (select count(*) from private.registrations r where r.course_id = c.id and r.cancelled_at is null),
        'startsAt', c.starts_at, 'endsAt', c.ends_at,
        'state', case when now() < c.starts_at then 'upcoming' when now() >= c.ends_at then 'closed'
          when (select count(*) from private.registrations r where r.course_id = c.id and r.cancelled_at is null) >= c.capacity then 'full' else 'open' end
      ) order by c.name) from private.courses c where c.category = cat.name and c.deleted_at is null
    ), '[]'::jsonb)) order by cat.name) from private.categories cat), '[]'::jsonb),
    'maxCourses', (select max_courses from private.settings where singleton)
  )
$$;

create or replace function private.assert_admin()
returns void language plpgsql stable security definer
set search_path = pg_catalog, private
as $$
begin
  if auth.uid() is null or not exists(select 1 from private.admins where user_id = auth.uid()) then
    raise exception using errcode = '42501', message = '관리자 권한이 없습니다.';
  end if;
end
$$;

create or replace function public.admin_dashboard()
returns jsonb language plpgsql stable security definer
set search_path = pg_catalog, private, public
as $$
begin
  perform private.assert_admin();
  return jsonb_build_object(
    'courses', (select count(*) from private.courses where deleted_at is null),
    'students', (select count(*) from private.students),
    'registrations', (select count(*) from private.registrations r join private.courses c on c.id = r.course_id where r.cancelled_at is null and c.deleted_at is null),
    'maxCourses', (select max_courses from private.settings where singleton),
    'categories', (select coalesce(jsonb_agg(jsonb_build_object('name', name, 'limit', course_limit) order by name), '[]'::jsonb) from private.categories),
    'courseList', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'category', c.category, 'name', c.name, 'capacity', c.capacity, 'startsAt', c.starts_at, 'endsAt', c.ends_at,
      'count', (select count(*) from private.registrations r where r.course_id = c.id and r.cancelled_at is null)
    ) order by c.created_at desc), '[]'::jsonb) from private.courses c where c.deleted_at is null),
    'archive', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'category', c.category, 'name', c.name, 'deletedAt', c.deleted_at,
      'count', (select count(*) from private.registrations r where r.course_id = c.id)
    ) order by c.deleted_at desc), '[]'::jsonb) from private.courses c where c.deleted_at is not null)
  );
end
$$;

create or replace function public.admin_save_course(p_id uuid, p_category text, p_name text, p_code text, p_capacity integer, p_starts_at timestamptz, p_ends_at timestamptz)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, private, public, extensions
as $$
declare cid uuid;
begin
  perform private.assert_admin();
  if length(p_category) not between 1 and 60 or length(p_name) not between 1 and 100 or p_capacity not between 1 and 3000 or p_starts_at >= p_ends_at then
    return jsonb_build_object('ok', false, 'message', '입력 정보를 확인해주세요.');
  end if;
  if coalesce(p_code, '') <> '' and length(p_code) > 72 then return jsonb_build_object('ok', false, 'message', '과목 코드를 확인해주세요.'); end if;
  if p_id is not null and not exists (select 1 from private.courses where id = p_id and deleted_at is null) then
    return jsonb_build_object('ok', false, 'message', '과목을 찾을 수 없습니다.');
  end if;
  if p_id is null then
    if (select count(*) from private.courses where deleted_at is null) >= 20 then return jsonb_build_object('ok', false, 'message', '운영 과목은 최대 20개까지 등록할 수 있습니다.'); end if;
    if p_code is null or length(p_code) not between 1 and 72 then return jsonb_build_object('ok', false, 'message', '과목 코드를 확인해주세요.'); end if;
    insert into private.categories(name) values (p_category) on conflict do nothing;
    insert into private.courses(category, name, code_hash, capacity, starts_at, ends_at)
      values (p_category, p_name, private.hash_secret(p_code), p_capacity, p_starts_at, p_ends_at) returning id into cid;
  else
    insert into private.categories(name) values (p_category) on conflict do nothing;
    update private.courses set category = p_category, name = p_name, capacity = p_capacity, starts_at = p_starts_at, ends_at = p_ends_at,
      code_hash = case when coalesce(p_code, '') = '' then code_hash else private.hash_secret(p_code) end
      where id = p_id and deleted_at is null returning id into cid;
    if cid is null then return jsonb_build_object('ok', false, 'message', '과목을 찾을 수 없습니다.'); end if;
  end if;
  return jsonb_build_object('ok', true, 'id', cid);
end
$$;

create or replace function public.admin_delete_course(p_course_id uuid)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, private, public
as $$
begin
  perform private.assert_admin();
  update private.courses set deleted_at = now() where id = p_course_id and deleted_at is null;
  if not found then return jsonb_build_object('ok', false, 'message', '과목을 찾을 수 없습니다.'); end if;
  return jsonb_build_object('ok', true);
end
$$;

create or replace function public.admin_purge_course(p_course_id uuid, p_confirm text)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, private, public
as $$
begin
  perform private.assert_admin();
  if p_confirm <> '과목 영구 삭제' then return jsonb_build_object('ok', false, 'message', '확인 문구가 일치하지 않습니다.'); end if;
  delete from private.courses where id = p_course_id and deleted_at is not null;
  if not found then return jsonb_build_object('ok', false, 'message', '보관된 과목만 영구 삭제할 수 있습니다.'); end if;
  return jsonb_build_object('ok', true);
end
$$;

create or replace function public.admin_set_limits(p_max_courses integer, p_categories jsonb)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, private, public
as $$
declare x jsonb;
begin
  perform private.assert_admin();
  if p_max_courses is null or p_max_courses not between 1 and 20 or p_categories is null or jsonb_typeof(p_categories) <> 'array' or jsonb_array_length(p_categories) > 40 then
    return jsonb_build_object('ok', false, 'message', '신청 한도를 확인해주세요.');
  end if;
  for x in select value from jsonb_array_elements(p_categories) loop
    if x->>'name' is null or length(x->>'name') not between 1 and 60 or (x->>'limit') is null or (x->>'limit') !~ '^[1-5]$' then return jsonb_build_object('ok', false, 'message', '범주별 신청 한도를 확인해주세요.'); end if;
  end loop;
  update private.settings set max_courses = p_max_courses where singleton;
  for x in select value from jsonb_array_elements(p_categories) loop
    insert into private.categories(name, course_limit) values (x->>'name', (x->>'limit')::integer)
      on conflict(name) do update set course_limit = excluded.course_limit;
  end loop;
  return jsonb_build_object('ok', true);
end
$$;

create or replace function public.admin_course_roster(p_course_id uuid, p_include_cancelled boolean default false)
returns jsonb language plpgsql stable security definer
set search_path = pg_catalog, private, public
as $$
begin
  perform private.assert_admin();
  return coalesce((select jsonb_agg(jsonb_build_object('number', n, 'studentId', student_id, 'name', name, 'createdAt', created_at, 'cancelledAt', cancelled_at) order by n)
    from (select row_number() over(order by r.created_at, r.id) n, s.student_id, s.name, r.created_at, r.cancelled_at
      from private.registrations r join private.students s on s.student_id = r.student_id
      where r.course_id = p_course_id and (p_include_cancelled or r.cancelled_at is null)) q), '[]'::jsonb);
end
$$;

create or replace function public.admin_search_student(p_student_id text)
returns jsonb language plpgsql stable security definer
set search_path = pg_catalog, private, public
as $$
declare s private.students%rowtype;
begin
  perform private.assert_admin();
  select * into s from private.students where student_id = p_student_id;
  if not found then return jsonb_build_object('ok', true, 'student', null); end if;
  return jsonb_build_object('ok', true, 'student', jsonb_build_object('studentId', s.student_id, 'name', s.name),
    'registrations', (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'category', c.category, 'courseName', c.name, 'createdAt', r.created_at) order by r.created_at), '[]'::jsonb)
      from private.registrations r join private.courses c on c.id = r.course_id where r.student_id = p_student_id and r.cancelled_at is null and c.deleted_at is null));
end
$$;

create or replace function public.admin_cancel_registration(p_registration_id uuid)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, private, public
as $$
begin
  perform private.assert_admin();
  update private.registrations set cancelled_at = now(), cancelled_by = auth.uid()
    where id = p_registration_id and cancelled_at is null;
  if not found then return jsonb_build_object('ok', false, 'message', '활성 신청을 찾을 수 없습니다.'); end if;
  return jsonb_build_object('ok', true);
end
$$;

create or replace function public.admin_import_students(p_rows jsonb)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, private, public, extensions
as $$
declare row jsonb; sid text; nm text; code text; n integer := 0;
begin
  perform private.assert_admin();
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) not between 1 and 3000 then return jsonb_build_object('ok', false, 'message', '학생 명단은 1~3,000명까지 등록할 수 있습니다.'); end if;
  if exists(select 1 from (select value->>'studentId' id from jsonb_array_elements(p_rows)) q where id is null or id !~ '^[0-9]{5}$') then
    return jsonb_build_object('ok', false, 'message', '학번은 숫자 5자리여야 합니다.');
  end if;
  if exists(select 1 from (select value->>'studentId' id from jsonb_array_elements(p_rows)) q group by id having count(*) > 1) then
    return jsonb_build_object('ok', false, 'message', '엑셀에 중복 학번이 있습니다.');
  end if;
  for row in select value from jsonb_array_elements(p_rows) loop
    sid := row->>'studentId'; nm := row->>'name'; code := row->>'code';
    if nm is null or length(nm) not between 1 and 50 or code is null or length(code) not between 1 and 72 then
      return jsonb_build_object('ok', false, 'message', '학생 명단의 이름 또는 전용 코드를 확인해주세요.');
    end if;
  end loop;
  for row in select value from jsonb_array_elements(p_rows) loop
    sid := row->>'studentId'; nm := row->>'name'; code := row->>'code';
    insert into private.students(student_id, name, code_hash)
      values (sid, nm, private.hash_secret(code))
      on conflict(student_id) do update set name = excluded.name, code_hash = excluded.code_hash;
    n := n + 1;
  end loop;
  return jsonb_build_object('ok', true, 'count', n);
end
$$;

create or replace function public.admin_reset_students(p_confirm text)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, private, public
as $$
begin
  perform private.assert_admin();
  if p_confirm <> '전체 삭제' then return jsonb_build_object('ok', false, 'message', '확인 문구가 일치하지 않습니다.'); end if;
  delete from private.proofs;
  delete from private.registrations;
  delete from private.attempts;
  delete from private.students;
  return jsonb_build_object('ok', true);
end
$$;

revoke all on function private.assert_admin() from public, anon, authenticated;
revoke all on function private.hash_secret(text), private.check_secret(text,text) from public, anon, authenticated;
revoke all on function public.courses_public(), public.verify_course_code(uuid,text),
  public.register_student(uuid,uuid,text,text,text), public.student_registrations(text,text,text),
  public.cancel_student_registration(uuid,text,text,text), public.public_status(),
  public.admin_dashboard(), public.admin_save_course(uuid,text,text,text,integer,timestamptz,timestamptz),
  public.admin_delete_course(uuid), public.admin_purge_course(uuid,text), public.admin_set_limits(integer,jsonb),
  public.admin_course_roster(uuid,boolean), public.admin_search_student(text), public.admin_cancel_registration(uuid),
  public.admin_import_students(jsonb), public.admin_reset_students(text)
from public, anon, authenticated;
grant execute on function public.courses_public(), public.verify_course_code(uuid,text),
  public.register_student(uuid,uuid,text,text,text), public.student_registrations(text,text,text),
  public.cancel_student_registration(uuid,text,text,text), public.public_status()
to anon, authenticated;
grant execute on function public.admin_dashboard(), public.admin_save_course(uuid,text,text,text,integer,timestamptz,timestamptz),
  public.admin_delete_course(uuid), public.admin_purge_course(uuid,text), public.admin_set_limits(integer,jsonb),
  public.admin_course_roster(uuid,boolean), public.admin_search_student(text), public.admin_cancel_registration(uuid),
  public.admin_import_students(jsonb), public.admin_reset_students(text)
to authenticated;
