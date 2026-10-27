const D = JSON.parse(document.getElementById('report-data').textContent);
const e = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const joinClauses = items => items.map(item => String(item ?? '').trim()).filter(Boolean).reduce((acc, item) => !acc ? item : /[。！？；;]$/.test(acc) ? acc + item : acc + '；' + item, '');
const str = value => Array.isArray(value) ? joinClauses(value.map(str)) : value && typeof value === 'object' ? Object.entries(value).map(([key, item]) => key + ': ' + str(item)).join('；') : String(value ?? '');
const statusKey = value => String(value ?? '').trim().toUpperCase();
const statusLabel = value => statusKey(value) === 'USER_PASS' ? 'user_pass' : statusKey(value) === 'USER-PASS' ? 'user-pass' : value;
const cls = status => /FAIL|BLOCKED|NOT_READY/i.test(status) ? 'bad' : /PASS|COMPLETE|READY/i.test(status) && !/NOT|UNKNOWN|PENDING|INCOMPLETE/i.test(status) ? 'good' : 'warn';
const kind = status => cls(status) === 'good' ? 'PASS' : cls(status) === 'bad' ? 'FAIL' : 'OTHER';
const statesFor = record => [record.status];
const badge = status => '<span class="badge ' + cls(status) + '">' + e(status) + '</span>';
const file = value => D.portableFiles[String(value).replaceAll('\\', '/').toLowerCase()]?.portable_path;
const sourceLink = (value, label) => file(value) ? '<a href="' + e(file(value)) + '">' + e(label || value) + '</a>' : '<span class="source-missing">' + e(label || value) + '（原来源缺失；仅保留封存摘要）</span>';

const isCountObject = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length > 0 && Object.entries(value).every(([key, item]) => /^(?:PASS|FAIL|READY|DEFERRED|PARTIAL|UNKNOWN|INCONCLUSIVE|NOT_RUN)(?:_[A-Z0-9]+)*$/.test(key) && typeof item === 'number' && Number.isFinite(item));
const formatCountObject = (value, unit = '') => Object.entries(value).map(([key, item]) => item + (unit ? ' ' + unit : '') + '（' + statusLabel(key) + '）').join('、');

const registeredPaths = [...new Set(Object.values(D.portableFiles || {}).map(item => item?.portable_path).filter(Boolean))].sort((a, b) => b.length - a.length);
const completedEvidenceByBasename = new Map(
  registeredPaths
    .filter(item => item.startsWith('data/completed-evidence/'))
    .map(item => [item.slice('data/completed-evidence/'.length), item])
);

function linkProseSources(value) {
  const text = str(value);
  if (!text || !registeredPaths.length) return e(text);
  const allowBasename = text.includes('data/completed-evidence/');
  const tokens = allowBasename
    ? [...registeredPaths.map(item => ({token: item, path: item})), ...[...completedEvidenceByBasename].map(([name, item]) => ({token: name, path: item}))].sort((a, b) => b.token.length - a.token.length)
    : registeredPaths.map(item => ({token: item, path: item}));
  let cursor = 0, out = '';
  while (cursor < text.length) {
    let bestIndex = -1, bestMatch = null;
    for (const candidate of tokens) {
      const idx = text.indexOf(candidate.token, cursor);
      if (idx !== -1 && (bestIndex === -1 || idx < bestIndex || (idx === bestIndex && candidate.token.length > bestMatch.token.length))) {
        bestIndex = idx;
        bestMatch = candidate;
      }
    }
    if (bestIndex === -1) {
      out += e(text.slice(cursor));
      break;
    }
    out += e(text.slice(cursor, bestIndex)) + sourceLink(bestMatch.path, bestMatch.token);
    cursor = bestIndex + bestMatch.token.length;
  }
  return out;
}

