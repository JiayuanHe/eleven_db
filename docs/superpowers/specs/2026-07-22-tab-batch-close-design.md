# 标签页批量关闭功能设计

## 1. 概述

为标签栏添加批量关闭功能，支持通过下拉菜单关闭左侧所有标签、右侧所有标签、其他标签或全部标签。

## 2. 当前实现

- 位置：`src/renderer/views/App.tsx`
- 状态：`useState<WorkTab[]>(tabs)` + `useState<string>(activeTabId)`
- 关闭逻辑：`closeTab(id)` 仅支持单标签关闭
- 无右键菜单，无批量操作

## 3. 功能设计

### 3.1 新增状态

```typescript
const [dropdownOpen, setDropdownOpen] = useState<'left' | 'right' | 'others' | 'all' | null>(null);
```

### 3.2 新增函数

| 函数 | 行为 |
|------|------|
| `closeLeftTabs(id: string)` | 关闭当前标签左侧所有标签 |
| `closeRightTabs(id: string)` | 关闭当前标签右侧所有标签 |
| `closeOtherTabs(id: string)` | 关闭除当前标签外的所有标签 |
| `closeAllTabs()` | 关闭所有标签，保留一个空白查询标签 |

### 3.3 UI 变更

- 标签栏右侧添加「+」按钮，点击展开下拉菜单
- 菜单项：
  - 关闭左侧所有标签
  - 关闭右侧所有标签
  - 关闭其他标签
  - 关闭所有标签
- 点击空白处或菜单项后自动关闭菜单

### 3.4 交互逻辑

- 关闭左侧：找到当前标签索引，删除其左侧所有标签
- 关闭右侧：找到当前标签索引，删除其右侧所有标签
- 关闭其他：删除除当前标签外的所有标签，若无当前标签则保留第一个
- 关闭全部：保留一个新建的空白 SQL 标签

## 4. 实现文件

- `src/renderer/views/App.tsx` — 添加状态、函数、UI
- `src/renderer/styles.css` — 添加下拉菜单样式（如需要）

## 5. 边界情况

- 只有一个标签时，批量关闭操作无实际效果
- 当前标签被关闭时，自动切换到相邻标签
- 下拉菜单展开时点击自身不重复触发
