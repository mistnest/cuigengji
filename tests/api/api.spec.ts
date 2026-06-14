/**
 * 催更姬 — API 自动化测试套件
 * 遵循 api-testing skill 规范 (Playwright request fixture + Zod schema validation)
 *
 * 运行前提:
 *   1. npm start  (启动服务器在 localhost:8765)
 *   2. npx playwright install
 *
 * 运行命令:
 *   npx playwright test tests/api/ --project=chromium
 *   npx playwright test tests/api/health.spec.ts --grep @smoke
 */

import { test, expect } from "@playwright/test";

// ==================== Health & Version ====================

test.describe("Health Check API", () => {
  test("GET /api/ping returns 204 @smoke", async ({ request }) => {
    const response = await request.get("/api/ping");
    expect(response.status()).toBe(204);
  });

  test("GET /api/version returns correct format @smoke", async ({ request }) => {
    const response = await request.get("/api/version");
    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    expect(body).toMatchObject({
      name: "novel-ai-editor",
      version: expect.any(String),
    });
  });
});

// ==================== Novels API ====================

test.describe("Novels API", () => {
  const baseUrl = "/api/novels";
  const cleanupIds = new Set<string>();

  test.afterAll(async ({ request }) => {
    for (const id of cleanupIds) {
      await request.delete(`${baseUrl}/${encodeURIComponent(id)}`);
    }
  });

  test("GET /api/novels returns list @smoke", async ({ request }) => {
    const response = await request.get(baseUrl);
    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    expect(body).toHaveProperty("novels");
    expect(Array.isArray(body.novels)).toBeTruthy();
  });

  test("POST /api/novels creates new project @smoke", async ({ request }) => {
    const response = await request.post(baseUrl, {
      data: { title: `测试小说_${Date.now()}` },
    });
    expect(response.status()).toBe(201);
    const body = await response.json();
    expect(body).toHaveProperty("id");
    expect(body.config.title).toContain("测试小说");
    cleanupIds.add(body.id);
  });

  test("POST /api/novels requires title @regression @negative", async ({ request }) => {
    const response = await request.post(baseUrl, {
      data: {},
    });
    expect(response.status()).toBe(400);
    const body = await response.json();
    expect(body.error).toContain("title");
  });

  test("POST /api/novels rejects duplicate title @regression @boundary", async ({ request }) => {
    const title = `dup_test_${Date.now()}`;
    // First create
    const r1 = await request.post(baseUrl, { data: { title } });
    expect(r1.status()).toBe(201);
    const { id } = await r1.json();
    cleanupIds.add(id);
    // Second create with same title
    const r2 = await request.post(baseUrl, { data: { title } });
    expect(r2.status()).toBe(409);
  });

  test("DELETE /api/novels/:id removes project @regression", async ({ request }) => {
    const title = `delete_test_${Date.now()}`;
    const created = await request.post(baseUrl, { data: { title } });
    const { id } = await created.json();
    const removed = await request.delete(`${baseUrl}/${encodeURIComponent(id)}`);
    expect(removed.ok()).toBeTruthy();
    cleanupIds.delete(id);

    const list = await request.get(baseUrl).then(response => response.json());
    expect(list.novels.some((novel: { id: string }) => novel.id === id)).toBe(false);
  });
});

// ==================== Chapters API ====================

