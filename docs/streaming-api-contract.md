# 聊天流式输出 — 后端接口契约

> 本文档由前端（chat-panel.js）定义，后端按此实现 SSE 流式响应。
> 前端已改造完成，**固定使用流式模式**。聊天与正文生成接口必须返回 SSE，不再降级到非流式 JSON。

---

## 1. 触发条件

聊天与正文生成接口统一走流式路径；即使请求体里出现 `config.stream: false`，后端也应返回 SSE。

```json
{
  "message": "请继续写...",
  "history": [{"role": "user", "content": "..."}, {"role": "assistant", "content": "..."}],
  "context": {
    "currentText": "...",
    "chapterTitle": "...",
    "worldBookEntries": [...],
    "characters": [...],
    "outline": [...],
    "novelTitle": "...",
    "novelId": "my-novel",
    "writingReference": {...}
  },
  "config": {
    "provider": "deepseek",
    "model": "deepseek-chat",
    "apiKey": "sk-...",
    "temperature": 0.7,
    "maxTokens": 4096,
    "stream": true
  },
  "promptTemplates": [...],
  "promptOrder": [...],
  "presetName": "__default__"
}
```

## 2. 响应格式

### 2.1 响应头

```
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
X-Accel-Buffering: no
```

### 2.2 SSE 事件格式

每个事件占一行，格式为 `data: <JSON>\n\n`。

标准 SSE 规范中 `event:` 行可选，前端目前不解析 `event:` 行，只解析 `data:` 行。如有需要可以加但非必须。

```
data: {"type":"<type>", ...payload}\n\n
```

### 2.3 事件类型一览

| type | 必须 | 发送时机 | payload |
|---|---|---|---|
| `chunk` | ✅ 是 | AI 每返回一段文字 token | `{"type":"chunk","content":"文字片段"}` |
| `reasoning` | ❌ 否 | 模型返回推理内容时（如 DeepSeek R1、Claude thinking） | `{"type":"reasoning","content":"推理文字..."}` |
| `meta` | ❌ 否 | 生成完成后（write 模式建议发送） | `{"type":"meta","context":{"used":1234,"totalBudget":100000},"memory":{...}}` |
| `done` | ✅ 是 | 流结束，必须是最后一个事件 | `{"type":"done","reply":"完整文本"}` |
| `error` | ❌ 否 | 出错时，发送后立即关闭连接 | `{"type":"error","message":"错误描述"}` |

### 2.4 完整示例

```
data: {"type":"chunk","content":"她"}

data: {"type":"chunk","content":"推开沉重的木门，"}

data: {"type":"reasoning","content":"用户希望描写一个紧张的场景，我需要加入环境描写"}

data: {"type":"chunk","content":"一阵冷风迎面扑来。"}

data: {"type":"meta","context":{"used":3240,"totalBudget":100000},"memory":{"activeEntries":[{"label":"玄铁剑","type":"world_entry"}]}}

data: {"type":"done","reply":"她推开沉重的木门，一阵冷风迎面扑来。"}
```

## 3. 三个端点的具体差异

### 3.1 `POST /api/chat/write` — 续写模式

这是最复杂的端点，前端期望的流：

```
chunk* → reasoning* → meta? → done
```

- `done.reply` 必须包含**完整累积文本**（所有 chunk 拼接结果）
- 建议发送 `meta` 事件提供 context/memory 信息
- 如果有 reference tool calling：工具调用期间**不发送 SSE**，等第二轮 AI 调用开始后再流 `chunk`。前端会显示 "Thinking (Ns)" 计时器

### 3.2 `POST /api/chat/plan` — 情节研讨

```
chunk* → reasoning* → done
```

- `done.reply` 必须包含完整文本
- 较简单，不需要 `meta` 事件

### 3.3 `POST /api/chat` — 设定制作（assist）

```
chunk* → done
```

- 最简单，不需要 `meta` 事件

## 4. 重要约定

### 4.1 `done.reply` 是最终文本

前端用 `done.reply` 做 markdown 渲染、regex 绑定、存入会话历史。**后端必须保证它是完整的**。

如果模型返回了 reasoning（思考过程），按现有非流式格式包裹：

```
[REASONING]
推理内容...
[/REASONING]

正文内容...
```

或者把 reasoning 作为独立的 `reasoning` 事件发送，前端会更优雅地展示（用 `<details>` 折叠块），此时 `done.reply` 里不需要再包 `[REASONING]` 标记。

**推荐做法**：reasoning 用独立 `reasoning` 事件发送，`done.reply` 只包含纯正文。这样前端展示效果最佳。

### 4.2 reasoning 事件

