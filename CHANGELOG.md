# 变更日志（Changelog）

以下为本次对项目 `ocr1111` 所做的修改记录与兼容/回退说明。请在本地打开页面并验证行为，若需回退我可以把变更还原。

## 2025-11-16 - 主要变更

- 删除顶部标题区（页眉）
  - 从 `index.html` 中完全移除 `<header class="top-nav">` 区块。
  - 为避免布局计算错误，已将 CSS 变量 `--header-height` 设为 `0px`（位于 `styles.css` 的 `:root` 中）。
  - 影响：页面顶部不再显示导航与品牌；设置入口仍保留在页面的设置模态（`#settings-modal`）。

- 页面主视图重构为三列即时视图（已完成于之前修改）
  - 左：功能区（包含上传/加载按钮、旋转、区域工具、识别与导出）。
  - 中：图像工作区（canvas）。
  - 右：结果区（垂直分为上：本地识别，下：AI 处理）。
  - 保留了关键元素的 `id`（例如 `#hero-upload`, `#file-input`, `#btn-ocr-local`, `#btn-ocr-ai`, `#result-text`, `#result-text-post`），以尽量避免 JS 需要大量改动。

- 文案删除与精简
  - 删除了原 `hero` 区的长宣传文案（按你的要求移除指定段落）。

- 样式（白天/夜间主题）修复
  - 修复白天模式滚动时出现黑底的问题：为 `.feature-section`, `.step-section`, `.page-footer`, `.immediate-view` 在 `body[data-theme="light"]` 下设置 `background: var(--bg-soft)`。
  - 新增 CSS 变量 `--split-gap` 用于控制三列间距，和 `--header-height`（现在为 0，若恢复 header 可修改）。

- 行为（JS）调整
  - 在 `app.js` 中：AI 识别 (`doAiOcr`) 的结果现在写入 `#result-text-post`（AI 输出框），而非默认写入本地识别框 `#result-text`。
  - 后处理（例如 翻译 / 题目抽取）与导出/复制操作已调整为：优先使用 AI 输出框的内容（若有），否则回退到本地识别结果。

## 兼容性审查（已检查项）

- JS 绑定
  - `app.js` 中对按钮和元素的选择器大多使用 `id`，我在 HTML 重构时尽量保留这些 `id` 不变，因此绑定应继续有效。
  - 特别确认的 `id`：`hero-upload`, `file-input`, `btn-load-sample`, `btn-ocr-local`, `btn-ocr-ai`, `btn-export-txt`, `btn-export-docx`, `result-text`, `result-text-post`, `btn-copy`, `btn-clear-result` 等。

- CSS 依赖
  - `.immediate-view` 的高度使用 `calc(100vh - var(--header-height))`；因为删除页眉，已将 `--header-height` 设为 `0`，避免布局溢出或空白。
  - `.top-nav` 的样式仍在 `styles.css` 中（未删除），但不再有对应 DOM 元素；这不会引发错误，仅留下未使用样式规则。

- 后端 API
  - 未修改任何后端接口。`app.js` 仍然调用 `/api/ai/ocr` 与 `/api/ai/post`；如果后端响应格式不同（例如不含 `data.text`），需要进一步调整前端解析逻辑。

## 回退与恢复说明

- 如果要恢复顶部标题区（页眉）：
  1. 在 `index.html` 手动恢复被删除的 `<header class="top-nav">...</header>` 块（如需我可提供原始内容）。
  2. 在 `styles.css` 的 `:root` 中将 `--header-height` 改回实际高度（例如 `72px`）。

- 如果要将 AI 结果再次写回本地识别框：
  - 我已把 `app.js` 修改为写入 AI 输出框并在缺失时回退到本地输出；要改为始终写入本地输出，只需将 `doAiOcr` 中对应赋值改回写入 `resultEl.value`。

## 如何本地验证（快速步骤）

1. 启动静态服务器（可避免浏览器文件协议带来的限制）：
   ```powershell
   cd D:\homework\chengxvsheji\ocr1111
   python -m http.server 8000
   ```
2. 在浏览器打开 `http://localhost:8000`，检查：
   - 页面顶部不再显示标题/导航。
   - 左侧功能区包含 `上传文件` 与 `加载示例` 按钮，并能触发文件选择。
   - 识别（本地/AI）与导出按钮在功能区且逻辑正常（本地识别使用 Tesseract，AI 识别需后端支持）。
   - AI 识别后文本显示在 AI 输出框（右侧下部），后处理按钮（翻译/识题）使用该内容。

## 后续建议

- 若你想恢复页眉但保持三列布局，我可以把页眉改为可选显示（CSS 变量控制），并在页面上添加开关。
- 如果你希望我将未使用的 `.top-nav` CSS 移除或把设置按钮移到明显位置（比如功能区顶部），我也可以一并完成。

---
如需我现在回退某项改动、把变更写入 `README.md`（而不是 `CHANGELOG.md`），或对 `app.js` 做更细致的 DOM 兼容检查（例如找出并列出所有用到的 `id`/class 并核对），请告诉我接下来优先做哪项。