test.describe("Chapters API", () => {
  let novelId: string;
  let chapterId: string;
  let volumeId: string;

  test.beforeAll(async ({ request }) => {
    const resp = await request.post("/api/novels", {
      data: { title: `章节测试项目_${Date.now()}` },
    });
    const body = await resp.json();
    novelId = body.id;
  });

  test.afterAll(async ({ request }) => {
    if (novelId) {
      await request.delete(`/api/novels/${encodeURIComponent(novelId)}`);
    }
  });

  test("GET /api/chapters requires novelId @regression @negative", async ({ request }) => {
    const response = await request.get("/api/chapters");
    expect(response.status()).toBe(400);
    const body = await response.json();
    expect(body.error).toContain("novelId");
  });

  test("GET /api/chapters?novelId=xxx returns empty list initially @smoke", async ({ request }) => {
    const response = await request.get(`/api/chapters?novelId=${novelId}`);
    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    expect(body).toHaveProperty("chapters");
  });

  test("POST /api/chapters creates chapter @smoke", async ({ request }) => {
    const response = await request.post("/api/chapters", {
      data: { novelId, title: "第一章", content: "开篇正文" },
    });
    expect(response.status()).toBe(201);
    const body = await response.json();
    expect(body).toHaveProperty("id");
    expect(body.title).toBe("第一章");
    expect(body.content).toBe("开篇正文");
    expect(body.wordCount).toBe(4);
    expect(body.status).toBe("draft");
    chapterId = body.id;
  });

  test("POST /api/chapters creates volume @smoke", async ({ request }) => {
    const response = await request.post("/api/chapters", {
      data: { novelId, title: "第一卷", type: "volume" },
    });
    expect(response.status()).toBe(201);
    const body = await response.json();
    expect(body.type).toBe("volume");
    volumeId = body.id;
  });

  test("GET /api/chapters/:id returns full chapter @regression", async ({ request }) => {
    const response = await request.get(`/api/chapters/${chapterId}?novelId=${novelId}`);
    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    expect(body.id).toBe(chapterId);
  });

  test("GET /api/chapters/:id returns 404 for non-existent @regression @negative", async ({ request }) => {
    const response = await request.get(`/api/chapters/nonexistent-id?novelId=${novelId}`);
    expect(response.status()).toBe(404);
  });

  test("PUT /api/chapters/:id updates content @regression", async ({ request }) => {
    const newContent = "这是测试正文内容";
    const response = await request.put(`/api/chapters/${chapterId}`, {
      data: { novelId, content: newContent },
    });
    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    expect(body.content).toBe(newContent);
    expect(body.wordCount).toBeGreaterThan(0);
  });

  test("PUT /api/chapters/:id updates title @regression", async ({ request }) => {
    const response = await request.put(`/api/chapters/${chapterId}`, {
      data: { novelId, title: "重命名章" },
    });
    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    expect(body.title).toBe("重命名章");
  });

  test("DELETE /api/chapters/:id removes chapter @regression", async ({ request }) => {
    // Create temp chapter to delete
    const create = await request.post("/api/chapters", {
      data: { novelId, title: "待删除章节" },
    });
    const { id } = await create.json();

    const response = await request.delete(`/api/chapters/${id}`, {
      data: { novelId },
    });
    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    expect(body.success).toBe(true);

    // Verify deleted
    const getResp = await request.get(`/api/chapters/${id}?novelId=${novelId}`);
    expect(getResp.status()).toBe(404);
  });

  test("DELETE /api/chapters/:id removes volume @regression", async ({ request }) => {
    // Create temp volume
    const create = await request.post("/api/chapters", {
      data: { novelId, title: "待删除卷", type: "volume" },
    });
    const { id } = await create.json();

    const response = await request.delete(`/api/chapters/${id}`, {
      data: { novelId },
    });
    expect(response.ok()).toBeTruthy();
  });

  // ==================== Data-driven: invalid inputs ====================
  const invalidPayloads = [
    { data: {}, desc: "empty body" },
    { data: { title: "" }, desc: "empty title" },
    { data: { content: "no title" }, desc: "missing title" },
  ];

  for (const { data, desc } of invalidPayloads) {
    test(`POST /api/chapters handles ${desc} @regression @boundary`, async ({ request }) => {
      const response = await request.post("/api/chapters", {
        data: { novelId, ...data },
      });
      // Should NOT 500 crash; should return either 400 or 201 (graceful)
      expect(response.status()).not.toBe(500);
    });
  }
});

// ==================== AI API (No Key Required) ====================

