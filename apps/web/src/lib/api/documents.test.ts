import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  listDocuments,
  createDocument,
  updateDocument,
  deleteDocument,
  listVersions,
  createComment,
  resolveComment,
} from "./documents";

beforeEach(() => {
  global.fetch = vi.fn();
});

const mockFetch = () => global.fetch as ReturnType<typeof vi.fn>;

const docRaw = {
  ID: "doc-1",
  TenantID: "t-1",
  WorkspaceID: "ws-1",
  ProjectID: "p-1",
  Type: "brd",
  Title: "My BRD",
  Body: { type: "doc", content: [] },
  Status: "draft",
  Tags: ["alpha"],
  CreatedAt: "2026-01-01T00:00:00Z",
  UpdatedAt: "2026-05-01T00:00:00Z",
  Version: 1,
};

describe("documents API client", () => {
  it("listDocuments normalizes Go-style keys", async () => {
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
            ID: "ver-1",
            DocumentID: "doc-1",
            Rev: 2,
            Title: "BRD v2",
            Body: { type: "doc", content: [] },
            Status: "draft",
            CreatedBy: "user-1",
            CreatedAt: "2026-05-10T00:00:00Z",
            Note: "Minor fix",
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
        ID: "c-1",
        DocumentID: "doc-1",
        Body: "Looks good.",
        CreatedAt: "2026-05-01T00:00:00Z",
        UpdatedAt: "2026-05-01T00:00:00Z",
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
});
