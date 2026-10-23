import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import vm from 'node:vm';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {consolidateTests} from './consolidate-tests.mjs';
import {renderB14Procedure, renderB14Measured, renderTimingDefinitions} from './render-b14.mjs';
import {renderHighlightEnvironments, renderEnvironmentOverview} from './render-environments.mjs';
import {renderMemoryUsage} from './render-memory.mjs';
import {refreshCompleted} from './refresh-completed.mjs';
import {refreshHistory} from './refresh-history.mjs';
import {refreshStage} from './refresh-stage.mjs';
import {refreshPlanResults} from './refresh-plan-results.mjs';
import {buildReportCatalog, renderReportDirectory} from './report-catalog.mjs';

const dest = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sha = buffer => crypto.createHash('sha256').update(buffer).digest('hex');
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const show = value => Array.isArray(value) ? value.join('；') : value && typeof value === 'object' ? JSON.stringify(value) : String(value ?? '');
const readJSON = async name => JSON.parse((await fs.readFile(path.join(dest, name), 'utf8')).replace(/^\uFEFF/, ''));
const data = consolidateTests(await readJSON('data/report-input.json'));
data.b14CycleSummary = await readJSON('data/b14-100-cycle-summary.json');
data.testEnvironments = await readJSON('data/test-environments.json');
data.memoryUsageSummary = await readJSON('data/memory-usage-summary.json');
await refreshCompleted(dest, data);
await refreshHistory(dest, data);
await refreshStage(dest, data);
await refreshPlanResults(dest, data);
const reportCatalog = await buildReportCatalog(dest);
data.meta.documentRevisedAt = new Date().toISOString();
const revisionDate = new Intl.DateTimeFormat('sv-SE', {timeZone: 'Asia/Shanghai', dateStyle: 'short'}).format(new Date(data.meta.documentRevisedAt));
data.meta.scope = revisionDate + ' 沿用已推送版格式与布局，仅更新已完成且同范围的最新测试数据；未执行、仅尝试和未完成范围保留原数据';
data.documentRevision = {date: revisionDate, changes: ['沿用已推送版五类实测卡片、表格、导航及布局', '纳入10月22日阶段收口及新增已完成子门；正式失败与各自范围保留', '仅替换已完成同范围测试的对应指标，未执行及未完成范围不更新', '旧独立报告迁出当前目录，原始证据与唯一测试计划保留'], product_runtime: 'NOT_RUN', evidence_baseline: data.meta.evidenceBaselineAt};
data.documentRevision.changes.push('原产品验收栏目同时展示整组状态、已完成测试原判定与剩余范围', '测试服务器与客户端配置总览合并为一张统一折叠的表格', '纳入10月22日已完成的三Native直接运行、远控输出工程门及当前产品三对工件身份；源码／工具门单列原辅助范围，未完成尝试不覆盖原失败', 'P20采用10月23日最新完整100轮／8小时实测，原Formal FAIL保留；用户风险接受暂定PASS另列，并补齐五次历史逐轮摘要统计');
data.documentRevision.changes.push('P09更新为最新同批11项软件网络矩阵11 PASS／0 FAIL，整组PARTIAL；旧批次原判定保留历史，批次汇总不重复计项。P02仅更新同批snapshot及存储关闭范围');
data.documentRevision.changes.push('P13按最新安全回执更新每侧60秒正式配对的已完成结果；原门限、失败即停止规则、旧正式FAIL、180秒历史表和独立资源门保留，完整P13信用0');
data.documentRevision.changes.push('P13当前整组PARTIAL、完成结果6 PASS／0 FAIL；冻结FAIL保留历史。P05／P06补充18:03独立隔离RTP／SIF完成诊断，仅解释本次空白帧生产者链路，不替换shared复测、不新增验收计数');
data.documentRevision.changes.push('P05／P06按用户要求将当前失败处置改为DEFERRED；保留原实测FAIL、日期及来源，登记两个共享bug、优先A1／条件备选B和后续串并行修复顺序，本轮未修复或重测');
data.documentRevision.changes.push('P15最新双机LAN软件校时PASS：媒体经阿里云SFU，最大保守不确定度2.898ms低于原10ms门，30/30有效并完成独立误差包络复算；历史41.258ms及26.496ms FAIL保留，真实产品媒体与物理测量门未执行，整组PARTIAL');
data.documentRevision.changes.push('P19摄像头二次入会子项按原33/33 PASS及首帧超时确定性测试更正为PASS_SCOPED；保留2026-10-19原输入／日期、当前三轮资格READY、其他host和Formal独立边界，整组PARTIAL');
const productPlans = data.retestRecords.filter(record => record.plan_kind === 'product');
const auxiliaryPlans = data.retestRecords.filter(record => record.plan_kind === 'auxiliary');
const timestamp = new Intl.DateTimeFormat('sv-SE', {timeZone: 'Asia/Shanghai', dateStyle: 'short', timeStyle: 'medium'}).format(new Date(data.meta.documentRevisedAt));
const sourceInfo = value => data.portableFiles[String(value).replaceAll('\\', '/').toLowerCase()];
const sourceLink = (value, label) => sourceInfo(value)?.portable_path ? '<a href="' + esc(sourceInfo(value).portable_path) + '">' + esc(label || value) + '</a>' : '<span class="source-missing">' + esc(label || value) + '（原来源缺失；仅保留封存摘要）</span>';

