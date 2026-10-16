const D = JSON.parse(document.getElementById('report-data').textContent);
const e = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const str = value => Array.isArray(value) ? value.map(str).join('；') : value && typeof value === 'object' ? Object.entries(value).map(([key, item]) => key + ': ' + str(item)).join('；') : String(value ?? '');
const statusKey = value => String(value ?? '').trim().toUpperCase();
const cls = status => /FAIL|BLOCKED|NOT_READY/i.test(status) ? 'bad' : /PASS|COMPLETE|READY/i.test(status) && !/NOT|UNKNOWN|PENDING|INCOMPLETE/i.test(status) ? 'good' : 'warn';
const kind = status => cls(status) === 'good' ? 'PASS' : cls(status) === 'bad' ? 'FAIL' : 'OTHER';
const statesFor = record => record.reference_statuses || [record.status];
const badge = status => '<span class="badge ' + cls(status) + '">' + e(status) + '</span>';
const file = value => D.portableFiles[String(value).replaceAll('\\', '/').toLowerCase()]?.portable_path;
const sourceLink = (value, label) => file(value) ? '<a href="' + e(file(value)) + '">' + e(label || value) + '</a>' : '<span class="source-missing">' + e(label || value) + '（原来源缺失；仅保留封存摘要）</span>';

function populateStatuses(id, rows) {
  const counts = new Map();
  for (const row of rows) for (const raw of statesFor(row)) {
    const key = statusKey(raw);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  for (const [key, count] of [...counts].sort((a, b) => a[0].localeCompare(b[0]))) {
    const option = new Option((key.length > 70 ? key.slice(0, 67) + '…' : key) + ' (' + count + ')', key);
    option.title = key;
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
    if (Array.isArray(metric)) return '<tr><td>' + e(metric[0]) + '</td><td>' + e(str(metric[1])) + '</td><td>原文未给出</td><td>见原字段</td></tr>';
    if (!metric || typeof metric !== 'object') return '<tr><td colspan="4">' + e(str(metric)) + '</td></tr>';
    return '<tr><td>' + e(metric.name || metric.metric || metric.label || metric.id || '指标') + '</td><td>' + e(str(metric.value ?? metric.measured ?? metric.actual ?? metric.result ?? '')) + '</td><td>' + e(str(metric.limit ?? metric.threshold ?? metric.gate ?? metric.expected ?? '原文未给出')) + '</td><td>' + e(metric.unit || '见原报告') + (metric.basis ? '<br><small>' + e(str(metric.basis)) + '</small>' : '') + '</td></tr>';
  }).join('');
}

function metricTable(record) {
  return '<div class="table-wrap"><table class="metric-table"><thead><tr><th>指标</th><th>原实测／状态</th><th>原门限／期望</th><th>单位／依据</th></tr></thead><tbody>' + metricRows(record) + '</tbody></table></div>';
}

function recordMarkup(record, prefix) {
  const baseline = record.curation.disposition === 'CURRENT_VALID';
  const title = (record.plan_code || record.id) + ' · ' + record.title;
  const coverage = record.coverage?.length ? '<details class="raw-detail"><summary>原范围与条目追溯</summary><ul class="coverage-list">' + record.coverage.map(item => '<li>' + e(item) + '</li>').join('') + '</ul></details>' : '';
  const references = statesFor(record).filter(status => status !== 'NOT_RUN');
  const body = baseline
    ? '<p><b>原保留依据：</b>' + e(str(record.curation.reason)) + '</p>' + metricTable(record) + '<p class="note">输入核对结论属于原分类基准；本次未重新核验当前产品。</p>'
    : '<p>' + e(str(record.curation.reason)) + '</p><h4>验收子门</h4><ul class="coverage-list">' + record.curation.retestScope.map(item => '<li>' + e(item) + '</li>').join('') + '</ul>' + (record.prerequisites || record.conditions ? '<p class="plan-meta"><b>执行条件：</b>' + e(str(record.prerequisites || record.conditions)) + '</p>' : '') + '<p class="plan-meta"><b>原条目：</b>' + e(record.originalIds.join('、')) + '。各子门分别判定；整组尚未执行。</p>' + (references.length ? '<details class="raw-detail"><summary>历史参考状态（不计本轮通过）</summary>' + references.map(badge).join(' ') + '</details>' : '');
  return '<details class="record" id="' + prefix + '-' + record.id + '"><summary><span class="record-title">' + e(title) + '<small>' + e(record.domain) + ' · ' + (baseline ? '基准日限定工具结果' : '本轮 NOT_RUN') + '</small></span>' + badge(record.status) + '</summary><div class="record-body">' + body + '<p class="boundary"><b>边界：</b>' + e(str(record.limitations)) + '</p>' + coverage + environmentNotice(record) + (baseline ? '<details class="raw-detail"><summary>原输入指纹与来源</summary><pre class="raw">' + e(JSON.stringify(record.curation.inputChecks, null, 2)) + '</pre><ul class="sources">' + record.source_checks.map(source => '<li>' + sourceLink(source.path, '原回执') + '<br><code>' + e(source.sha256) + '</code></li>').join('') + '</ul></details>' : '') + '</div></details>';
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
    document.getElementById(prefix + '-count').textContent = '显示 ' + count + ' / ' + rows.length + (prefix === 'report' ? ' 条基准日工具结果' : ' 组计划；历史状态仅作参考');
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

function renderHistory() {
  const query = document.getElementById('history-q').value.toLowerCase().trim();
  const domain = document.getElementById('history-domain').value;
  const status = statusKey(document.getElementById('history-status').value);
  const rows = D.historicalRecords.filter(record => (!domain || domain === record.domain) && (!status || statusKey(record.status) === status) && (!query || JSON.stringify(record).toLowerCase().includes(query)));
  document.getElementById('history-body').innerHTML = rows.map(record => '<tr><td>' + e(record.title) + '<p class="note">' + e(record.date || '日期见原来源') + '<br>' + e(str(record.evidence_scope)) + '</p>' + environmentNotice(record) + record.sources.map(source => sourceLink(source, '结果来源')).join(' · ') + '</td><td>' + badge(record.status) + '</td><td>' + record.metrics.map(metric => '<p class="note">' + e(Array.isArray(metric) ? metric[0] + ': ' + str(metric[1]) : (metric.name || metric.metric || metric.label || '指标') + ': ' + str(metric.value ?? metric.measured ?? metric.actual ?? metric.result ?? '') + ' ' + (metric.unit || '') + ((metric.limit ?? metric.threshold ?? metric.gate ?? metric.expected) != null ? '；原门限／期望 ' + str(metric.limit ?? metric.threshold ?? metric.gate ?? metric.expected) : '')) + '</p>').join('') + '</td><td><p class="note">' + e(str(record.limitations)) + '</p></td></tr>').join('') || '<tr><td colspan="4" class="empty">没有匹配的历史结果</td></tr>';
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