function populateStatuses(id, rows) {
  const counts = new Map();
  for (const row of rows) for (const raw of statesFor(row)) {
    const key = statusKey(raw);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  for (const [key, count] of [...counts].sort((a, b) => a[0].localeCompare(b[0]))) {
    const label = statusLabel(key);
    const option = new Option((label.length > 70 ? label.slice(0, 67) + '…' : label) + ' (' + count + ')', key);
    option.title = label;
    document.getElementById(id).add(option);
  }
}

function populateDomains(id, rows) {
  for (const domain of [...new Set(rows.map(row => row.domain))].sort()) document.getElementById(id).add(new Option(domain, domain));
}

function environmentNotice(record) {
  if (record.curation?.disposition === 'RETEST_REQUIRED') return '';
  const profiles = (record.environmentIds || []).map(id => D.testEnvironments.profiles.find(profile => profile.id === id)).filter(Boolean);
  return '<p class="note">原运行环境：' + (profiles.length ? profiles.map(profile => '<a href="#' + e(profile.id) + '">' + e(profile.label) + '</a>').join('；') : '最终结果未完整记录，未借用其他批次配置。') + '</p>';
}

function metricRows(record) {
  return record.metrics.map(metric => {
    if (Array.isArray(metric)) return '<tr><td>' + e(metric[0]) + '</td><td>' + e(isCountObject(metric[1]) ? formatCountObject(metric[1]) : str(metric[1])) + '</td><td>原文未给出</td><td>见原字段</td></tr>';
    if (!metric || typeof metric !== 'object') return '<tr><td colspan="4">' + e(str(metric)) + '</td></tr>';
    const rawValue = metric.value ?? metric.measured ?? metric.actual ?? metric.result ?? '';
    const displayValue = isCountObject(rawValue) ? formatCountObject(rawValue, metric.unit || '') : str(rawValue);
    return '<tr><td>' + e(metric.name || metric.metric || metric.label || metric.id || '指标') + '</td><td>' + e(displayValue) + '</td><td>' + e(str(metric.limit ?? metric.threshold ?? metric.gate ?? metric.expected ?? '原文未给出')) + '</td><td>' + e(metric.unit || '见原报告') + (metric.basis ? '<br><small>' + e(str(metric.basis)) + '</small>' : '') + '</td></tr>';
  }).join('');
}

function metricTable(record) {
  return '<div class="table-wrap"><table class="metric-table"><thead><tr><th>指标</th><th>原实测／状态</th><th>原门限／期望</th><th>单位／依据</th></tr></thead><tbody>' + metricRows(record) + '</tbody></table></div>';
}

function completedResults(record) {
  return Array.isArray(record.completed_results) ? record.completed_results : [];
}
const currentResultStatus = result => result.current_disposition?.status || result.status;

function completedResultSummary(record) {
  const results = completedResults(record);
  const remaining = Array.isArray(record.stage_status?.remaining) ? record.stage_status.remaining.length : 0;
  const counts = new Map([['PASS', 0], ['FAIL', 0]]);
  for (const result of results) {
    const status = statusKey(currentResultStatus(result));
    counts.set(status, (counts.get(status) || 0) + 1);
  }
  const entries = [...counts];
  const visibleEntries = entries.some(([, count]) => count > 0) ? entries.filter(([, count]) => count > 0) : entries;
  const summary = results.length
    ? '已完成结果（' + results.length + '条记录' + (results.some(result => result.current_disposition) ? '，按当前处置；原实测另列' : '') + '）：' + visibleEntries.map(([status, count]) => count ? badge(statusLabel(status) + ' ' + count) : e(statusLabel(status) + ' ' + count)).join(' ')
    : '已完成结果：无已完成结果记录';
  return '<small>' + summary + '；剩余范围：' + remaining + '项（展开查看）</small>';
}

function completedResultTable(record) {
  const results = completedResults(record);
  if (!results.length) return '<h4>已完成测试结果</h4><p class="note">无已完成结果记录；整组状态及历史参考状态不转换为已完成测试的PASS／FAIL。</p>';
  return '<h4>已完成测试结果</h4><p class="note">按各自范围保留原实测判定；有用户判定或延期处置时同格另列当前处置及决定日期，摘要按当前处置计数。user_pass／user-pass表示用户处置通过，原实测另列。结果记录数不代表用例总数或整组通过率，P05／P06共享来源不跨组相加。PASS_SCOPED和授权例外分别保留。</p>'
    + '<div class="table-wrap"><table class="metric-table completed-results"><thead><tr><th>测试与适用范围</th><th>当前处置／原判定</th><th>结果日期／来源时间</th><th>结果来源</th></tr></thead><tbody>'
    + results.map(result => '<tr data-result-id="' + e(result.id) + '"><td><b>' + e(result.title) + '</b><br>' + e(str(result.scope)) + '</td><td>' + (result.current_disposition ? badge(result.current_disposition.status) + '<br><small>原实测 ' + e(result.status) + '<br>处置日期：' + e(result.current_disposition.date) + '</small><br>' + sourceLink(result.current_disposition.report_path, '处置依据与后续方案') : badge(result.status)) + '</td><td>' + e(result.date || '日期见原来源') + '</td><td>' + sourceLink(result.source_path, '查看结果') + (result.source_locator ? '<br><code>' + e(result.source_locator) + '</code>' : '') + '</td></tr>').join('')
    + '</tbody></table></div>';
}

function stageMarkup(record) {
  const stage = record.stage_status;
  if (!stage) return '';
  const list = (label, items) => items?.length ? '<h4>' + e(label) + '</h4><ul class="coverage-list">' + items.map(item => '<li>' + e(str(item)) + '</li>').join('') + '</ul>' : '';
  return '<p class="plan-meta"><b>' + (record.plan_kind === 'product' ? '整组状态：' : '阶段状态：') + '</b>' + badge(record.status) + ' · <b>收口日期：</b>' + e(record.date) + '</p>'
    + (record.plan_kind === 'product' ? completedResultTable(record) : '')
    + list('已完成范围', stage.completed_scope)
    + list('剩余范围', stage.remaining)
    + list('保留失败', stage.retained_failures)
    + (stage.disposition_report ? '<p class="note">' + e(stage.deferred_scope) + ' ' + sourceLink(stage.disposition_report, '详细bug原因、推荐方案及后续关闭条件') + '</p>' : '')
    + list('未定结论', stage.inconclusive)
    + '<p class="note">各子门按所列范围分别判定；完整主门通过计数为 ' + e(stage.full_gate_credit) + '，不授予整组通过。阶段已收口，本次文档更新未新增测试执行。</p>'
    + '<details class="raw-detail"><summary>阶段结果来源与证据索引</summary><ul class="sources">' + (record.sources || []).map(source => '<li>' + sourceLink(source) + '</li>').join('') + '</ul><p class="note">证据索引键：' + e(str(stage.evidence_refs)) + '；见阶段结果 JSON 的 evidence 栏。</p></details>';
}

function boundaryMarkup(record) {
  const items = Array.isArray(record.boundaries) && record.boundaries.length
    ? record.boundaries
    : Array.isArray(record.limitations) && record.limitations.length
      ? record.limitations
      : [record.limitations].filter(Boolean);
  if (items.length <= 1) return '<p class="boundary"><b>边界：</b>' + linkProseSources(items[0] ?? '') + '</p>';
  return '<div class="boundary"><b>边界：</b><ul class="coverage-list">' + items.map(item => '<li>' + linkProseSources(item) + '</li>').join('') + '</ul></div>';
}

function recordMarkup(record, prefix) {
  const baseline = record.curation.disposition === 'CURRENT_VALID';
  const title = (record.plan_code || record.id) + ' · ' + record.title;
  const coverage = record.coverage?.length ? '<details class="raw-detail"><summary>原范围与条目追溯</summary><ul class="coverage-list">' + record.coverage.map(item => '<li>' + e(item) + '</li>').join('') + '</ul></details>' : '';
  const references = (record.reference_statuses || []).filter(status => status !== 'NOT_RUN');
  const gates = (baseline ? [] : record.curation.retestScope || []).map((item, index) => {
    const status = record.stage_status?.gates?.find(gate => gate.index === index)?.status;
    return '<li>' + (status ? badge(status) + ' ' : '') + e(item) + '</li>';
  }).join('');
  const body = baseline
    ? '<p><b>原保留依据：</b>' + e(str(record.curation.reason)) + '</p>' + metricTable(record) + '<p class="note">输入核对结论属于原分类基准；本次未重新核验当前产品。</p>'
    : '<p>' + e(str(record.curation.reason)) + '</p>' + stageMarkup(record) + '<h4>验收子门</h4><ul class="coverage-list">' + gates + '</ul>' + (record.prerequisites || record.conditions ? '<p class="plan-meta"><b>执行条件：</b>' + e(str(record.prerequisites || record.conditions)) + '</p>' : '') + '<p class="plan-meta"><b>原条目：</b>' + e(record.originalIds.join('、')) + '。各子门状态结合以上已完成及剩余范围解读，不作为新的执行回执。</p>' + (references.length ? '<details class="raw-detail"><summary>历史参考状态（不计当前通过）</summary>' + references.map(badge).join(' ') + '</details>' : '');
  return '<details class="record" id="' + prefix + '-' + record.id + '"><summary><span class="record-title">' + e(title) + '<small>' + e(record.domain) + ' · ' + (baseline ? '基准日限定工具结果' : (record.plan_kind === 'product' ? '整组状态 ' : '') + e(record.status) + ' · ' + e(record.date)) + '</small>' + (record.plan_kind === 'product' ? completedResultSummary(record) : '') + '</span>' + badge(record.status) + '</summary><div class="record-body">' + body + boundaryMarkup(record) + coverage + environmentNotice(record) + (baseline ? '<details class="raw-detail"><summary>原输入指纹与来源</summary><pre class="raw">' + e(JSON.stringify(record.curation.inputChecks, null, 2)) + '</pre><ul class="sources">' + record.source_checks.map(source => '<li>' + sourceLink(source.path, '原回执') + '<br><code>' + e(source.sha256) + '</code></li>').join('') + '</ul></details>' : '') + '</div></details>';
}

function setupRecords(prefix, rows) {
  document.getElementById(prefix + '-list').innerHTML = rows.map(record => recordMarkup(record, prefix)).join('');
  populateDomains(prefix + '-domain', rows);
  populateStatuses(prefix + '-status', rows);
  const ids = ['q', 'domain', 'state', 'status'].map(suffix => prefix + '-' + suffix);
  function filter() {
    const query = document.getElementById(prefix + '-q').value.toLowerCase().trim();
    const domain = document.getElementById(prefix + '-domain').value;
    const state = document.getElementById(prefix + '-state').value;
    const status = statusKey(document.getElementById(prefix + '-status').value);
    let count = 0;
    for (const record of rows) {
      const visible = (!domain || domain === record.domain) && (!state || statesFor(record).some(item => state === kind(item))) && (!status || statesFor(record).some(item => status === statusKey(item))) && (!query || JSON.stringify(record).toLowerCase().includes(query));
      document.getElementById(prefix + '-' + record.id).hidden = !visible;
      if (visible) count++;
    }
    document.getElementById(prefix + '-count').textContent = '显示 ' + count + ' / ' + rows.length + (prefix === 'report' ? ' 条基准日工具结果' : ' 组；按当前阶段状态筛选');
    document.getElementById(prefix + '-empty').hidden = count !== 0;
  }
  ids.forEach(id => document.getElementById(id).addEventListener('input', filter));
  document.getElementById(prefix + '-reset').onclick = () => { ids.forEach(id => document.getElementById(id).value = ''); filter(); };
  document.getElementById(prefix + '-expand').onclick = () => document.querySelectorAll('#' + prefix + '-list .record:not([hidden])').forEach(record => record.open = true);
  document.getElementById(prefix + '-collapse').onclick = () => document.querySelectorAll('#' + prefix + '-list .record').forEach(record => record.open = false);
  filter();
}

setupRecords('report', D.currentRecords);
setupRecords('retest', D.retestRecords.filter(record => record.plan_kind === 'product'));
setupRecords('aux', D.retestRecords.filter(record => record.plan_kind === 'auxiliary'));
populateDomains('history-domain', D.historicalRecords);
populateStatuses('history-status', D.historicalRecords);

function renderHistoryMetric(record, metric) {
  if (Array.isArray(metric)) return e(metric[0] + ': ' + (isCountObject(metric[1]) ? formatCountObject(metric[1]) : str(metric[1])));
  const name = metric.name || metric.metric || metric.label || '指标';
  const rawValue = metric.value ?? metric.measured ?? metric.actual ?? metric.result ?? '';
  const unit = metric.unit || '';
  const limitValue = metric.limit ?? metric.threshold ?? metric.gate ?? metric.expected;
  const limitText = limitValue != null ? '；原门限／期望 ' + str(limitValue) : '';
  if (record.id === 'H181' && name === '有效运行时长' && D.b14CycleSummary?.process?.product_live_seconds_before_close != null) {
    return e(name + '（UIA 全程）: ' + str(rawValue) + (unit ? ' ' + unit : '') + '（产品进程存活 ' + D.b14CycleSummary.process.product_live_seconds_before_close + ' s）' + limitText);
  }
  if (isCountObject(rawValue)) return e(name + ': ' + formatCountObject(rawValue, unit) + limitText);
  return e(name + ': ' + str(rawValue) + (unit ? ' ' + unit : '') + limitText);
}

function renderHistoryLimitations(record) {
  const items = Array.isArray(record.limitations) ? record.limitations : [record.limitations].filter(Boolean);
  const base = items.length > 1
    ? '<ul class="coverage-list">' + items.map(item => '<li>' + linkProseSources(item) + '</li>').join('') + '</ul>'
    : '<p class="note">' + linkProseSources(items[0] ?? '') + '</p>';
  if (record.id === 'H181' && D.b14UserDisposition) {
    return base + '<p class="note"><b>当前处置互参：</b>2026-10-23 用户暂定处置为 <a href="#highlight-b14">' + e(D.b14UserDisposition.status) + '（五类实测摘要 01）</a> 及 <a href="#retest-T020">P20</a>（' + sourceLink(D.b14UserDisposition.source, '暂定处置回执') + '）；本表保留原始机器判定 FAIL。</p>';
  }
  return base;
}

function renderHistory() {
  const query = document.getElementById('history-q').value.toLowerCase().trim();
  const domain = document.getElementById('history-domain').value;
  const status = statusKey(document.getElementById('history-status').value);
  const rows = D.historicalRecords.filter(record => (!domain || domain === record.domain) && (!status || statusKey(record.status) === status) && (!query || JSON.stringify(record).toLowerCase().includes(query)));
  document.getElementById('history-body').innerHTML = rows.map(record => '<tr><td>' + e(record.title) + '<p class="note">' + e(record.date || '日期见原来源') + '<br>' + e(str(record.evidence_scope)) + '</p>' + environmentNotice(record) + record.sources.map(source => sourceLink(source, '结果来源')).join(' · ') + '</td><td>' + badge(record.status) + (record.id === 'H181' && D.b14UserDisposition ? '<br><small>原始机器判定</small><br><small>当前处置：<a href="#highlight-b14">' + e(D.b14UserDisposition.status) + '</a> · <a href="#retest-T020">P20</a></small><br>' + sourceLink(D.b14UserDisposition.source, '用户暂定处置') : '') + '</td><td>' + record.metrics.map(metric => '<p class="note">' + renderHistoryMetric(record, metric) + '</p>').join('') + '</td><td>' + renderHistoryLimitations(record) + '</td></tr>').join('') || '<tr><td colspan="4" class="empty">没有匹配的历史结果</td></tr>';
  document.getElementById('history-count').textContent = '显示 ' + rows.length + ' / ' + D.historicalRecords.length + ' 项历史结果；均不计当前验收通过';
}

['history-q', 'history-domain', 'history-status'].forEach(id => document.getElementById(id).addEventListener('input', renderHistory));
document.getElementById('history-reset').onclick = () => { ['history-q', 'history-domain', 'history-status'].forEach(id => document.getElementById(id).value = ''); renderHistory(); };
renderHistory();

let printRestore = [];
window.addEventListener('beforeprint', () => {
  printRestore = [...document.querySelectorAll('details')].map(element => ({element, open: element.open}));
  for (const {element} of printRestore) element.open = true;
});
window.addEventListener('afterprint', () => { for (const {element, open} of printRestore) element.open = open; });
document.getElementById('print-main').onclick = () => window.print();
