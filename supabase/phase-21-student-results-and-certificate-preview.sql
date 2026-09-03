create or replace function public.my_released_results()
returns table (
  result_id uuid,
  unit_code text,
  unit_name text,
  academic_year text,
  semester_name text,
  cat_score numeric,
  exam_score numeric,
  total_score numeric,
  grade text,
  released_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if public.current_app_role() <> 'student' then
    raise exception 'Only students can view their released results';
  end if;
  return query
  select result.id, unit.code, unit.name, year.name, semester.name,
    result.cat_score, result.exam_score, result.total_score, result.grade, result.released_at
  from public.unit_results result
  join public.units unit on unit.id = result.unit_id
  join public.semesters semester on semester.id = result.semester_id
  join public.academic_years year on year.id = semester.academic_year_id
  where result.student_id = public.my_student_id()
    and result.status = 'released'
  order by year.starts_on desc, semester.starts_on desc, unit.code;
end;
$$;

revoke all on function public.my_released_results() from public;
grant execute on function public.my_released_results() to authenticated;
