ALTER TABLE public.budget_items
ADD COLUMN IF NOT EXISTS hierarchy_level integer,
ADD COLUMN IF NOT EXISTS parent_item_code text;

UPDATE public.budget_items
SET
  hierarchy_level = CASE
    WHEN item_code IS NULL OR btrim(item_code) = '' THEN NULL
    ELSE array_length(regexp_split_to_array(btrim(item_code), '\.'), 1)
  END,
  parent_item_code = CASE
    WHEN item_code IS NULL OR btrim(item_code) = '' OR position('.' in btrim(item_code)) = 0 THEN NULL
    ELSE regexp_replace(btrim(item_code), '\.[^.]+$', '')
  END
WHERE hierarchy_level IS NULL OR parent_item_code IS NULL;

CREATE INDEX IF NOT EXISTS idx_budget_items_project_parent_code
ON public.budget_items (project_id, parent_item_code);

CREATE INDEX IF NOT EXISTS idx_budget_items_project_hierarchy_level
ON public.budget_items (project_id, hierarchy_level);