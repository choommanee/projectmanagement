-- +goose Up
ALTER TABLE lot         ADD COLUMN notes TEXT NOT NULL DEFAULT '';
ALTER TABLE work_center ADD COLUMN machine_count INTEGER NOT NULL DEFAULT 1;

-- +goose Down
ALTER TABLE work_center DROP COLUMN machine_count;
ALTER TABLE lot         DROP COLUMN notes;
