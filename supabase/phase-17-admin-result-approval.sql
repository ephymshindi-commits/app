create or replace function public.enforce_unit_result_workflow()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'draft' then
      raise exception 'New results must start as draft';
    end if;
    new.submitted_at := null;
    new.approved_by := null;
    new.approved_at := null;
    new.released_at := null;
    return new;
  end if;

  if old.status <> 'draft'
     and (new.cat_score, new.exam_score, new.grade, new.student_id, new.unit_id, new.semester_id)
         is distinct from (old.cat_score, old.exam_score, old.grade, old.student_id, old.unit_id, old.semester_id) then
    raise exception 'Submitted, approved and released results cannot be edited';
  end if;

  if new.status = old.status then
    return new;
  end if;

  if old.status = 'draft' and new.status = 'submitted' then
    new.submitted_at := coalesce(new.submitted_at, now());
    return new;
  end if;

  if old.status = 'draft' and new.status = 'approved' then
    if not public.is_administrator() then
      raise exception 'Only administrators may approve a result';
    end if;
    new.submitted_at := coalesce(new.submitted_at, now());
    new.approved_by := auth.uid();
    new.approved_at := now();
    return new;
  end if;

  if old.status = 'submitted' and new.status = 'approved' then
    new.approved_by := auth.uid();
    new.approved_at := now();
    return new;
  end if;

  if old.status = 'approved' and new.status = 'released' then
    new.released_at := now();
    return new;
  end if;

  raise exception 'Invalid result status transition: % to %', old.status, new.status;
end;
$$;
