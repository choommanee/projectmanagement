"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, Settings } from "lucide-react";
import { Button, Input, Tag } from "@pmplatform/ui-kit";
import { Breadcrumb } from "@/shell/Breadcrumb";
import { CommandBar } from "@/shell/CommandBar";
import {
  listCustomFields,
  createCustomField,
  deleteCustomField,
  type CustomFieldDef,
  type FieldType,
  type EntityType,
} from "@/lib/api/customFields";

const ENTITY_TYPES: EntityType[] = ["task", "project", "work_order", "item", "document"];
const FIELD_TYPES: FieldType[] = ["text", "number", "date", "dropdown", "user", "boolean"];

type Tone = "neutral" | "info" | "warning" | "success" | "signal";

const fieldTypeTone = (t: FieldType): Tone => {
  const map: Record<FieldType, Tone> = {
    text:     "neutral",
    number:   "info",
    date:     "warning",
    dropdown: "success",
    user:     "signal",
    boolean:  "neutral",
  };
  return map[t] ?? "neutral";
};

export default function CustomFieldsPage() {
  const qc = useQueryClient();
  const [entityType, setEntityType] = useState<EntityType>("task");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    fieldKey:  "",
    label:     "",
    fieldType: "text" as FieldType,
    required:  false,
    options:   "",
  });

  const { data: fields = [], isLoading } = useQuery<CustomFieldDef[]>({
    queryKey: ["custom-fields", entityType],
    queryFn:  () => listCustomFields(entityType),
  });

  const createMutation = useMutation({
    mutationFn: () =>
      createCustomField({
        entityType,
        fieldKey:  form.fieldKey,
        label:     form.label,
        fieldType: form.fieldType,
        options:
          form.fieldType === "dropdown"
            ? form.options
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean)
            : [],
        required:  form.required,
        sortOrder: fields.length * 10,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["custom-fields", entityType] });
      setShowForm(false);
      setForm({ fieldKey: "", label: "", fieldType: "text", required: false, options: "" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteCustomField(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["custom-fields", entityType] }),
  });

  return (
    <div className="flex flex-col h-full">
      <Breadcrumb
        items={[
          { label: "PM Hub", href: "/pm/home" },
          { label: "Admin", href: "/pm/tenants" },
          { label: "Custom Fields" },
        ]}
      />
      <CommandBar
        actions={[
          {
            id:      "add-field",
            label:   "Add Field",
            icon:    <Plus size={14} />,
            onClick: () => setShowForm(true),
          },
        ]}
      />

      {/* Entity type tabs */}
      <div className="flex gap-1 border-b border-line px-4 py-2">
        {ENTITY_TYPES.map((e) => (
          <button
            key={e}
            onClick={() => setEntityType(e)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              entityType === e
                ? "bg-primary text-white"
                : "bg-surface-2 text-fgMuted hover:text-fg"
            }`}
          >
            {e.replace("_", " ")}
          </button>
        ))}
      </div>

      {/* Add field inline form */}
      {showForm && (
        <div className="border-b border-line bg-surface-2 p-4">
          <p className="mb-3 text-sm font-medium">
            New field for <strong>{entityType.replace("_", " ")}</strong>
          </p>
          <div className="flex flex-wrap gap-3">
            <div>
              <label className="mb-1 block text-xs text-fgMuted">Field Key *</label>
              <Input
                placeholder="my_field"
                value={form.fieldKey}
                onChange={(e) => setForm({ ...form, fieldKey: e.target.value })}
                className="w-36"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-fgMuted">Label *</label>
              <Input
                placeholder="My Field"
                value={form.label}
                onChange={(e) => setForm({ ...form, label: e.target.value })}
                className="w-40"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-fgMuted">Type</label>
              <select
                value={form.fieldType}
                onChange={(e) =>
                  setForm({ ...form, fieldType: e.target.value as FieldType })
                }
                className="rounded-md border border-line bg-surface px-2 py-1.5 text-sm"
              >
                {FIELD_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            {form.fieldType === "dropdown" && (
              <div>
                <label className="mb-1 block text-xs text-fgMuted">
                  Options (comma-separated)
                </label>
                <Input
                  placeholder="Option A, Option B, Option C"
                  value={form.options}
                  onChange={(e) => setForm({ ...form, options: e.target.value })}
                  className="w-56"
                />
              </div>
            )}
            <div className="flex items-end gap-2">
              <label className="flex items-center gap-1.5 text-sm">
                <input
                  type="checkbox"
                  checked={form.required}
                  onChange={(e) => setForm({ ...form, required: e.target.checked })}
                />
                Required
              </label>
              <Button
                variant="primary"
                size="sm"
                disabled={!form.fieldKey || !form.label || createMutation.isPending}
                onClick={() => createMutation.mutate()}
              >
                Save
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setShowForm(false)}>
                Cancel
              </Button>
            </div>
          </div>
          {createMutation.isError && (
            <p className="mt-2 text-xs text-danger">
              {(createMutation.error as Error).message}
            </p>
          )}
        </div>
      )}

      {/* Fields table */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="space-y-px">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-10 animate-pulse border-b border-line bg-surface-2"
              />
            ))}
          </div>
        ) : fields.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-16 text-fgMuted">
            <Settings size={32} />
            <p className="text-sm">
              No custom fields for{" "}
              <strong>{entityType.replace("_", " ")}</strong> yet.
            </p>
            <Button size="sm" variant="ghost" onClick={() => setShowForm(true)}>
              <Plus size={14} className="mr-1" />
              Add Field
            </Button>
          </div>
        ) : (
          <>
            <div className="flex border-b border-line bg-surface-2 px-4 py-1.5 text-xs font-medium text-fgMuted">
              <span className="w-44">Key</span>
              <span className="flex-1">Label</span>
              <span className="w-24">Type</span>
              <span className="w-20">Required</span>
              <span className="w-12" />
            </div>
            {fields.map((f) => (
              <div
                key={f.id}
                className="flex items-center border-b border-line px-4 py-2 text-sm hover:bg-surface-2"
              >
                <span className="w-44 font-mono text-xs text-fgMuted">
                  {f.fieldKey}
                </span>
                <span className="flex-1">{f.label}</span>
                <span className="w-24">
                  <Tag tone={fieldTypeTone(f.fieldType)} size="sm">
                    {f.fieldType}
                  </Tag>
                </span>
                <span className="w-20 text-xs text-fgMuted">
                  {f.required ? "Yes" : "No"}
                </span>
                <div className="w-12 flex justify-end">
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={() => deleteMutation.mutate(f.id)}
                    disabled={deleteMutation.isPending}
                  >
                    <Trash2 size={13} />
                  </Button>
                </div>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