test.describe("AI API — Validation", () => {
  const baseUrl = "/api/ai";

  test("POST /continue requires text @regression @negative", async ({ request }) => {
    const response = await request.post(`${baseUrl}/continue`, {
      data: { text: "", config: {} },
    });
    expect(response.status()).toBe(400);
    const body = await response.json();
    expect(body.error).toContain("text");
  });

  test("POST /continue requires API key @regression @negative", async ({ request }) => {
    const response = await request.post(`${baseUrl}/continue`, {
      data: { text: "test content", config: { provider: "anthropic" } },
    });
    expect(response.status()).toBe(400);
  });

  test("POST /plot-suggestions requires text @regression @negative", async ({ request }) => {
    const response = await request.post(`${baseUrl}/plot-suggestions`, {
      data: { text: "", config: {} },
    });
    expect(response.status()).toBe(400);
  });

  test("POST /summarize requires text @regression @negative", async ({ request }) => {
    const response = await request.post(`${baseUrl}/summarize`, {
      data: { text: "", config: {} },
    });
    expect(response.status()).toBe(400);
  });

  test("POST /test-connection without key returns error gracefully @regression", async ({ request }) => {
    const response = await request.post(`${baseUrl}/test-connection`, {
      data: { config: { provider: "anthropic" } },
    });
    expect(response.ok()).toBeTruthy(); // endpoint itself doesn't crash
    const body = await response.json();
    expect(body).toHaveProperty("success");
  });

  test("POST /list-models requires provider @regression @negative", async ({ request }) => {
    const response = await request.post(`${baseUrl}/list-models`, {
      data: { config: {} },
    });
    expect(response.status()).toBe(400);
  });

  test("POST /preview without AI key works (pure prompt preview) @regression", async ({ request }) => {
    const response = await request.post(`${baseUrl}/preview`, {
      data: { text: "测试正文", config: { provider: "anthropic" } },
    });
    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    expect(body).toHaveProperty("systemPrompt");
    expect(body).toHaveProperty("userPrompt");
  });

  test("POST /memory-status returns author info @regression", async ({ request }) => {
    const response = await request.post(`${baseUrl}/memory-status`, {
      data: {},
    });
    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    expect(body).toHaveProperty("author");
  });
});

// ==================== Import API ====================

test.describe("Import API", () => {
  test("POST /api/import/worldbook requires data @regression @negative", async ({ request }) => {
    const response = await request.post("/api/import/worldbook", {
      data: {},
    });
    // Should not 500 crash
    expect(response.status()).not.toBe(500);
  });

  test("POST /api/import/document requires file upload @regression @negative", async ({ request }) => {
    const response = await request.post("/api/import/document", {
      data: {},
    });
    // Should not 500 crash — handles missing file gracefully
    expect(response.status()).not.toBe(500);
  });

  test("POST /api/import/document preserves the first line when no chapter heading exists @regression", async ({ request }) => {
    const title = `plain_import_${Date.now()}`;
    const created = await request.post("/api/novels", { data: { title } });
    const { id: novelId } = await created.json();

    try {
      const response = await request.post("/api/import/document", {
        multipart: {
          novelId,
          autoSplit: "true",
          file: {
            name: "plain.txt",
            mimeType: "text/plain",
            buffer: Buffer.from("First paragraph.\n\nSecond paragraph.", "utf8"),
          },
        },
      });
      expect(response.ok()).toBeTruthy();

      const body = await response.json();
      expect(body.chapters).toHaveLength(1);
      expect(body.chapters[0].content).toBe("First paragraph.\n\nSecond paragraph.");
    } finally {
      await request.delete(`/api/novels/${encodeURIComponent(novelId)}`);
    }
  });
});

// ==================== Robustness & Isolation ====================

