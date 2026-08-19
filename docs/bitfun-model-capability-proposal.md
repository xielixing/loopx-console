# BitFun 宿主提案：模型目录暴露多模态能力标志

版本：v1 · 状态：待 BitFun 侧评估（本提案只读，不修改 BitFun 仓库）

## 1. 目标

MiniApp 需要知道当前选中模型是否支持图像理解（多模态），以便做**图片感知
的保守决策**：GitHub issue 的关键信息常藏在截图里，纯文本模型盲改会产出
错误修复——loopx-console 已实现入库确认单的图片警告（见 AGENTS.md §5
「图片感知保守策略」），但能力探测目前只能靠名称启发式。

## 2. 现状（已核实宿主源码）

- `ModelCapability::Multimodal` 在 `src/crates/assembly/core/src/service/config/types.rs`
  已存在（`config/service.rs` 按 `ModelCategory::Multimodal` 归类能力）；
- 但 `miniapp_api.rs::miniapp_ai_list_models` 组装 `MiniAppAiModelDescriptor`
  时只映射了 `supports_text_chat`（`ModelCapability::TextChat`），
  **多模态标志没有透出给 MiniApp**。

## 3. 建议改动（BitFun 侧，一处）

`MiniAppAiModelInfo`（及组装处）增加一个字段：

```rust
supports_multimodal: model.capabilities.iter().any(|capability| {
    matches!(capability, bitfun_core::service::config::types::ModelCapability::Multimodal)
}),
```

## 4. MiniApp 侧配套（宿主落地后启用）

`modelSupportsVision()`（loopx-console `source/ui.js`）已优先读取能力字段
（`capabilities` 包含 vision/multimodal 即视为支持），宿主字段透出后自动
生效，名称启发式退居兜底。

## 5. 收益

- issue 含图片 + 非多模态模型 → 入库确认单黄色警告（现状靠启发式，可能误判
  新发布的多模态模型）；
- 未来若 BitFun 开放"图生文/附件"桥，可复用同一字段做能力门。