const toolbar = prefix => `<div class="toolbar" role="search" aria-label="${prefix === 'retest' ? '产品验收计划' : prefix === 'aux' ? '附属计划' : '基准日工具结果'}筛选">
<input id="${prefix}-q" type="search" aria-label="关键词" placeholder="搜索主题、原条目编号或验收子门…">
<label>领域<select id="${prefix}-domain"><option value="">全部领域</option></select></label>
<label>${prefix === 'report' ? '原结果类别' : '阶段结果类别'}<select id="${prefix}-state"><option value="">全部类别</option><option value="PASS">通过记录</option><option value="FAIL">失败记录</option><option value="OTHER">其他／未完成</option></select></label>
<label>${prefix === 'report' ? '原具体状态' : '当前阶段状态'}<select id="${prefix}-status"><option value="">全部具体状态</option></select></label>
<button id="${prefix}-expand">展开</button><button id="${prefix}-collapse">折叠</button><button id="${prefix}-reset">重置</button></div>
<div id="${prefix}-count" class="status-line" aria-live="polite"></div><div id="${prefix}-list"></div><div id="${prefix}-empty" class="empty" hidden>没有匹配的记录。可调整筛选或重置。</div>`;

const highlightCards = data.highlights.map((highlight, index) => `<article class="highlight-card" id="${esc(highlight.id)}">
<div class="highlight-heading"><span class="highlight-number">0${index + 1}</span><div><h3>${esc(highlight.title)}</h3><span class="badge ${/FAIL/.test(highlight.status) ? 'bad' : 'good'}">${esc(highlight.status)}</span><span class="scope-tag">限定范围结果</span></div></div>
<p>${esc(highlight.summary)}</p><p class="boundary"><b>适用范围：</b>${esc(highlight.scope)}</p>
<details><summary>查看实测指标、原门限与测试环境</summary><p class="note">原执行日期：${esc(highlight.date)}</p>
${renderHighlightEnvironments(highlight.environmentIds, data.testEnvironments.profiles)}${renderB14Procedure(highlight, data.b14CycleSummary)}
<div class="table-wrap"><table class="highlight-metrics"><thead><tr><th>指标</th><th>实测值</th><th>原门限／期望</th><th>单位</th></tr></thead><tbody>${highlight.metrics.map(metric => highlight.id === 'highlight-b14' && metric.name === '运行时长' ? '<tr><th scope="row">' + esc(metric.name) + '<small class="stat-note">UIA 全程／产品进程存活</small></th><td><strong>UIA 全程 ' + esc(show(metric.value)) + '</strong><br><small>产品进程存活 ' + esc(show(data.b14CycleSummary.process.product_live_seconds_before_close)) + '（关闭前实际存活）</small></td><td>' + esc(show(metric.limit)) + '</td><td>' + esc(metric.unit || '—') + '</td></tr>' : '<tr><th scope="row">' + esc(metric.name) + '</th><td><strong>' + esc(show(metric.value)) + '</strong></td><td>' + esc(show(metric.limit)) + '</td><td>' + esc(metric.unit || '—') + '</td></tr>').join('')}</tbody></table></div>
${renderB14Measured(highlight, data.b14CycleSummary, data.timingMeasurements)}<details><summary>指标依据、报告与限制</summary><ul>${highlight.metrics.map(metric => '<li><b>' + esc(metric.name) + '：</b>' + esc(metric.basis) + '</li>').join('')}</ul><ul>${highlight.limitations.map(item => '<li>' + esc(item) + '</li>').join('')}</ul><ul class="sources">${highlight.sources.map((source, i) => '<li>' + sourceLink(source, '报告依据 ' + (i + 1)) + '<br><small>' + esc(sourceInfo(source)?.portable_path ? 'samples/acceptance/' + sourceInfo(source).portable_path : '原来源缺失') + '</small></li>').join('')}</ul></details></details></article>`).join('');

