-- The extraction prompt lists skills in extraction/data/skills.json order, and
-- that order is part of the prompt hash. Reproduce it from the database.
alter table skills add column sort_order int;