- 可在 `chunk` 之前、之间、之后发送
- 前端会累积到一个 `<details>` 折叠块中实时展示
- 如果不确定怎么拆，可以**不发** `reasoning` 事件，把推理内容按老格式包在 `chunk` / `done.reply` 的 `[REASONING]...[/REASONING]` 里

### 4.3 非流式响应已废弃

旧版非流式 JSON 响应已废弃。聊天与正文生成接口不得返回下面这种格式：

```json
HTTP/1.1 200 OK
Content-Type: application/json

{"reply": "完整回复...", "context": {...}, "memory": {...}}
```

前端检测到 `Content-Type` 不是 `text/event-stream` 时应视为协议错误，不再自动降级到一次性展示。

### 4.4 客户端断开

```js
req.on('close', () => { /* 停止 AI 调用 */ });
```

或检测 `res.destroyed`。前端点「停止」按钮会 abort fetch，后端应停止 AI 调用并关闭连接。

### 4.5 错误处理

出错时发一个 `error` 事件然后关闭：

```
data: {"type":"error","message":"API key invalid"}\n\n
```

前端会展示错误消息。

## 5. 实现参考（伪代码）

### 5.1 OpenAI 兼容 API（DeepSeek / Qwen / 豆包 等）

```js
// 设置 stream: true
const response = await fetch(`${base}/chat/completions`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
  body: JSON.stringify({
    model,
    messages,
    stream: true,
    max_tokens: maxTokens,
    temperature,
    top_p: topP,
  }),
});

// 设置 SSE 响应头
res.setHeader('Content-Type', 'text/event-stream');
res.setHeader('Cache-Control', 'no-cache');
res.setHeader('Connection', 'keep-alive');
res.setHeader('X-Accel-Buffering', 'no');

let fullReply = '';

// 逐行读取上游 SSE
for await (const chunk of response.body) {
  const lines = chunk.toString().split('\n');
  for (const line of lines) {
    if (line.startsWith('data: ')) {
      const raw = line.slice(6);
      if (raw === '[DONE]') {
        // 发送 done 事件
        res.write(`data: ${JSON.stringify({ type: 'done', reply: fullReply })}\n\n`);
        res.end();
        return;
      }
      try {
        const parsed = JSON.parse(raw);
        const delta = parsed.choices?.[0]?.delta;
        if (delta?.content) {
          fullReply += delta.content;
          res.write(`data: ${JSON.stringify({ type: 'chunk', content: delta.content })}\n\n`);
        }
        if (delta?.reasoning_content) {
          res.write(`data: ${JSON.stringify({ type: 'reasoning', content: delta.reasoning_content })}\n\n`);
        }
      } catch {}
    }
  }
}
```

### 5.2 Anthropic API

```js
const response = await fetch('https://api.anthropic.com/v1/messages', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
  body: JSON.stringify({
    model, max_tokens: maxTokens, temperature, top_p: topP,
    system: systemPrompt, messages,
    stream: true,
  }),
});

res.setHeader('Content-Type', 'text/event-stream');
// ... other headers ...

let fullReply = '';

for await (const chunk of response.body) {
  const lines = chunk.toString().split('\n');
  for (const line of lines) {
    if (line.startsWith('data: ')) {
      const raw = line.slice(6);
      try {
        const event = JSON.parse(raw);
        if (event.type === 'content_block_delta' && event.delta?.text) {
          fullReply += event.delta.text;
          res.write(`data: ${JSON.stringify({ type: 'chunk', content: event.delta.text })}\n\n`);
        }
        if (event.type === 'message_stop') {
          res.write(`data: ${JSON.stringify({ type: 'done', reply: fullReply })}\n\n`);
          res.end();
          return;
        }
      } catch {}
    }
  }
}
```

### 5.3 禁止非流式降级

```js
// 如果后端决定不做流式，直接走老代码路径
if (!req.body.config?.stream) {
  // ... 现有逻辑: callAIChat() → res.json({ reply }) ...
  return;
}
// 否则走上面的流式路径
```

## 6. 测试方法

### 用 curl 模拟

```bash
curl -N -X POST http://localhost:8765/api/chat \
  -H "Content-Type: application/json" \
  -d '{
    "message": "你好",
    "history": [],
    "context": {},
    "config": { "provider": "deepseek", "model": "deepseek-chat", "apiKey": "sk-xxx", "stream": true }
  }'
```

正常情况下你会看到逐行输出的 SSE 事件。

### 强制流式测试

把 `config.stream` 设为 `false`，后端仍应返回 `text/event-stream`；前端仍按 SSE 事件处理。
