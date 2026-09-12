# DESIGN — 四頁案件介面視覺與互動基線

> **Status：Revised proposal / ongoing design discussion**。本文件 supersede 先前的 accent-based visual proposal，先以標準 shadcn 中性灰階作為可接受基線。產品範圍仍以根目錄 `INTENT.md` 與 `frontend/INTENT.md` 為準。

> **DEFERRED / NON-AUTHORITATIVE FOR CURRENT IMPLEMENTATION**：本文件目前只保留供後續設計討論的記錄，不得影響或驅動現在的 frontend implementation。當前實作只採用 shadcn default components；不要依本文件新增視覺變體、客製配色、元件形狀或裝飾。

## 決策紀錄

`outputs/design-preview/index.html` 的 standalone preview 已被 review，整體感受比純 shadcn 更差，因此**拒絕作為視覺方向**。它不是 approved implementation authority；不要從該 preview 推導品牌、配色、元件形狀或自訂裝飾。

## 介面立場

這是給內部營運人員使用的案件工具：固定左側導覽、熟悉的表格／Tabs／Button／Checkbox／Badge、安靜的 1px 邊界和清楚的資料層次。視覺先服從閱讀與操作，不建立未授權的品牌名稱、商標、官方標誌或官方身分。

四個頁面類型是 `訊號收件匣`、`案件列表`、`案件詳情`、`Trace`；固定左側導覽只列三個主要入口：`訊號收件匣`、`案件`（列表與詳情）、`Trace`。案件詳情包含 `案件概覽`、`相關商品`、`案件時間軸` 三個分頁。

Trace 採 presentation-first：第一視線是目前步驟、負責角色、結果、狀態與 before/after；原始輸入、工具細節與技術 log 放在可展開區。播放、暫停、跳步和速度調整只讀取已保存紀錄，不產生新的核可、執行或 API 費用。

## 標準 shadcn 中性基線

沿用現有 shadcn component vocabulary 和 CSS variables；暫時不使用橘色、棕色、漸層、玻璃效果或大型陰影。主要行動使用標準深色 `primary`，次要行動用 `outline`／`secondary`／`ghost`。紅色只出現在危險和執行失敗。

| Token | 建議值 | 用途 |
| --- | --- | --- |
| `--background` | `0 0% 100%` | 頁面與主要 surface |
| `--foreground` | `0 0% 3.9%` | 主要文字 |
| `--card` | `0 0% 100%` | 卡片／表格 surface |
| `--primary` | `0 0% 9%` | 主要按鈕、目前選取 |
| `--primary-foreground` | `0 0% 98%` | 深色 primary 上的文字 |
| `--secondary` / `--muted` | `0 0% 96.1%` | 次要按鈕、工具列、弱背景 |
| `--secondary-foreground` / `--accent-foreground` | `0 0% 9%` | 次要層上的文字 |
| `--muted-foreground` | `0 0% 45.1%` | 輔助文字、時間、來源 |
| `--border` / `--input` | `0 0% 89.8%` | 結構邊界與表單邊界 |
| `--ring` | `0 0% 9%` | 鍵盤 focus ring |
| `--destructive` | `0 72% 42%` | 危險、失敗；其他狀態不用紅 |
| `--radius` | `0.5rem` | shadcn 預設級圓角；不使用大圓角或 pill 卡片 |

對比基準：`#0A0A0A` on white 為 19.80:1，`#737373` on white 為 4.74:1，`#171717` on `#FAFAFA` 為 17.18:1；內文與 placeholder 維持至少 4.5:1，粗體 14px 以上或 18px 以上文字維持至少 3:1。`#B91C1C` on white 為 6.47:1，僅供 danger／failure 使用。邊框是結構線，不用低對比邊框傳達文字語意。

## 元件與比例

- **Button**：沿用 shadcn `default`、`outline`、`secondary`、`ghost`、`destructive`；default 高 40px、small 36px、large 44px，水平 padding 16／12／24px。不要另造巨型 CTA、圓形操作鈕或品牌化按鈕。
- **Input／Select／Checkbox／Tabs**：使用現有 shadcn 尺寸、focus、disabled、loading 和 error 規則；控制項標籤用 `text-sm`，不可只用 placeholder 當標籤。
- **Card／Panel**：只在需要分組時使用；白底、1px `border`、6–8px 圓角、無裝飾陰影。不要巢狀堆疊多層 card，也不要彩色側條。
- **Badge／狀態**：以 `outline` 或 `secondary` 為預設，文字和圖示先於色彩；只有危險／失敗才套 destructive。
- **Icon**：使用 `lucide-react` 的實際圖示（例如 Inbox、BriefcaseBusiness、Play、Pause、Clock3、Link2、CircleAlert、Check、ChevronRight）；不要以 Unicode、emoji 或字體 glyph 代替圖示。icon-only button 必須有 `aria-label`。

## 字體與間距

使用單一系統 sans：`ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans TC", "PingFang TC", sans-serif`。維持 shadcn 常見產品比例，不使用 display font 或流動式標題。

| 用途 | 字級／行高 | 字重 |
| --- | --- | --- |
| 頁面標題 | `24px / 32px`（`text-2xl`） | 600–700 |
| 區段標題、Trace 步驟 | `18–20px / 26–28px`（`text-lg`／`text-xl`） | 600 |
| 內文、主要結論 | `16px / 24px`（`text-base`） | 400–600 |
| 導覽、控制項、表格值 | `14px / 20px`（`text-sm`） | 400–600 |
| 輔助文字、來源時間 | `12px / 16px`（`text-xs`） | 400–500 |

