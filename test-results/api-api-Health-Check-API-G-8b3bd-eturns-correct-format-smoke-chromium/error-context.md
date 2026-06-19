# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: api\api.spec.ts >> Health Check API >> GET /api/version returns correct format @smoke
- Location: tests\api\api.spec.ts:24:3

# Error details

```
Error: expect(received).toMatchObject(expected)

- Expected  - 1
+ Received  + 1

  Object {
-   "name": "novel-ai-editor",
+   "name": "cuigengji",
    "version": Any<String>,
  }
```

# Test source

```ts
  1   | /**
  2   |  * 催更姬 — API 自动化测试套件
  3   |  * 遵循 api-testing skill 规范 (Playwright request fixture + Zod schema validation)
  4   |  *
  5   |  * 运行前提:
  6   |  *   1. npm start  (启动服务器在 localhost:8765)
  7   |  *   2. npx playwright install
  8   |  *
  9   |  * 运行命令:
  10  |  *   npx playwright test tests/api/ --project=chromium
  11  |  *   npx playwright test tests/api/health.spec.ts --grep @smoke
  12  |  */
  13  | 
  14  | import { test, expect } from "@playwright/test";
  15  | 
  16  | // ==================== Health & Version ====================
  17  | 
  18  | test.describe("Health Check API", () => {
  19  |   test("GET /api/ping returns 204 @smoke", async ({ request }) => {
  20  |     const response = await request.get("/api/ping");
  21  |     expect(response.status()).toBe(204);
  22  |   });
  23  | 
  24  |   test("GET /api/version returns correct format @smoke", async ({ request }) => {
  25  |     const response = await request.get("/api/version");
  26  |     expect(response.ok()).toBeTruthy();
  27  |     const body = await response.json();
> 28  |     expect(body).toMatchObject({
      |                  ^ Error: expect(received).toMatchObject(expected)
  29  |       name: "novel-ai-editor",
  30  |       version: expect.any(String),
  31  |     });
  32  |   });
  33  | });
  34  | 
  35  | // ==================== Novels API ====================
  36  | 
  37  | test.describe("Novels API", () => {
  38  |   const baseUrl = "/api/novels";
  39  |   const cleanupIds = new Set<string>();
  40  | 
  41  |   test.afterAll(async ({ request }) => {
  42  |     for (const id of cleanupIds) {
  43  |       await request.delete(`${baseUrl}/${encodeURIComponent(id)}`);
  44  |     }
  45  |   });
  46  | 
  47  |   test("GET /api/novels returns list @smoke", async ({ request }) => {
  48  |     const response = await request.get(baseUrl);
  49  |     expect(response.ok()).toBeTruthy();
  50  |     const body = await response.json();
  51  |     expect(body).toHaveProperty("novels");
  52  |     expect(Array.isArray(body.novels)).toBeTruthy();
  53  |   });
  54  | 
  55  |   test("POST /api/novels creates new project @smoke", async ({ request }) => {
  56  |     const response = await request.post(baseUrl, {
  57  |       data: { title: `测试小说_${Date.now()}` },
  58  |     });
  59  |     expect(response.status()).toBe(201);
  60  |     const body = await response.json();
  61  |     expect(body).toHaveProperty("id");
  62  |     expect(body.config.title).toContain("测试小说");
  63  |     cleanupIds.add(body.id);
  64  |   });
  65  | 
  66  |   test("POST /api/novels requires title @regression @negative", async ({ request }) => {
  67  |     const response = await request.post(baseUrl, {
  68  |       data: {},
  69  |     });
  70  |     expect(response.status()).toBe(400);
  71  |     const body = await response.json();
  72  |     expect(body.error).toContain("title");
  73  |   });
  74  | 
  75  |   test("POST /api/novels rejects duplicate title @regression @boundary", async ({ request }) => {
  76  |     const title = `dup_test_${Date.now()}`;
  77  |     // First create
  78  |     const r1 = await request.post(baseUrl, { data: { title } });
  79  |     expect(r1.status()).toBe(201);
  80  |     const { id } = await r1.json();
  81  |     cleanupIds.add(id);
  82  |     // Second create with same title
  83  |     const r2 = await request.post(baseUrl, { data: { title } });
  84  |     expect(r2.status()).toBe(409);
  85  |   });
  86  | 
  87  |   test("DELETE /api/novels/:id removes project @regression", async ({ request }) => {
  88  |     const title = `delete_test_${Date.now()}`;
  89  |     const created = await request.post(baseUrl, { data: { title } });
  90  |     const { id } = await created.json();
  91  |     const removed = await request.delete(`${baseUrl}/${encodeURIComponent(id)}`);
  92  |     expect(removed.ok()).toBeTruthy();
  93  |     cleanupIds.delete(id);
  94  | 
  95  |     const list = await request.get(baseUrl).then(response => response.json());
  96  |     expect(list.novels.some((novel: { id: string }) => novel.id === id)).toBe(false);
  97  |   });
  98  | });
  99  | 
  100 | // ==================== Chapters API ====================
  101 | 
  102 | test.describe("Chapters API", () => {
  103 |   let novelId: string;
  104 |   let chapterId: string;
  105 |   let volumeId: string;
  106 | 
  107 |   test.beforeAll(async ({ request }) => {
  108 |     const resp = await request.post("/api/novels", {
  109 |       data: { title: `章节测试项目_${Date.now()}` },
  110 |     });
  111 |     const body = await resp.json();
  112 |     novelId = body.id;
  113 |   });
  114 | 
  115 |   test.afterAll(async ({ request }) => {
  116 |     if (novelId) {
  117 |       await request.delete(`/api/novels/${encodeURIComponent(novelId)}`);
  118 |     }
  119 |   });
  120 | 
  121 |   test("GET /api/chapters requires novelId @regression @negative", async ({ request }) => {
  122 |     const response = await request.get("/api/chapters");
  123 |     expect(response.status()).toBe(400);
  124 |     const body = await response.json();
  125 |     expect(body.error).toContain("novelId");
  126 |   });
  127 | 
  128 |   test("GET /api/chapters?novelId=xxx returns empty list initially @smoke", async ({ request }) => {
```