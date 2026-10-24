import fs from 'node:fs/promises';
import path from 'node:path';

const categories = [
  {id: 'product', title: '产品与阶段补测', description: '功能、媒体、资源与界面报告；按各批次声明的子门与输入判断。'},
  {id: 'b14', title: 'B14 准入与正式长稳', description: '环境冻结、资格、readmission、Formal 尝试及其阻塞记录。'},
  {id: 'memory', title: '内存与资源诊断', description: '堆、系统保留、资源归属与优化对照；诊断结果不等同正式验收。'},
  {id: 'tooling', title: '工具、合同与测量准入', description: '自动化、采集与运行合同的限定验证，不重复计入产品验收组。'}
];
const featuredPaths = [
  'reports/product/stage-closure-20261022.html',
  'reports/product/resource-completion-20261021-01.html',
  'reports/product/resource-completion-20261020-01.html',
  'reports/product/functional-media-retest-20261020-01.html',
  'reports/b14/b14-full-standard-20261020-01.html',
  'reports/b14/b14-clipboard-readmission-20261019-01.html'
];
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[char]));
const plain = value => String(value ?? '').replace(/<[^>]*>/g, '').replace(/&(?:amp|lt|gt|quot|apos|#39);/g, entity => ({'&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&#39;': "'"}[entity])).trim();
const scalar = value => ['string', 'number', 'boolean'].includes(typeof value) ? value : undefined;
const own = (object, key) => object && Object.hasOwn(object, key);
const readJSON = async file => JSON.parse((await fs.readFile(file, 'utf8')).replace(/^\uFEFF/, ''));

function reportDate(filename, source) {
  const revised = source?.current_revision_date;
  if (typeof revised === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(revised)) return revised;
  const completed = source?.latest_completed_utc;
  if (typeof completed === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(completed)) return completed.slice(0, 10);
  const match = filename.match(/(?:^|-)(20\d{2})(\d{2})(\d{2})(?=-|\.)/);
  if (match) return `${match[1]}-${match[2]}-${match[3]}`;
  const timestamp = source?.updated_utc ?? source?.utc ?? source?.created_utc;
  return typeof timestamp === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(timestamp) ? timestamp.slice(0, 10) : null;
}

function featuredSummary(entry, source) {
  const details = [];
  const add = (label, value) => { if (scalar(value) !== undefined) details.push({label, value}); };
  add('任务状态', source.task_status);
  add('修订', source.revision);
  if (own(source, 'draft')) add('草稿', source.draft);
  if (own(source, 'final_snapshot')) add('批次快照已收口', source.final_snapshot);
  add('完整主门完成数', source.summary?.full_plan_gates_completed);
  add('最终回归', source.summary?.final_regression_status);
  add('发版批准', source.release_approval?.status);
  add('批准版本', source.release_approval?.version);
  if (own(source.summary, 'production_ready')) add('Production Ready', source.summary.production_ready);
  add('Formal', source.formal);
  add('Formal 限定处置', source.formal?.status);
  add('原机器判定', source.formal?.raw_verdict);
  add('Formal run_id', source.formal?.run_id);
  add('当前用户处置', source.acceptance_disposition?.status);
  add('已完成周期', source.formal?.cycles_completed);
  if (source.formal?.exception) {
    add('授权例外周期', source.formal.exception.cycle);
    add('授权例外检查', source.formal.exception.check);
    add('例外条件', source.formal.exception.condition);
  }
  if (Array.isArray(source.formal?.deferred)) add('仍暂缓范围', source.formal.deferred.join('、'));
  add('已通过资格次数', source.qualification_passes);
  add('最近尝试', source.latest_attempt?.verdict);
  add('最近尝试原因', source.latest_attempt?.reason);
  if (own(source, 'active')) add('仍在运行', source.active);
  return {
    path: entry.path,
    json_path: entry.json_path,
    title: entry.title,
    date: entry.date,
    status: entry.status,
    updated_utc: source.updated_utc ?? source.utc ?? null,
    statement: typeof source.summary?.statement === 'string' ? source.summary.statement : typeof source.note === 'string' ? source.note : null,
    details,
    boundary: source.task_status === 'STAGE_CLOSED_BY_USER'
      ? source.release_approval?.status === 'APPROVED_BY_USER'
        ? '2026-10-23阶段已收口（PARTIAL）；当前剩余待测试项用户评估无较大或严重问题，批准发版' + source.release_approval.version + '。原测试判定与未测范围保留，本次仅更新报告。'
        : '阶段已收口，完整主门完成0，最终回归NOT_RUN，Production Ready为false；各已完成子门及原失败分别保留，不代表最终工件已冻结或完整验收通过。'
      : source.formal?.status === 'PASS_WITH_USER_EXCEPTION'
      ? '限定 run 的授权例外处置：原机器 FAIL 保留，仅接受第52周期整机NIC超限；不属于无例外 Formal PASS，其他暂缓范围保留。'
      : source.draft === true ? '阶段快照仍在增量更新；不表示任务完成或当前源码通过。' : '按原批次、原输入及各子门保留结论；本次文档整理未重新执行验收。'
  };
}

export async function buildReportCatalog(dest) {
  const reports = [];
  const sources = new Map();
  for (const category of categories) {
    const directory = path.join(dest, 'reports', category.id);
    let filenames;
    try { filenames = await fs.readdir(directory); }
    catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    const available = new Set(filenames);
    for (const filename of filenames.filter(name => name.endsWith('.html')).sort()) {
      const html = await fs.readFile(path.join(directory, filename), 'utf8');
      const jsonName = filename.replace(/\.html$/, '.json');
      const historyData = category.id === 'b14' && filename === 'b14-historical-metrics.html' ? 'data/b14-historical-metrics.json' : null;
      const source = available.has(jsonName) ? await readJSON(path.join(directory, jsonName)) : historyData ? await readJSON(path.join(dest, historyData)) : null;
      const heading = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1];
      const recordedStatus = [source?.status, source?.verdict, source?.result].find(value => typeof value === 'string' && value.trim());
      const entry = {
        path: `reports/${category.id}/${filename}`,
        json_path: historyData ?? (source ? `reports/${category.id}/${jsonName}` : null),
        category: category.id,
        date: reportDate(filename, source),
        title: typeof source?.title === 'string' ? source.title : plain(heading) || filename,
        status: recordedStatus ?? 'UNRECORDED',
        status_basis: recordedStatus ? (historyData ? 'historical_metrics_json_top_level' : 'companion_json_top_level') : 'no_structured_top_level_status'
      };
      reports.push(entry);
      if (source) sources.set(entry.path, source);
    }
  }
  reports.sort((left, right) => (right.date ?? '').localeCompare(left.date ?? '') || left.path.localeCompare(right.path, 'en'));
  const byPath = new Map(reports.map(entry => [entry.path, entry]));
  return {
    schema: 'cohavora-acceptance-report-catalog-v1',
    revised_at: reports[0]?.date ?? '2026-10-22',
    entry: 'reports/index.html',
    plan: 'data/test-plan.json',
    scope: '文档导航与原报告状态索引；不新增验收项，不授予当前产品通过。',
    status_policy: '仅索引已登记来源JSON顶层status/verdict/result；缺少可靠结构化状态时记UNRECORDED，正文中的局部PASS不用于推定整份报告通过。',
    report_count: reports.length,
    categories: categories.map(category => ({...category, count: reports.filter(entry => entry.category === category.id).length})),
    featured: featuredPaths.filter(name => byPath.has(name) && sources.has(name)).map(name => featuredSummary(byPath.get(name), sources.get(name))),
    reports
  };
}

const statusBadge = status => `<span class="badge ${status === 'FAIL' ? 'bad' : status === 'PASS' || status === 'PASS_SCOPED' || status === 'user_pass' ? 'good' : ''}">${esc(status === 'UNRECORDED' ? '未归档结构化总状态' : status)}</span>`;
const facts = details => details.length ? `<dl>${details.map(detail => `<div><dt>${esc(detail.label)}</dt><dd>${esc(detail.value)}</dd></div>`).join('')}</dl>` : '';

export function renderLatestReports(catalog) {
  return `<section id="latest-reports"><h2>最新阶段与报告目录</h2><p>以下状态来自已有报告快照；各子门独立判定。完整验收计划仍维护于 <a href="${esc(catalog.plan)}">test-plan.json</a>，批次、诊断和重复 case 不另计产品验收项。</p><p><a href="${esc(catalog.entry)}">浏览全部 ${catalog.report_count} 份分类报告</a> · <a href="data/report-catalog.json">结构化报告目录</a></p><div class="highlight-grid">${catalog.featured.map(report => `<article class="latest-report-card"><h3><a href="${esc(report.path)}">${esc(report.title)}</a></h3><p>${statusBadge(report.status)} <span class="scope-tag">${esc(report.date ?? '日期未记录')}</span></p>${report.statement ? `<p>${esc(report.statement)}</p>` : ''}<details><summary>查看批次状态与边界</summary>${facts(report.details)}<p class="boundary">${esc(report.boundary)}</p></details><p><a href="${esc(report.path)}">阅读报告</a>${report.json_path ? ` · <a href="${esc(report.json_path)}">原结构化结果</a>` : ''}</p></article>`).join('')}</div><p class="note">历史 Formal FAIL、资格通过、局部 PASS 与未执行范围分别保留。阶段快照中的运行状态仅代表其记录时刻，本次整理未核实进程仍在运行。</p></section>`;
}

export function renderReportDirectory(catalog, css) {
  const local = name => path.posix.relative('reports', name);
  const stage = catalog.featured.find(report => report.path === 'reports/product/stage-closure-20261022.html');
  const releaseNotice = stage?.statement ? `<p class="boundary">${esc(stage.statement)}。<a href="${esc(local(stage.path))}">查看最新阶段收口及批准来源</a>。</p>` : '';
  const groups = catalog.categories.map(category => `<section id="category-${esc(category.id)}"><h2>${esc(category.title)} · ${category.count}</h2><p>${esc(category.description)}</p><div class="table-wrap"><table><thead><tr><th>报告日期</th><th>报告</th><th>原结构化总状态</th><th>资料</th></tr></thead><tbody>${catalog.reports.filter(entry => entry.category === category.id).map(entry => `<tr><td>${esc(entry.date ?? '未记录')}</td><td><a href="${esc(local(entry.path))}">${esc(entry.title)}</a><br><small>${esc(path.posix.basename(entry.path))}</small></td><td>${statusBadge(entry.status)}</td><td><a href="${esc(local(entry.path))}">HTML</a>${entry.json_path ? ` · <a href="${esc(local(entry.json_path))}">JSON</a>` : ''}</td></tr>`).join('')}</tbody></table></div></section>`).join('');
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Cohavora · 分类测试报告目录</title><style>${css}</style></head><body>
<header class="hero"><div class="kicker">COHAVORA · REPORT CATALOG</div><h1>分类测试报告目录</h1><p>${catalog.report_count} 份报告按用途归档；日期采用已登记的报告修订／完成日期，无对应记录时采用命名日期，实测结果仍绑定原批次和冻结输入。</p><div class="tags"><span>目录修订 ${esc(catalog.revised_at)}</span><span>本次产品重测 NOT_RUN</span></div></header>
<div class="shell"><aside><nav aria-label="分类报告导航"><a href="../index.html">返回验收首页</a>${catalog.categories.map(category => `<a href="#category-${esc(category.id)}">${esc(category.title)} · ${category.count}</a>`).join('')}<a href="#maintenance">目录维护说明</a></nav><p><a href="../data/test-plan.json">唯一验收计划</a><br><a href="../data/report-catalog.json">结构化目录</a><br><a href="../README.md">目录与维护方式</a></p></aside><main>
<section><h2>阅读范围</h2>${releaseNotice}<p class="boundary">整份报告的状态只取已登记来源 JSON 的顶层 status／verdict／result；历史指标页来源为 data/ 中的统计 JSON。未归档结构化总状态时，直接阅读 HTML 中的原结论；不从正文的局部 PASS 推断整体通过。</p><p>本页为资料索引，不是新增验收清单。正式通过、资格、诊断、批次观察和阶段快照按各自范围保留，用户发版批准另列来源。</p></section>
${groups}
<section id="maintenance"><h2>目录维护说明</h2><div class="table-wrap"><table><thead><tr><th>目录</th><th>职责</th></tr></thead><tbody><tr><td><code>reports/</code></td><td>按产品、B14、内存诊断和工具分类的 HTML 与同名结构化报告。</td></tr><tr><td><code>data/</code></td><td>统一计划、报告索引、首页派生数据与历史摘要；不以新索引覆盖原始结论。</td></tr><tr><td><code>evidence/</code></td><td>原始证据或指纹一致副本；保留历史输入边界。</td></tr><tr><td><code>inputs/</code></td><td>限定工具门的直接输入快照，仅作追溯与校验。</td></tr><tr><td><code>audit/</code></td><td>既有分类、迁移与来源可用性审计；不属于重复产品验收项。</td></tr><tr><td><code>scripts/</code></td><td>生成首页和目录并进行静态校验；本次不执行产品或长稳。</td></tr></tbody></table></div><p>新报告放入对应分类目录，通常将同名 JSON 与 HTML 相邻；历史指标页复用已登记的 data/b14-historical-metrics.json。执行 <code>node scripts/assemble.mjs</code> 更新首页和目录，再执行 <code>node scripts/validate.mjs</code> 核对文档。报告中的外部本机证据链接依赖原机器路径，不保证轻量副本可访问。</p></section>
</main></div></body></html>`;
}