const mappingRows = data.retestRecords.map(record => '<tr><td>' + esc(record.originalIds.join('、')) + '</td><td><a href="#' + (record.plan_kind === 'product' ? 'retest' : 'aux') + '-' + record.id + '">' + esc(record.plan_code + ' · ' + record.title) + '</a></td><td>' + (record.plan_kind === 'product' ? '合并为产品验收组；子门分别判定' : '附属工具／诊断，按所依赖的门执行') + '</td></tr>').join('');
const consolidationHTML = `<details class="appendix"><summary>合并与删除依据 · 52 条原记录的去向</summary><p>合并采用同一主题、可共用准备环境和工件的执行组；保留每个场景的断言、门限和独立结果。codec、后端、物理条件与负载矩阵均保留，不用一个代表场景替代整组。</p><div class="table-wrap"><table><thead><tr><th>原条目</th><th>维护入口</th><th>处理方式</th></tr></thead><tbody>${mappingRows}<tr><td>T028</td><td>P11 白板／批注的证据归档动作</td><td>移出执行清单：先归档用户已执行反馈，只有缺口进入对应子门。</td></tr><tr><td>T029</td><td>各领域验收组</td><td>删除独立综合摘要测试：复用各领域同一冻结输入的结果，不再重复跑整批摘要。</td></tr></tbody></table></div><p><a href="data/test-plan.json">维护计划与去重规则</a> · <a href="data/report-input.json">原始 52 条记录及历史基准</a>。旧编号可在上方搜索；此映射用于追溯，不新增待测项。</p></details>`;

