export type FieldType = "text" | "number" | "date" | "dropdown" | "user" | "boolean";
export type EntityType = "task" | "project" | "work_order" | "item" | "document";

export interface CustomFieldDef {
  id: string;
  entityType: EntityType;
  fieldKey: string;
  label: string;
  fieldType: FieldType;
  options: string[];
  required: boolean;
  sortOrder: number;
  createdAt: string;
}

export async function listCustomFields(entityType?: EntityType): Promise<CustomFieldDef[]> {
  const qs = entityType ? `?entity_type=${entityType}` : "";
  const res = await fetch(`/api/tenants/fields${qs}`);
  if (!res.ok) throw new Error("Failed to fetch custom fields");
  const data = await res.json();
  return ((data.items ?? []) as Record<string, unknown>[]).map(normField);
}

export async function createCustomField(
  params: Omit<CustomFieldDef, "id" | "createdAt">,
): Promise<CustomFieldDef> {
  const res = await fetch("/api/tenants/fields", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      entity_type: params.entityType,
      field_key:   params.fieldKey,
      label:       params.label,
      field_type:  params.fieldType,
      options:     params.options,
      required:    params.required,
      sort_order:  params.sortOrder,
    }),
  });
  if (!res.ok) throw new Error("Failed to create custom field");
  return normField(await res.json() as Record<string, unknown>);
}

export async function deleteCustomField(id: string): Promise<void> {
  const res = await fetch(`/api/tenants/fields/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error("Failed to delete custom field");
}

function normField(r: Record<string, unknown>): CustomFieldDef {
  return {
    id:         String(r["id"] ?? r["ID"] ?? ""),
    entityType: String(r["entity_type"] ?? r["EntityType"] ?? r["entityType"] ?? "") as EntityType,
    fieldKey:   String(r["field_key"] ?? r["FieldKey"] ?? r["fieldKey"] ?? ""),
    label:      String(r["label"] ?? r["Label"] ?? ""),
    fieldType:  String(r["field_type"] ?? r["FieldType"] ?? r["fieldType"] ?? "text") as FieldType,
    options:    ((r["options"] ?? r["Options"] ?? []) as string[]),
    required:   Boolean(r["required"] ?? r["Required"] ?? false),
    sortOrder:  Number(r["sort_order"] ?? r["SortOrder"] ?? r["sortOrder"] ?? 0),
    createdAt:  String(r["created_at"] ?? r["CreatedAt"] ?? r["createdAt"] ?? ""),
  };
}
