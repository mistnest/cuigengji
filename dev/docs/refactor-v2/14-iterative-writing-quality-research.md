# 生成—审阅—改写：网文质量循环研究

> 状态：研究结论与可实施设计，尚未启用生产自动循环  
> 日期：2026-08-30  
> 前置约束：沿用现有 Agent 侧栏、同一会话记忆、统一写作上下文和用户最终确认权

## 1. 结论

“先生成，再由另一个视角审阅，然后按问题改写”的方向值得验证。`Self-Refine` 已证明反馈—改写迭代可以改善多类生成任务；DSH 又把 subagent 设计成 Agent loop 之外的可选插件能力，能够提供独立的一次性审阅会话。

但产品不应实现“反复改到评分器满意”的无限循环。研究同时显示，同源生成器和评价器在多轮优化中可能出现 reward hacking；LLM judge 还存在位置偏差等系统性偏差。适合催更姬的版本是：

```text
作者预设 + 本次任务 + 项目事实
            │
            ▼
        初稿 Writer
            │ 只读 Draft vN
            ▼
独立 Reviewer subagent ──→ 证据化问题单
            │                    │
            └──────── Writer 只按已确认问题改写
                                 │
                        最多再审 1～2 次
                                 │
                 达标 / 收益停滞 / 人工接管
```

默认最多三次审阅、两次改写；任何时候用户都能接受、停止或自行修改。质量循环只产生版本化草稿和审阅回执，不直接写章节、世界书、人物卡或大纲。

## 2. “标准与预设有关”应如何落地

预设不是直接拿来打一个总分，而是在每次任务开始时编译成不可变的 `PresetRubricSnapshot`：

| 部分 | 含义 | 验收方式 |
| --- | --- | --- |
| 硬约束 | 视角、人称、禁用表达、格式、明确文风规则 | 必须逐条 pass/fail，并引用原文证据 |
| 项目事实 | 世界书、人物卡、时间线、已写正文 | 发现矛盾时列出事实来源；不得凭空补设定 |
| 软目标 | 人物主动性、因果推进、冲突密度、对话辨识度、章尾牵引力 | 只给问题严重度和修改方向，不伪装成客观精确分数 |
| 本次任务 | 本章目标、必须发生/不能发生的事件、篇幅与交付格式 | 作为本轮最高优先级的任务验收 |

审阅输出使用结构化问题单，而不是一篇泛泛的“文学点评”：

```json
{
  "verdict": "revise",
  "issues": [
    {
      "criterionId": "dialogue-character-voice",
      "severity": "high",
      "location": "第 7 段",
      "evidence": "……",
      "reason": "两名角色连续使用同一套判断句，人物声音不可区分",
      "revisionIntent": "保留信息量，改由各自利益和习惯表达"
    }
  ]
}
```

Reviewer 不直接重写全文，也不输出隐藏推理；Writer 只收到草稿、规则快照和问题单。这样可以减少审阅者把自己的文风强塞给作者，也便于用户看懂每一轮为什么改。

## 3. 停止条件

一轮结束时按以下顺序判断：

1. 用户主动接受或停止：立即结束。
2. 达到三次审阅或两次改写：转为人工确认，不继续消耗模型。
3. 存在硬约束失败或高严重度事实矛盾：允许下一次改写。
4. 连续两轮没有减少高严重度问题，或改动只是在措辞间来回摆动：判定收益停滞，交给用户。
5. 硬约束全部通过，且没有高严重度问题：输出“建议接受”，由用户决定是否应用。

不使用一个诸如“文学分 90 分”的数字作为自动停止门槛。模型对主观文字给出的精确分数缺少稳定标尺，也容易诱导 Writer 讨好 Reviewer。

## 4. DSH 插件边界

当前生产 Agent 仍然不开放通用 subagent 工具。质量循环应作为新的可选插件包实现，而不是写进 `dsh-supervisor.js` 或统一上下文插件：

```text
cuigenji-quality-loop（默认关闭）
├─ preset-rubric-compiler   预设 → 本轮不可变规则快照
├─ review-run-controller    轮次、版本、预算、停止条件
├─ draft-reviewer           受限的一次性 reviewer subagent
├─ revision-receipt         现有 Agent 侧栏里的问题与版本回执
└─ evaluation-adapter       离线实验指标；不参与项目写入
```

具体约束：

