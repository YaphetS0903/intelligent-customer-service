update public.training_jobs
set script_json = (
  select coalesce(jsonb_agg(
    case
      when slide ? 'notes' then slide
      else slide || jsonb_build_object('notes', '')
    end
    order by ordinality
  ), '[]'::jsonb)
  from jsonb_array_elements(script_json) with ordinality as items(slide, ordinality)
)
where script_json is not null;
