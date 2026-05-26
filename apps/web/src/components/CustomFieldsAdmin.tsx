"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  listCustomFields,
  createCustomField,
  deleteCustomField,
  type FieldType,
  type EntityType,
  type CustomFieldDef,
} from "@/lib/api/customFields";

const FIELD_TYPES: { value: FieldType; label: string }[] = [
  { value: "text",     label: "Text" },
  { value: "number",   label: "Number" },
  { value: "boolean",  label: "Boolean" },
  { value: "date",     label: "Date" },
  { value: "dropdown", label: "Select" },
];

const ENTITY_TYPES: { value: EntityType; label: string }[] = [
  { value: "task",       label: "Task" },
  { value: "project",    label: "Project" },
  { value: "work_order", label: "Work Order" },
];

const BLANK_FORM = {
  label:      "",
  fieldKey:   "",
  fieldType:  "text" as FieldType,
  entityType: "task" as EntityType,
  required:   false,
  options:    [] as string[],
  sortOrder:  0,
};

export function CustomFieldsAdmin() {
  const qc = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ ...BLANK_FORM });
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const { data: fields = [], isLoading, isError } = useQuery<CustomFieldDef[]>({
    queryKey: ["custom-fields"],
    queryFn:  () => listCustomFields(),
  });

  const createMutation = useMutation({
    mutationFn: createCustomField,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["custom-fields"] });
      setShowAdd(false);
      setForm({ ...BLANK_FORM });
      setFormError(null);
    },
    onError: (err: unknown) => {
      setFormError(err instanceof Error ? err.message : "Failed to create field");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteCustomField,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["custom-fields"] });
      setConfirmDelete(null);
    },
  });

  function handleAdd() {
    if (!form.label.trim()) { setFormError("Label is required"); return; }
    if (!form.fieldKey.trim()) { setFormError("Field key is required"); return; }
    setFormError(null);
    createMutation.mutate(form);
  }

  function handleLabelChange(val: string) {
    setForm(f => ({
      ...f,
      label:    val,
      fieldKey: f.fieldKey || val.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, ""),
    }));
  }

  // fieldToDelete kept for potential future tooltip/modal showing the field name before deletion
  void (confirmDelete ? fields.find(f => f.id === confirmDelete) : null);

  return (
    <div className="flex flex-col gap-0 border border-line bg-surface">
      {/* Toolbar */}
      <div className="flex items-center justify-between border-b border-line bg-surface-2 px-4 py-2">
        <span className="text-xs font-medium uppercase tracking-wider text-ink-3">
          Custom Field Definitions
        </span>
        <button
          onClick={() => { setShowAdd(s => !s); setFormError(null); }}
          className="rounded-xs bg-accent px-3 py-1 text-xs font-medium text-white hover:bg-accent/90 transition-colors"
        >
          {showAdd ? "Cancel" : "+ Add Field"}
        </button>
      </div>

      {/* Inline add form */}
      {showAdd && (
        <div className="border-b border-line bg-paper px-4 py-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-ink-3">Label *</label>
              <input
                value={form.label}
                onChange={e => handleLabelChange(e.target.value)}
                placeholder="e.g. Priority Score"
                className="h-8 rounded-xs border border-line bg-surface px-2 text-sm text-ink focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15 w-44"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-ink-3">Field Key *</label>
              <input
                value={form.fieldKey}
                onChange={e => setForm(f => ({ ...f, fieldKey: e.target.value }))}
                placeholder="priority_score"
                className="h-8 rounded-xs border border-line bg-surface px-2 font-mono text-xs text-ink focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15 w-40"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-ink-3">Type</label>
              <select
                value={form.fieldType}
                onChange={e => setForm(f => ({ ...f, fieldType: e.target.value as FieldType }))}
                className="h-8 rounded-xs border border-line bg-surface px-2 text-sm text-ink focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15 w-32"
              >
                {FIELD_TYPES.map(t => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-ink-3">Entity</label>
              <select
                value={form.entityType}
                onChange={e => setForm(f => ({ ...f, entityType: e.target.value as EntityType }))}
                className="h-8 rounded-xs border border-line bg-surface px-2 text-sm text-ink focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15 w-32"
              >
                {ENTITY_TYPES.map(t => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>
            <label className="flex items-center gap-1.5 text-xs text-ink pb-1">
              <input
                type="checkbox"
                checked={form.required}
                onChange={e => setForm(f => ({ ...f, required: e.target.checked }))}
                className="h-3.5 w-3.5 rounded-xs border-line"
              />
              Required
            </label>
            <button
              onClick={handleAdd}
              disabled={createMutation.isPending}
              className="h-8 rounded-xs bg-accent px-4 text-xs font-medium text-white hover:bg-accent/90 disabled:opacity-50 transition-colors"
            >
              {createMutation.isPending ? "Saving…" : "Save"}
            </button>
          </div>
          {formError && (
            <p className="mt-2 text-xs text-danger">{formError}</p>
          )}
        </div>
      )}

      {/* Table */}
      {isLoading ? (
        <div className="space-y-px">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-10 animate-pulse border-b border-line bg-surface-2" />
          ))}
        </div>
      ) : isError ? (
        <div className="px-4 py-6 text-center text-sm text-danger">
          Failed to load custom fields.
        </div>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line bg-surface-2 text-left text-xs font-medium text-ink-3">
              <th className="px-4 py-2">Field Name</th>
              <th className="px-4 py-2">Key</th>
              <th className="px-4 py-2">Type</th>
              <th className="px-4 py-2">Entity</th>
              <th className="px-4 py-2 text-center">Required</th>
              <th className="px-4 py-2">Created</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            {fields.map(field => (
              <tr key={field.id} className="border-b border-line hover:bg-surface-2">
                <td className="px-4 py-2 font-medium text-ink">{field.label}</td>
                <td className="px-4 py-2 font-mono text-xs text-ink-2">{field.fieldKey}</td>
                <td className="px-4 py-2">
                  <span className="rounded-xs bg-surface-2 border border-line px-2 py-0.5 text-xs font-medium text-ink-2 uppercase">
                    {field.fieldType}
                  </span>
                </td>
                <td className="px-4 py-2 text-xs text-ink-2">
                  {ENTITY_TYPES.find(e => e.value === field.entityType)?.label ?? field.entityType}
                </td>
                <td className="px-4 py-2 text-center">
                  <span
                    className={`inline-block h-2 w-2 rounded-full ${
                      field.required ? "bg-success" : "bg-surface-2 border border-line"
                    }`}
                  />
                </td>
                <td className="px-4 py-2 text-xs text-ink-3">
                  {field.createdAt ? new Date(field.createdAt).toLocaleDateString() : "—"}
                </td>
                <td className="px-4 py-2 text-right">
                  {confirmDelete === field.id ? (
                    <span className="flex items-center justify-end gap-2">
                      <span className="text-xs text-ink-3">Delete?</span>
                      <button
                        onClick={() => deleteMutation.mutate(field.id)}
                        disabled={deleteMutation.isPending}
                        className="text-xs font-medium text-danger hover:underline disabled:opacity-50"
                      >
                        Confirm
                      </button>
                      <button
                        onClick={() => setConfirmDelete(null)}
                        className="text-xs text-ink-3 hover:underline"
                      >
                        Cancel
                      </button>
                    </span>
                  ) : (
                    <button
                      onClick={() => setConfirmDelete(field.id)}
                      className="text-xs text-ink-3 hover:text-danger"
                      aria-label={`Delete ${field.label}`}
                    >
                      Delete
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {fields.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-sm text-ink-3">
                  No custom fields defined. Add your first field above.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}

    </div>
  );
}