- 使用 DSH `spawn-in-process` 的一次性 child，而不是继承父会话历史的 `fork`；Reviewer 只获得显式传入的草稿、规则快照和必要项目事实。
- child 使用结构化输出，`toolFilter` 为空；没有 Web、文件系统、Shell、项目知识查询、其他 subagent 或写入权限。
- 不把通用 `dsh-tool-subagent` 暴露给 Writer。由 `cuigenji-quality-loop` 的窄接口启动固定 Reviewer，防止模型自行扩张委派范围。
- 每轮绑定 `draftVersion`、`contextSnapshotId`、`presetRevision`；人或 Agent 修改后旧审阅自动失效，复用现有 revision/CAS 协作内核。
- 中间草稿、审阅问题和选择只属于当前 session。用户没有明确应用时，不进入项目事实和跨会话记忆。
- UI 继续使用现有 Agent 侧栏，显示“初稿 / 第 1 次审阅 / 第 1 次改写”等轻量回执以及“接受、继续一轮、停止”；不新增侧栏。

## 5. 朱雀 AI 检测的正确位置

腾讯朱雀可以作为实验里的一个外部观测项，但不能充当质量标准。官方页面本身明确说明结果只辅助判断，不应成为审核或处罚的唯一依据；检测模型还会持续更新，因此同一篇文本的分数没有稳定的长期可比性。

建议记录：

- 总体疑似 AI 比例；
- 被标记的段落位置；
- 每轮变化量；
- 与盲评偏好、规则违例数、用户修改量的相关性。

禁止做法：

- 以“朱雀低于 X%”作为自动达标条件；
- 把被标记段落反复同义改写直到逃过检测；
- 宣称“疑似 AI 更低等于文学质量更高”；
- 未经用户明确同意，把未发表小说自动上传第三方服务。

如果未来接入，只使用腾讯云正式 `zhuque-text` API，放在独立的可选 `evaluation-adapter`，由用户自行配置凭据并明确开启。免费网页不作为软件依赖，默认不发送任何正文。

## 6. 先做实验，不直接上线自动循环

### 6.1 小规模可行性试验

准备 12～20 个覆盖不同场景的真实匿名片段：对话、打斗、过渡、情绪、信息揭示、章尾。每个任务生成三组结果：

- A：一次生成，无审阅；
- B：同一模型自审一次后改写；
- C：独立 Reviewer subagent 审阅一次后改写。

固定 Writer 模型、温度、预设、项目上下文和字数；结果随机编号，用户不知道属于哪一组。

### 6.2 指标优先级

1. 主指标：作者盲选偏好与“是否愿意直接采用”。
2. 次指标：预设硬约束违例数、项目事实矛盾数、用户最终手改字数/比例。
3. 成本指标：token、延迟、轮数、失败率。
4. 探索指标：朱雀疑似 AI 比例及其与前三类指标的相关性。

只有 C 在主指标上稳定优于 A/B，且成本可接受，才进入生产插件实现。若朱雀分数下降但作者偏好不升，说明它没有测到我们真正关心的质量。

### 6.3 上线门槛

- 先实现“审阅一次”的手动按钮，再考虑连续两轮。
- 默认关闭自动继续；每轮由用户确认。
- 至少积累一批真实作者的接受/拒绝记录，再调整规则与停止条件。
- 任何 detector 适配器都必须与核心质量循环可拆卸，失效时不影响写作。

## 7. 资料依据

- DeepSeek Harness 将 subagent 定义为 Agent loop 之外的可选能力，并区分不继承父历史的 spawn 与继承历史的 fork：[DSH Subagent subsystem](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/subagent.md)
- 反馈—改写迭代在多类任务上能够改善初始输出：[Self-Refine, NeurIPS 2023](https://papers.nips.cc/paper/2023/hash/91edff07232fb1b55a505a9e9f6c0ff3-Abstract-Conference.html)
- 同源生成器与评价器反复优化可能产生 reward hacking：[Spontaneous Reward Hacking in Iterative Self-Refinement](https://arxiv.org/abs/2407.04549)
- LLM judge 存在位置偏差，不能把一次评分当客观真值：[Judging the Judges, IJCNLP-AACL 2025](https://aclanthology.org/2025.ijcnlp-long.18/)
- 腾讯朱雀文本检测页面明确把结果定位为辅助判断：[朱雀 AI 检测助手](https://matrix.tencent.com/ai-detect/ai_gen_txt/)
- 腾讯云公开了 `zhuque-text` 的正式调用与分段结果格式：[朱雀 AIGC 检测模型 API](https://intl.cloud.tencent.com/zh/document/product/1145/82374)
- 对 AI 文本检测的理论和实证研究要求谨慎对待检测分数及其可规避性：[Can AI-Generated Text be Reliably Detected?](https://arxiv.org/abs/2303.11156)

## 8. 本轮决策

本轮只完成统一注入、现有 Agent 插件化与研究设计，不把 subagent 质量循环悄悄加入生产工具面。下一步应先制作可复现的离线 A/B/C 试验和 12～20 个匿名样本；得到真实偏好数据后，再决定是否实现 `cuigenji-quality-loop`。
