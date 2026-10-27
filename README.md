# 验收文档与测试报告

先打开 [验收首页](index.html) 查看五类实测摘要、验收计划与结果边界；[分类报告目录](reports/index.html) 收录当前独立报告，包含阶段收口及仍有独立证据范围的报告。[data/test-plan.json](data/test-plan.json) 是后续验收计划的唯一维护入口，保留 21 个产品组、3 个辅助组及原 52 条记录的映射。批次、单个 case 和诊断不新增为产品验收项。

## 当前文档边界（2026-10-27）

- [首页五类实测摘要](index.html#highlights) 沿用当前已推送版的格式、布局和对应栏目，仅以已完成且范围一致的最新测试数据替换原实测值。
- 按本次要求，首页原 E2EE 摘要替换为 [P10 两次完整长稳结果](reports/product/p10-long-soak-results-20261027.html)，并与屏幕共享交换位置：02 为 P10，04 为屏幕共享。原 E2EE 指标、独立报告和历史失败来源继续保留。
- P10 按 10-27 明确的新口径复核，最新完整执行（89.106.76.195，TCP）为 **PASS_SCOPED（本次 P10 完整长稳范围通过，10 门 PASS）**；前次完整执行（43.142.144.42，UDP）为 **INCONCLUSIVE（7 PASS／3 INCONCLUSIVE）**。当前文档只展示新口径结果，不保留本轮旧评估结论；不跨 run 拼接通过，完整 B11、Formal 及资格信用仍为 0。
- 当前口径 `P10_HOLD_RECOVERY_MEDIA_V2_20261027`：**有效保持时长、每次动作 ACK／恢复收敛及媒体质量作为验收门**；参考音频、其余资源、采样覆盖和退出清理要求保留。**总耗时只作效率记录**，保留 **10500 秒执行看门狗**。本次固定页 1800.031 秒、混合保持 7259.757 秒，软／完整重连各 9/9 恢复，总耗时 10009.281 秒未触及看门狗。
- 服务端网卡 **RX 丢弃仅记录，不作为验收门限**；本次 **+45**、九个窗口及 `INSUFFICIENT_EVIDENCE` 归因继续保留。本次按既有实测证据更新文档及静态生成／核验规则，未修改私有运行评估器或重新运行测试。
- 两次完整操作均为：真实账号登录入会并确认百路视频＋参考音频 → 全屏 grid16 后翻页、提示条消失和布局稳定后冻结 → 固定页 1800 秒 → 连续翻页 20 次、末页保持 10 秒 → 九轮 16 动作（每次收敛后保持 50 秒，共 144 阶段／计划 7200 秒）→ grid16 后翻回基准来源、恢复观察 60 秒 → 退出并检查客户端释放及服务端任务清理。16 动作依次为：grid4、翻页、grid9、翻页、grid16、翻页、固定／取消固定、白板开启／关闭、共享开始／停止、软重连、完整重连、最小化、恢复窗口。完整说明见 [P10 子页](reports/product/p10-long-soak-results-20261027.html)。
- 未执行、仅尝试和未完成的测试暂不替换首页历史数据。已完成的独立子门按自己的范围更新，不把 `PARTIAL` 批次或不完整矩阵写为整组通过；未重测的指标保留原日期与来源。
- P01–P21 在原折叠栏目中分别展示整组阶段状态、已完成测试的原始 PASS／FAIL 等判定和剩余范围。已完成结果按来源记录计数，限定通过与授权例外保留原状态；记录数量不是用例总数或整组通过率。
- 测试服务器与客户端配置总览合并为一张表，统一折叠／展开；各原环境锚点、配置内容及来源继续保留。
- [阶段收口报告](reports/product/stage-closure-20261022.html) 按用户要求更新至10-27：**2026-10-27阶段已收口(PARTIAL)，当前剩余待测试项用户评估无较大或严重问题，批准发版0.0.1**。[用户决定](data/stage-user-disposition-20261023.json) 保留原 10-23 批准来源及本次日期修订。当前收口页与首页同步 P10 新口径 PASS_SCOPED／INCONCLUSIVE；原冻结数据、完整主门完成0和最终回归 `NOT_RUN` 保留。
- P08 当前仍为 `DEFERRED`。P10 当前以修订口径复核的 PASS_SCOPED／INCONCLUSIVE 为准；其他独立历史测试主题继续按自身日期和范围解释。
- 遥测最新正式60秒配对重测为六窗、三对全部 `PASS`；callback P99保守增幅分别为 `-11.4369501466%／-6.7586206897%／-16.2601626016%`，CPU、工作集及UI批次均满足原门限。P13当前整组为 `PARTIAL`，完成结果 **6 PASS／0 FAIL**（三对及三个独立资源／生命周期子门）；最终输入贯通和完整主门未关闭。原180秒表及旧首对 `7.014681892332786% > 5%` 的历史 `FAIL`、`UNKNOWN` 根因保留各自日期与来源，旧失败不重复计入当前结果。
- [10-19 冻结 Formal 运行](reports/b14/b14-clipboard-readmission-20261019-01.html) 的处置为 `PASS_WITH_USER_EXCEPTION`。原机器 `FAIL`、第 52 周期唯一 NIC 超限的限定授权例外、未验证的流量归属及既有 `DEFERRED` 保留。
- 10-22 后续已完成结果更新到原栏目：P06 三项派生 Native 直接运行、P14 当前 diagnostic-ON 产品三对 EXE／DLL／PDB 身份及两份 runtime renderer 部署副本校验通过、P18 远控诊断输出 ON／OFF 工程门；各自仅授原范围。P14 当前工件身份采用 [10-22 已完成回执](data/completed-evidence/repair-artifact-identity-20261022-result.json)，10-21 旧部署 age 错配及原始证据仅保留历史追溯，不重复计入当前结果；整组仍为 `PARTIAL`，源码对应、最终发行及安装升级等未测边界保留。A01 记录换钥源码合同与 observer registry 离线验证。收据及 SHA256 见 [完成来源索引](data/completed-evidence/repair-validation-20261022-sources.json)。入会前中止、零媒体互通尝试和准备项不替换原 Flutter 失败；容量和校时无新同范围完成结果，继续保留原数据。
- P05／P06当前组状态与原失败子门按用户要求改为 **DEFERRED**，对应两类bug、三条共享失败来源；首页区分当前处置与原实测FAIL，历史证据及replace-two衍生PASS保留。[详细原因及推荐修复方案](reports/product/p05-p06-deferred-remediation-20261022.html) 记录同slot旧KeySet竞态、仅本次隔离run确认的SFU补帧链路、优先A1可行性／需要复用时采用B／A2影响面，以及串并行顺序和关闭条件。本轮仅文档处置，未修复或重测。
- P05／P06共用的 [17:20修复衍生复测](data/completed-evidence/flutter-original-failures-retest-20261022-scoped.json) 保留 replace-two `PASS 66/66`、flutter-full `FAIL 69/70`（522帧中6异常）。[18:03隔离RTP／SIF诊断](data/completed-evidence/flutter-full-rtp-sif-20261022-diagnosis.json) 仅确认本次隔离run的6帧来自SFU关闭旧轨时生成的VP8 blank frame，经Native SIF兼容路径交付；该run仍 `FAIL 69/70`（508帧中6异常），信用0，不新增产品计项，不替换shared复测或追判其历史帧来源。
- P19 摄像头二次入会按 [原专项33项PASS及首帧超时确定性测试](data/completed-evidence/p19-camera-rejoin-20261023-scoped.json) 显示 **PASS_SCOPED（33 PASS／0 FAIL）**，保留2026-10-19原输入和日期；像素质量、原始DirectShow／转换失败、编码器／逐帧RTP及真实硬件超时注入继续列作未测边界。当前本机三次完整资格为 `READY`，其他host独立判定，P19整组仍 `PARTIAL`；原资格收据的Formal `NOT_RUN`保持原字节，后续完整Formal结果独立见P20，不由资格结果抵扣。
- P20 当前组及最新完整100周期／8小时Formal按用户决定为 `user_pass`；原机器Private Bytes增长95.869140625 MiB超64 MiB的 `FAIL` 和各历史run分别保留，后续内存定位与门限建议另行处理。0.0.1 原批准来源保留，当前阶段收口日期按上方要求更新为10-27。
- P09 采用 [10-22 同批11项网络矩阵](data/completed-evidence/p09-network-eleven-20261022-scoped.json)：**11 PASS／0 FAIL**，清理、输入与 terminal 工件身份、环境及安全组恢复均 PASS。旧批次 FAIL 和独立 TURN 原判定留在历史来源，退出当前结果计数；批次汇总不重复计作第12项。当前整组为 `PARTIAL`，保留物理断网、实际音频、UDP／RTP故障日志和故障后实时导出等剩余范围。P02仅更新同批接收端 snapshot／存储关闭；P12、P17独立导出和复盘结果仍按各自原日期与来源保留。

以上仅整理已有报告，本次没有启动产品重测。运行状态、HEAD 和结果均按各报告的记录时间及输入解释。

## 目录职责

| 路径 | 内容与维护方式 |
| --- | --- |
| `index.html` | 沿用已推送版布局的五类实测摘要、验收计划与结果视图 |
| `reports/index.html` | 自动生成的当前报告目录，分类内按报告日期排序 |
| `reports/product/` | 产品功能、界面、媒体及阶段补测报告 |
| `reports/b14/` | 环境冻结、资格准入、Formal 运行与故障处置 |
| `reports/memory/` | 堆、系统保留、资源归属与优化诊断 |
| `reports/tooling/` | 自动化、测量合同、准备与准入工具报告 |
| `data/test-plan.json` | 唯一计划源；独立子门、门限、条件、暂停边界及批次备注 |
| `data/report-input.json` | 原始分类基准；保留历史全文与输入身份 |
| `data/report-catalog.json` | 生成的当前报告索引及结构化状态；不作为第二份测试计划 |
| `data/report-migrations.json` | 原路径、新路径、迁移指纹与原附件缺失记录 |
| `data/` 其他文件 | 首页派生数据、历史指标、环境及轻量结果 |
| `assets/` | 首页样式与交互源码 |
| `scripts/` | 文档整理、生成和静态核验入口 |
| `evidence/`、`inputs/`、`audit/` | 本机重型证据、输入和审计，继续由 `.gitignore` 忽略 |

HTML 与同名 JSON 相邻存放。HTML 的相对链接随目录调整，JSON 原始结果只移动、不重写。原 HTML 的本机备份位于已忽略的 `audit/report-layout-originals/`，不加入分发清单。旧根目录文件名到新位置的对应关系可查询迁移表。

59 份旧 HTML 和 12 份同名 JSON 已移到项目根目录的 `out/acceptance-history-20261021-latest-only/`，原分类路径保留于其 `reports/` 下，文件路径、字节数和 SHA256 见 `archive-index.json`。当前目录保留的报告各自覆盖独立范围，日期较早但仍有未被替代的已完成结果时继续保留。底层 `audit/`、`evidence/`、`inputs/` 未随旧报告迁出。

## 日常维护

1. 在 `data/test-plan.json` 的现有组／子门维护计划与批次边界；不另建重复清单。
2. 新报告直接写入对应的 `reports/<分类>/`，同名 JSON 保持相邻。包根数据链接使用 `../../data/...`，跨报告链接按实际目录计算。
3. 在本目录执行生成和核验命令：

   ```powershell
   node scripts/assemble.mjs
   node scripts/validate.mjs
   ```

   从项目根目录执行时使用 `node samples/acceptance/scripts/assemble.mjs` 和 `node samples/acceptance/scripts/validate.mjs`。

4. 默认核验轻量文档包；仅在重型历史附件齐全且需要核验完整证据时使用 `node scripts/validate.mjs --full`。静态核验不启动产品、构建、CTest、真实服务或长稳。

默认静态核验会按归档索引检查迁出的 71 个文件，并验证当前报告目录和迁移追溯；需要本机 `out/acceptance-history-20261021-latest-only/`。迁移专项核验使用 `node scripts/validate.mjs --verify-migration`，额外核对整理前的本机备份、原 JSON、证据指纹与原链接目标，需要 `audit/report-layout-originals/`。仅保留报告中指向已迁出旧报告的链接调整为归档路径。

旧工具若仍把新报告写到根目录，先运行 `node scripts/organize-reports.mjs` 再生成。该命令只处理根目录独立 HTML 与同名 JSON，遇到目标冲突立即停止，保留原文备份。分类整理已完成；目录整理不改变测试计划或授予产品验收信用。

目录状态优先取同名 JSON 顶层 `status`／`verdict`／`result`；没有结构化总状态时明确标记，不从正文中的局部 PASS 推断整份报告通过。目录元数据不增加首页展示栏目。

## 附件与结果解释

- 包内链接应可定位；历史原件未留存时明确说明，不补造证据。
- 指向项目 `out/`、私有测试仓库或 `file:///` 的附件依赖本机路径，轻量副本和其他电脑可能不可访问。文档静态核验单独统计这些本机附件，不把它们作为可移植包内链接通过。
- 历史 FAIL、UNKNOWN、INCONCLUSIVE、NOT_RUN、DEFERRED 和授权例外均保留。诊断、工程／静态 PASS、局部子门或不同 run 的投影不代表当前源码完整验收或 Production Ready。
- 文档结构与链接检查通过不等于浏览器排版、真实媒体、设备或长期稳定性通过；未执行范围仍为 `NOT_RUN`。