間距沿用 4px 基底，優先使用 `p-4`、`p-6`、`gap-4`、`gap-6`、`mt-8` 等既有 Tailwind／shadcn 比例。頁面內容通常 24px padding，區段 24px gap；資料密集處保持 16px gap。文字段落維持 65–75ch。

## Shell 與頁面閱讀順序

- 左側導覽固定約 240px，白底或 `muted` 灰階底、1px border 分隔；目前入口使用 `secondary`／`accent` 灰階，不能依賴彩色線條。
- 主區域保留單一 `h1`、清楚的資料模式標籤（`範例 mock`、`已保存回放`、`現場執行`），並用 `nav`、`main`、skip link 建立 landmarks。
- **訊號收件匣**：先看原始摘要、來源／時間、訊號類型、重複或獨立來源、關聯案件；完整原文可展開。
- **案件列表**：作為日常首頁，先比較案件、業務影響、優先級、查核、商品關聯、目前狀態、最新變化與下次追蹤。
- **案件詳情**：概覽先說判斷、證據、未知事項、下一步；相關商品分開處理候選、核可與執行；時間軸保留歷史版本。
- **Trace**：先顯示情境、目前步驟／結果、before/after、角色和播放控制；raw input／tool detail 以展開區承載。人工核可節點暫停，繼續只展示保存紀錄。

## 語意區分

每個維度都必須有固定文字、欄位名和 Lucide 圖示；灰階視覺不可讓不同語意合成一個泛用「狀態」。

| 維度 | 固定詞彙 | 顯示規則 |
| --- | --- | --- |
| 業務影響 | 機會、風險、雙向、無實質影響、待判定 | 標籤 + 對應圖示；只有風險可視為 danger 語意，待判定不能寫成無實質影響 |
| 調查優先級 | `危急`（critical）、`高`（high）、`中`（medium）、`低`（low） | 文字與排序優先；不以顏色冒充查核可信度 |
| 陳述查核 | 支持、反駁、證據不足、不適用 | 標籤 + 圖示 + 證據數；`主觀／需求` 是獨立的陳述類型，不是查核結果 |
| 商品關聯 | 候選、已確認關聯、已排除 | 標籤 + 關聯理由；資料缺口是獨立屬性，不是關聯 enum |
| 核可／執行 | 待核可、已核可待執行、執行中、已下架、失敗、核可失效 | 每項商品逐項顯示；核可和執行分兩步，紅色只給失敗／危險 |

證據區塊固定順序為：查核標籤 → 陳述摘要 → 支持／反駁摘要 → 原始來源／時間 → 適用範圍與未知事項。外部證據、模擬商品資料、系統處理紀錄和回放紀錄要有來源標籤，不把候選或 mock 寫成已證實／已執行。

## 表格、時間軸與核可

- 表格用 1px quiet border、表頭和對齊來建立結構；日常列高約 44px，空狀態、載入骨架和錯誤重試都在表格附近表達。
- 時間軸每筆保留來源發布時間、系統取得時間、處理時間、角色、動作、摘要和可回溯對象；案件變化以「之前 → 新證據／動作 → 之後」呈現。
- 相關商品先勾選，再顯示案件版本與核可摘要；版本變更使舊核可失效，要求重新確認。執行結果逐項寫成 `已下架` 或 `失敗`，失敗提供原因和重試入口，不用一次 toast 宣稱整批成功。
- Trace 播放、跳步、暫停和速度調整不修改商品、核可或執行資料；展示當時的保存狀態，不用最新案件覆蓋歷史。

## 日常與投影密度

元件、token、文案和語意完全相同，只調整密度：日常桌面使用 14px 表格與約 44px 列高，投影將主要文字提升至 16–18px、列高 56–60px，收合次要 metadata，把目前步驟、結果和 before/after 留在首屏。投影保留固定左側導覽，不使用自動輪播、高飽和大色塊或 AI 思考動畫。

## 鍵盤、焦點與動態

- Tab 順序為 skip link → 固定導覽 → 篩選／播放控制 → 表格或 Trace step → 詳情操作；Tabs 使用 `aria-selected`，目前入口使用 `aria-current`。
- Focus 使用 2px 深色 ring + 2px offset，不能只依 hover；checkbox 有可點標籤，icon-only button 有 accessible name。
- 載入用 skeleton；背景更新用 `role="status"`，阻斷性錯誤用 `role="alert"`，錯誤文案說明原因和下一步。
- 動效只表達狀態、選取、展開和回放位置，約 150–250ms；`prefers-reduced-motion: reduce` 時停用位移、自動播放與裝飾轉場，只保留立即可讀的狀態變化。

## 討論狀態與驗收

本文件內容 deferred，仍 subject to ongoing user design discussion，且不是目前 frontend implementation 的 authority。當前實作只採用 shadcn default components；未來若要採用本文件的其他內容，需先經新的設計決策。固定 sidebar、Trace presentation-first、語意欄位分離和標準 shadcn 灰階仍是記錄中的討論方向；實作驗收至少確認：四個頁面類型由三個主要入口可達、候選／核可／執行不混淆、版本變更會阻擋舊核可、Trace 回放不產生副作用、鍵盤與 reduced motion 仍可理解全流程。