const cleanup = data.cleanupSummary;
const cleanupHTML = `<section id="cleanup"><h3>历史磁盘清理回执</h3><p>2026-10-12/13 已删除 ${cleanup.deleted_files.toLocaleString('zh-CN')} 个历史文件，按文件长度合计 ${cleanup.deleted_gib} GiB；${cleanup.held_or_failed} 个文件因访问权限保留，${(cleanup.remaining_bytes / 1048576).toFixed(2)} MiB。本次未删除证据或重新盘点磁盘。</p><p><a href="${esc(data.auditFiles[cleanup.receipt])}">原清理回执</a> · <a href="audit/cleanup/cleanup-history-remaining-plan.json">原剩余文件清单</a>。统计保留原执行日期与版本边界。</p></section>`;
const css = await fs.readFile(path.join(dest, 'assets/report-style.css'), 'utf8');
const clientScript = await fs.readFile(path.join(dest, 'assets/report.js'), 'utf8');
new vm.Script(clientScript);
const serial = JSON.stringify(data).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Cohavora · 验收计划与证据</title><style>${css}</style></head><body>
<header class="hero"><div class="kicker">COHAVORA · ACCEPTANCE</div><h1>验收计划与测试证据</h1><p>按验收目标组织执行组，按原版本保留结果。先看实测摘要，再查阅待测范围与历史依据。</p><div class="tags"><span>文档修订 ${esc(timestamp)} · 北京时间</span><span>证据分类基准 2026-10-12/13</span><span>本次仅更新文档</span></div></header>
<div class="shell"><aside><nav aria-label="报告目录"><a href="#decision">验收结论</a><a href="#highlights">五类实测摘要</a><a href="#retests">产品验收计划 · ${productPlans.length}</a><a href="#memory-usage">平均内存占用</a><a href="#test-environments">原测试环境</a><a href="#history">历史最终结果</a><a href="#appendix">工具与审计附录</a></nav><p>计划按当前阶段状态筛选；历史结果保留原状态。PASS 与 PASS_SCOPED 精确区分。</p><button id="print-main">打印报告</button><p><a href="data/test-plan.json">维护验收计划</a><br><a href="data/report-data.json">完整结构化数据</a><br><a href="validation.json">报告静态核验</a></p></aside><main>
<section id="decision"><h2>验收结论</h2><p class="lede">2026-10-22阶段已收口（PARTIAL），完整主门完成0；最终回归NOT_RUN，当前证据仍不足以签发项目正式验收通过。<a href="${esc(data.stageRefresh.report_path)}">查看阶段收口结果与剩余范围</a>。</p><p class="boundary"><b>B14：暂定PASS（user_pass）。</b>按2026-10-23用户决定接受当前未闭环内存增长风险；最新完整100轮的Private Bytes增长95.869140625 MiB，原机器FAIL与64 MiB门限保留。10～38 MiB为本对话残余估算，用户认为规模较小；后续继续定位并制定合理新门限。<a href="data/b14-user-disposition-20261023.json">暂定处置</a> · <a href="reports/b14/b14-historical-metrics.html">五次历史指标</a>。未授予无例外Formal或发布验收通过。</p>
<div class="metric-grid"><div class="metric"><strong>${productPlans.length}</strong><span>产品验收组<br>合并主题，保留独立子门</span></div><div class="metric"><strong>${auxiliaryPlans.length}</strong><span>附属工具／诊断组<br>随依赖执行，见附录</span></div><div class="metric"><strong>52 → ${data.retestRecords.length}</strong><span>待测入口精简<br>原条目去向全部可追溯</span></div><div class="metric"><strong>${data.historicalRecords.length}</strong><span>历史最终结果<br>保留原状态与版本边界</span></div></div><p class="overview-note">执行组数量不是用例数或通过率。本次只整理报告，未启动构建、产品、服务、设备测试或长稳。基准日的 ${data.currentRecords.length} 条限定工具结果放入附录，未重新核验为当前产品通过。</p></section>
<section id="highlights"><h2>五类实测摘要</h2><p>以下按原栏目更新已完成且同范围的最新结果；未执行、仅尝试及未完成的范围保留原数据。展开后查看各指标日期、门限、环境与限制，不合并不同运行的验收信用。</p><div class="highlight-grid">${highlightCards}</div></section>
<section id="retests"><h2>产品验收计划</h2><p>计划卡片显示最新阶段评估状态；展开查看已完成范围、剩余项及原始来源，详见<a href="${esc(data.stageRefresh.report_path)}">最新阶段收口报告</a>。阶段PARTIAL或某个子门PASS均不代表整组通过。同组共享准备步骤和冻结工件，每个验收子门分别判定。与当前改动无关且输入完整一致的结果可复用；改变的范围才补测。物理条件不足、已暂缓的现场测试和正式长稳继续保持原暂停边界。</p>${renderTimingDefinitions(data.timingMeasurements, data.b14CycleSummary)}${toolbar('retest')}${consolidationHTML}</section>
${renderMemoryUsage(data.memoryUsageSummary)}
${renderEnvironmentOverview(data.testEnvironments.profiles)}
<section id="history"><h2>历史最终结果</h2><p>保留 ${data.historicalRecords.length} 条最终结论及原指标。Formal、资格、诊断和用户反馈分别归属原运行，不合并 PASS，不拼接不同环境与版本。</p><details class="appendix"><summary>查阅与筛选历史结果</summary><div class="toolbar" role="search" aria-label="历史结果筛选"><input id="history-q" type="search" aria-label="搜索历史结果" placeholder="搜索历史最终结果…"><label>领域<select id="history-domain"><option value="">全部领域</option></select></label><label>原状态<select id="history-status"><option value="">全部具体状态</option></select></label><button id="history-reset">重置</button></div><div id="history-count" class="status-line" aria-live="polite"></div><div class="table-wrap"><table><thead><tr><th>验收与原范围</th><th>原结论</th><th>关键结果</th><th>边界</th></tr></thead><tbody id="history-body"></tbody></table></div></details></section>
<section id="appendix"><h2>工具与审计附录</h2><p>以下项目用于测量准入、故障定位和追溯。需要时展开；不另计产品验收通过。</p>
<details class="appendix"><summary>附属工具与诊断计划 · ${auxiliaryPlans.length} 组</summary><section id="aux"><h3>工具与诊断计划</h3>${toolbar('aux')}</section></details>
<details class="appendix"><summary>基准日限定工具结果 · ${data.currentRecords.length} 条</summary><section id="reports"><h3>2026-10-12/13 分类基准保留的工具结果</h3><p>原分类及后续资料整理共保留 4 条工具门、27 项声明输入。下列“有效”仅指原基准时的已核范围；本次排版未重核当前源码、产品或运行环境。N010 原来源缺失且输入改变，仍通过原 T052 对应的辅助计划追溯。</p>${toolbar('report')}</section></details>
<details class="appendix"><summary>证据边界、来源与历史清理</summary><section id="boundary"><h3>有效性与版本边界</h3><p>原证据 HEAD <code>${esc(data.snapshot.head)}</code>，快照核对时间 ${esc(data.snapshot.checkedAt)}。它是历史分类输入，不代表当前工作树。</p><ul><li>原判定 CURRENT_VALID 只授予已核输入和回执范围的信用；文件字节一致不证明全部传递依赖、设备或运行环境等价。</li><li>计划卡片按最新阶段评估展示，未执行子门仍保留 NOT_RUN。原 FAIL、BLOCKED、UNKNOWN 和 INCONCLUSIVE 保持原结论；不得用工具 PASS 代替产品、资格或正式长稳。</li><li>合并只减少执行入口和重复准备，保留 codec、后端、设备、跨机、负载及物理测量子门；不同子门分别给出结果。</li></ul><div class="table-wrap"><table><thead><tr><th>原声明清单</th><th>总项</th><th>一致</th><th>不同</th><th>缺失</th></tr></thead><tbody>${data.auditSummary.map(item => '<tr><td>' + esc(item.manifest) + '</td><td>' + item.counts.total + '</td><td>' + item.counts.match + '</td><td>' + item.counts.different + '</td><td>' + item.counts.missing + '</td></tr>').join('')}</tbody></table></div><p class="note">以上为 2026-10-12/13 的 1670 项声明输入核对，未因本次修订重新执行。<a href="audit/classification/curation-input-audit.json">原输入核对明细</a>。</p></section>
${cleanupHTML}<section id="provenance"><h3>报告维护与限制</h3><p>日常计划维护 <code>data/test-plan.json</code>；原始基准保留于 <code>data/report-input.json</code>。通过 <code>node scripts/assemble.mjs</code> 生成入口，再运行 <code>node scripts/validate.mjs --full</code> 核对本地完整资料包；轻量仓库使用默认模式，缺失附件单独报告。</p><p>原来源可用性核对时间 ${esc(data.packageAvailability.checked_at)}：69 个直接来源中 46 个同 SHA 原件或快照，23 个缺失或变化。该数字沿用原核对，不声称本次重新扫描。<a href="audit/source-availability.json">原来源可用性说明</a>。</p><p><a href="package-info.json">目录与使用方式</a> · <a href="evidence-manifest.json">资料包文件与证据指纹</a> · <a href="audit/classification/curation-decisions.json">原分类依据</a>。</p><p class="note">报告静态核验覆盖结构、映射、筛选、附件和指纹；浏览器排版检查另行记录。两者均不授予产品 runtime 或正式验收信用。目录内独立堆诊断报告保留原文和各自结论。</p></section></details></section>
<footer class="footer">Cohavora · ${esc(timestamp)} Asia/Shanghai · 本次仅更新文档，未重跑产品测试</footer></main></div>
<script id="report-data" type="application/json">${serial}</script><script>${clientScript}</script></body></html>`;

await fs.writeFile(path.join(dest, 'data/report-data.json'), JSON.stringify(data, null, 2));
await fs.writeFile(path.join(dest, 'data/highlights.json'), JSON.stringify(data.highlights, null, 2));
await fs.writeFile(path.join(dest, 'data/b14-100-cycle-summary.json'), JSON.stringify(data.b14CycleSummary, null, 2));
await fs.writeFile(path.join(dest, 'data/source-map.json'), JSON.stringify(data.portableFiles, null, 2));
await fs.writeFile(path.join(dest, 'index.html'), html);
await fs.writeFile(path.join(dest, 'reports/index.html'), renderReportDirectory(reportCatalog, css));
await fs.writeFile(path.join(dest, 'data/report-catalog.json'), JSON.stringify(reportCatalog, null, 2) + '\n');
const packageInfo = await readJSON('package-info.json');
packageInfo.revised_at = data.meta.documentRevisedAt;
packageInfo.plan = 'data/test-plan.json';
packageInfo.catalog = 'reports/index.html';
packageInfo.maintenance = 'README.md';
packageInfo.folders.reports = '当前保留的最新独立报告与同名JSON，按product／b14／memory／tooling分类';
packageInfo.folders.assets = '报告样式及内嵌交互脚本源码';
packageInfo.folders.data = '合并后的验收计划、原始分类基准、实测指标与运行环境';
packageInfo.consolidation = {original: 52, product_groups: productPlans.length, auxiliary_groups: auxiliaryPlans.length, historical_results_preserved: data.historicalRecords.length};
await fs.writeFile(path.join(dest, 'package-info.json'), JSON.stringify(packageInfo, null, 2));

// Git元数据及迁移前本机备份不属于分发资料包。
async function walk(directory = '') {
  const names = [];
  for (const entry of await fs.readdir(path.join(dest, directory), {withFileTypes: true})) {
    if (entry.name === '.git') continue;
    const relative = path.posix.join(directory, entry.name);
    if (relative === 'audit/report-layout-originals') continue;
    if (entry.isSymbolicLink()) throw Error('Package symlink: ' + relative);
    if (entry.isDirectory()) names.push(...await walk(relative));
    else if (relative !== 'evidence-manifest.json') names.push(relative);
  }
  return names;
}
const outputs = [];
for (const name of (await walk()).sort()) {
  const buffer = await fs.readFile(path.join(dest, name));
  const entry = {path: name, sha256: sha(buffer), bytes: buffer.length};
  // 仅报告文本允许轻量检出时的 CRLF/LF 转换；冻结证据保持原字节指纹。
  if (/^(?:assets\/|data\/|scripts\/)|^reports\/.*\.html$|^(?:index\.html|README\.md|package-info\.json|validation\.json|\.gitignore)$/.test(name)) {
    const lf = Buffer.from(buffer.toString('utf8').replace(/\r\n/g, '\n'));
    entry.text_lf_sha256 = sha(lf);
    entry.text_lf_bytes = lf.length;
  }
  outputs.push(entry);
}
await fs.writeFile(path.join(dest, 'evidence-manifest.json'), JSON.stringify({schema: 'cohavora-portable-report-manifest-v1', generatedAt: timestamp, evidence_head: data.snapshot.head, scope: data.meta.scope, outputs, sources: data.sourceReceipts, validation_scope: 'Report structure, plan mapping, package files and frozen inputs; no current product acceptance'}, null, 2));
console.log(JSON.stringify({entry: path.join(dest, 'index.html'), product_groups: productPlans.length, auxiliary_groups: auxiliaryPlans.length, historical_results: data.historicalRecords.length, package_files: outputs.length, bytes: Buffer.byteLength(html)}, null, 2));