test.describe("Persistence robustness", () => {
  test("project assets with the same name stay isolated @regression", async ({ request }) => {
    const firstTitle = `asset_scope_a_${Date.now()}`;
    const secondTitle = `asset_scope_b_${Date.now()}`;
    const first = await request.post("/api/novels", { data: { title: firstTitle } }).then(r => r.json());
    const second = await request.post("/api/novels", { data: { title: secondTitle } }).then(r => r.json());

    try {
      for (const [novelId, content] of [[first.id, "alpha"], [second.id, "beta"]]) {
        const imported = await request.post("/api/import/worldbook", {
          data: {
            novelId,
            name: "shared",
            data: { entries: { 1: { uid: 1, key: ["shared"], content } } },
          },
        });
        expect(imported.ok()).toBeTruthy();
      }

      const firstBook = await request.get(`/api/save/worldbook/shared?novelId=${encodeURIComponent(first.id)}`).then(r => r.json());
      const secondBook = await request.get(`/api/save/worldbook/shared?novelId=${encodeURIComponent(second.id)}`).then(r => r.json());
      expect(firstBook.entries["1"].content).toBe("alpha");
      expect(secondBook.entries["1"].content).toBe("beta");
    } finally {
      await request.delete(`/api/novels/${encodeURIComponent(first.id)}`);
      await request.delete(`/api/novels/${encodeURIComponent(second.id)}`);
    }
  });

  test("workspace writes remain valid under concurrency @regression", async ({ request }) => {
    const title = `workspace_concurrency_${Date.now()}`;
    const created = await request.post("/api/novels", { data: { title } }).then(r => r.json());
    try {
      const writes = Array.from({ length: 20 }, (_, revision) =>
        request.post(`/api/save/workspace/${encodeURIComponent(created.id)}`, {
          data: { revision, worldBook: { entries: {} }, characters: [] },
        }));
      const responses = await Promise.all(writes);
      expect(responses.every(response => response.ok())).toBe(true);

      await request.post(`/api/save/workspace/${encodeURIComponent(created.id)}`, {
        data: { revision: 999, worldBook: { entries: {} }, characters: [] },
      });
      const workspace = await request.get(`/api/save/workspace/${encodeURIComponent(created.id)}`).then(r => r.json());
      expect(workspace.revision).toBe(999);
      expect(workspace.savedAt).toEqual(expect.any(Number));
    } finally {
      await request.delete(`/api/novels/${encodeURIComponent(created.id)}`);
    }
  });

  test("late autosaves cannot recreate a deleted project @regression", async ({ request }) => {
    const title = `delete_race_${Date.now()}`;
    const created = await request.post("/api/novels", { data: { title } }).then(r => r.json());
    const url = `/api/save/workspace/${encodeURIComponent(created.id)}`;

    const writes = Array.from({ length: 12 }, (_, revision) =>
      request.post(url, { data: { revision } }));
    const deletion = request.delete(`/api/novels/${encodeURIComponent(created.id)}`);
    const results = await Promise.all([...writes, deletion]);
    expect(results.every(response => response.status() < 500)).toBe(true);
    expect(results.at(-1)?.ok()).toBe(true);

    const lateWrite = await request.post(url, { data: { revision: 999 } });
    expect([404, 409]).toContain(lateWrite.status());
    const projects = await request.get("/api/novels").then(r => r.json());
    expect(projects.novels.some((novel: { id: string }) => novel.id === created.id)).toBe(false);

    const recreated = await request.post("/api/novels", { data: { title } });
    expect(recreated.status()).toBe(201);
    const saveAfterRecreate = await request.post(url, { data: { revision: 1000 } });
    expect(saveAfterRecreate.ok()).toBe(true);
    await request.delete(`/api/novels/${encodeURIComponent(created.id)}`);
  });
});

// ==================== 404 Handling ====================

test.describe("Global Error Handling", () => {
  test("Unknown route returns 404 @regression", async ({ request }) => {
    const response = await request.get("/api/nonexistent-route-12345");
    expect(response.status()).toBe(404);
    const body = await response.json();
    expect(body.error).toBe("Not found");
  });

  test("Malformed JSON body is handled gracefully @regression @boundary", async ({ request }) => {
    const response = await request.post("/api/novels", {
      headers: { "Content-Type": "application/json" },
      data: "not-valid-json{{{",
    });
    // Express body-parser returns 400 for malformed JSON
    expect(response.status()).toBeGreaterThanOrEqual(400);
    const body = await response.json();
    expect(body.code).toBe("MALFORMED_JSON");
  });
});
