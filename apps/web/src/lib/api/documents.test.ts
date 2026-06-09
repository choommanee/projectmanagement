import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  listDocuments,
  createDocument,
  updateDocument,
  deleteDocument,
  listVersions,
  createComment,
  resolveComment,
  deleteComment,
  restoreVersion,
  getTemplate,
  instantiateTemplate,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  listAllWorkspaces,
  getWorkspace,
  type Template,
} from "./documents";

beforeEach(() => {
  global.fetch = vi.fn();
});

const mockFetch = () => global.fetch as ReturnType<typeof vi.fn>;

const docRaw = {
  id: "doc-1",
  tenant_id: "t-1",
  workspace_id: "ws-1",
  project_id: "p-1",
  type: "brd",
  title: "My BRD",
  body: { type: "doc", content: [] },
  status: "draft",
  tags: ["alpha"],
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-05-01T00:00:00Z",
  version: 1,
};

describe("documents API client", () => {
  it("listDocuments normalizes snake_case keys", async () => {
    mockFetch().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ items: [docRaw], total: 1 }),
    });

    const { items, total } = await listDocuments({ workspace_id: "ws-1" });
    expect(total).toBe(1);
    expect(items[0].id).toBe("doc-1");
    expect(items[0].tenantId).toBe("t-1");
    expect(items[0].workspaceId).toBe("ws-1");
    expect(items[0].type).toBe("brd");
    expect(items[0].title).toBe("My BRD");
    expect(items[0].version).toBe(1);
  });

  it("createDocument sends body with correct shape", async () => {
    mockFetch().mockResolvedValueOnce({
      ok: true,
      json: async () => docRaw,
    });

    await createDocument({ workspace_id: "ws-1", project_id: "p-1", type: "brd", title: "My BRD" });

    expect(mockFetch()).toHaveBeenCalledWith(
      "/api/documents",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"workspace_id":"ws-1"'),
      }),
    );
  });

  it("updateDocument sends version in body", async () => {
    mockFetch().mockResolvedValueOnce({
      ok: true,
      json: async () => docRaw,
    });

    await updateDocument("doc-1", { title: "Updated", version: 1 });

    expect(mockFetch()).toHaveBeenCalledWith(
      "/api/documents/doc-1",
      expect.objectContaining({
        method: "PATCH",
        body: expect.stringContaining('"version":1'),
      }),
    );
  });

  it("deleteDocument sends version as query param", async () => {
    mockFetch().mockResolvedValueOnce({ ok: true, status: 204 });

    await deleteDocument("doc-1", 3);

    expect(mockFetch()).toHaveBeenCalledWith("/api/documents/doc-1?version=3", {
      method: "DELETE",
    });
  });

  it("listVersions normalizes fields", async () => {
    mockFetch().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        items: [
          {
            id: "ver-1",
            document_id: "doc-1",
            rev: 2,
            title: "BRD v2",
            body: { type: "doc", content: [] },
            status: "draft",
            created_by: "user-1",
            created_at: "2026-05-10T00:00:00Z",
            note: "Minor fix",
          },
        ],
      }),
    });

    const versions = await listVersions("doc-1");
    expect(versions[0].id).toBe("ver-1");
    expect(versions[0].rev).toBe(2);
    expect(versions[0].title).toBe("BRD v2");
    expect(versions[0].createdBy).toBe("user-1");
    expect(versions[0].note).toBe("Minor fix");
  });

  it("addComment posts to correct url", async () => {
    mockFetch().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: "c-1",
        document_id: "doc-1",
        body: "Looks good.",
        created_at: "2026-05-01T00:00:00Z",
        updated_at: "2026-05-01T00:00:00Z",
      }),
    });

    await createComment("doc-1", "Looks good.");

    expect(mockFetch()).toHaveBeenCalledWith(
      "/api/documents/doc-1/comments",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"body":"Looks good."'),
      }),
    );
  });

  it("resolveComment patches correct url", async () => {
    mockFetch().mockResolvedValueOnce({ ok: true, status: 200, text: async () => "{}" });

    await resolveComment("c-1");

    expect(mockFetch()).toHaveBeenCalledWith("/api/comments/c-1/resolve", {
      method: "PATCH",
    });
  });

  it("deleteComment deletes correct url", async () => {
    mockFetch().mockResolvedValueOnce({ ok: true, status: 204 });

    await deleteComment("c-9");

    expect(mockFetch()).toHaveBeenCalledWith("/api/comments/c-9", {
      method: "DELETE",
    });
  });

  it("restoreVersion posts rev + version to restore endpoint", async () => {
    mockFetch().mockResolvedValueOnce({ ok: true, json: async () => docRaw });

    await restoreVersion("doc-1", 2, 5);

    expect(mockFetch()).toHaveBeenCalledWith(
      "/api/documents/doc-1/restore",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"rev":2'),
      }),
    );
    const call = mockFetch().mock.calls[0][1] as { body: string };
    expect(call.body).toContain('"version":5');
  });

  it("getTemplate hits the templates proxy (not the documents path)", async () => {
    mockFetch().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: "t-1", type: "brd", name: "BRD", body: { a: 1 }, is_system: true, created_at: "2026-01-01T00:00:00Z" }),
    });

    const t = await getTemplate("t-1");

    expect(mockFetch()).toHaveBeenCalledWith("/api/templates/t-1", { cache: "no-store" });
    expect(t.id).toBe("t-1");
    expect(t.isSystem).toBe(true);
    expect(t.type).toBe("brd");
  });

  it("instantiateTemplate creates a document from template type + body", async () => {
    mockFetch().mockResolvedValueOnce({ ok: true, json: async () => docRaw });
    const tmpl: Template = {
      id: "t-1", type: "brd", name: "BRD Skeleton",
      body: { type: "doc", content: [{ type: "heading" }] }, isSystem: true, createdAt: "2026-01-01T00:00:00Z",
    };

    await instantiateTemplate(tmpl, { workspace_id: "ws-1", project_id: "p-1", title: "New BRD" });

    expect(mockFetch()).toHaveBeenCalledWith(
      "/api/documents",
      expect.objectContaining({ method: "POST" }),
    );
    const call = mockFetch().mock.calls[0][1] as { body: string };
    expect(call.body).toContain('"type":"brd"');
    expect(call.body).toContain('"title":"New BRD"');
    expect(call.body).toContain('"workspace_id":"ws-1"');
    expect(call.body).toContain('"heading"'); // template body copied through
  });

  it("createTemplate POSTs name/type/body to the templates proxy", async () => {
    mockFetch().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: "t-9", type: "note", name: "My Tmpl", body: { type: "doc", content: [] }, is_system: false, created_at: "2026-06-01T00:00:00Z" }),
    });

    const t = await createTemplate({ type: "note", name: "My Tmpl", body: { type: "doc", content: [] } });

    expect(mockFetch()).toHaveBeenCalledWith(
      "/api/templates",
      expect.objectContaining({ method: "POST" }),
    );
    const call = mockFetch().mock.calls[0][1] as { body: string };
    expect(call.body).toContain('"type":"note"');
    expect(call.body).toContain('"name":"My Tmpl"');
    expect(t.id).toBe("t-9");
    expect(t.isSystem).toBe(false);
  });

  it("updateTemplate PATCHes the template by id", async () => {
    mockFetch().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: "t-9", type: "note", name: "Renamed", body: { type: "doc", content: [] }, is_system: false, created_at: "2026-06-01T00:00:00Z" }),
    });

    const t = await updateTemplate("t-9", { name: "Renamed" });

    expect(mockFetch()).toHaveBeenCalledWith(
      "/api/templates/t-9",
      expect.objectContaining({ method: "PATCH" }),
    );
    const call = mockFetch().mock.calls[0][1] as { body: string };
    expect(call.body).toContain('"name":"Renamed"');
    expect(t.name).toBe("Renamed");
  });

  it("updateTemplate surfaces the backend error message (e.g. system template 403)", async () => {
    mockFetch().mockResolvedValueOnce({
      ok: false,
      status: 403,
      json: async () => ({ error: "system templates are read-only" }),
    });

    await expect(updateTemplate("t-sys", { name: "x" })).rejects.toThrow("system templates are read-only");
  });

  it("deleteTemplate DELETEs the template by id", async () => {
    mockFetch().mockResolvedValueOnce({ ok: true, json: async () => ({}) });

    await deleteTemplate("t-9");

    expect(mockFetch()).toHaveBeenCalledWith(
      "/api/templates/t-9",
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("listAllWorkspaces normalizes tenant-wide list", async () => {
    mockFetch().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        items: [{ id: "ws-1", tenant_id: "t-1", project_id: "p-1", kind: "ba", name: "BA WS", created_at: "x", updated_at: "y" }],
        total: 1,
      }),
    });

    const { items, total } = await listAllWorkspaces({ limit: 200 });
    expect(total).toBe(1);
    expect(items[0].id).toBe("ws-1");
    expect(items[0].projectId).toBe("p-1");
    expect(items[0].kind).toBe("ba");
  });

  it("getWorkspace fetches workspace detail by id", async () => {
    mockFetch().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: "ws-1", tenant_id: "t-1", project_id: "p-1", kind: "pm", name: "PM WS", created_at: "x", updated_at: "y" }),
    });

    const ws = await getWorkspace("ws-1");
    expect(mockFetch()).toHaveBeenCalledWith("/api/workspaces/ws-1", { cache: "no-store" });
    expect(ws.id).toBe("ws-1");
    expect(ws.kind).toBe("pm");
  });
});
