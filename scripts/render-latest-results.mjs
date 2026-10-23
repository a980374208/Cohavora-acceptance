import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {buildCompletedResults} from './render-completed-results.mjs';

const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[char]));
const display = value => typeof value === 'number'
  ? Number(value.toFixed(6)).toLocaleString('zh-CN', {maximumFractionDigits: 6})
  : String(value ?? '—');
const statusClass = status => status === 'FAIL' ? 'bad' : status === 'PASS_SCOPED' ? 'good' : 'warn';
const dateFrom = value => typeof value === 'string' ? value.slice(0, 10) : '日期见原报告';

/** Project the newest recorded results for each scope; never replace raw verdicts. */
export async function buildLatestResults(root) {
  const completed = await buildCompletedResults(root);
  const receipts = new Map(completed.sources.map(source => [source.json, {
    path: source.json, sha256: source.sha256, kind: 'structured_result'
  }]));
  const readSource = async relative => {
    const bytes = await fs.readFile(path.join(root, relative));
    receipts.set(relative, {path: relative, sha256: crypto.createHash('sha256').update(bytes).digest('hex'), kind: relative.endsWith('.json') ? 'structured_result' : 'report'});
    return relative.endsWith('.json') ? JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, '')) : bytes.toString('utf8');
  };
  const latest = await readSource(completed.sources[completed.latest_source].json);
  const formalPath = 'reports/b14/b14-clipboard-readmission-20261019-01.json';
  const attemptPath = 'reports/b14/b14-full-standard-20261020-01.json';
  const memoryPath = 'data/memory-optimization-20261019/results.json';
  const formalSource = await readSource(formalPath);
  const attempt = await readSource(attemptPath);
  const memory = await readSource(memoryPath);
  const formal = formalSource.formal;
  const rows = new Map(completed.rows.map(row => [row.id, row]));
  const latestSource = completed.sources[completed.latest_source];
  const sourceFor = (source, field) => ({html: source.html, json: source.json, field});
  const rowSource = row => sourceFor(completed.sources[row.source], row.field);
  const resultMetric = row => ({
    name: row.title, value: `${row.status}；${row.measured}`, limit: '原场景独立判据', unit: '原记录',
    basis: row.boundary, source: rowSource(row)
  });
  const openMetric = title => {
    const row = completed.open.find(item => item.title === title);
    assert.ok(row, 'Latest result boundary missing: ' + title);
    return {name: row.title, value: row.status, limit: '原场景独立判据', unit: '状态', basis: row.detail, source: sourceFor(latestSource, row.field)};
  };
  const highlights = [];
  const add = (id, title, status, summary, scope, ids, additional = [], date = dateFrom(completed.updated_at), extraSources = []) => {
    const metrics = ids.map(key => {
      assert.ok(rows.has(key), 'Latest result row missing: ' + key);
      return resultMetric(rows.get(key));
    }).concat(additional);
    const sources = [...new Map(metrics.map(metric => [JSON.stringify(metric.source), metric.source]).concat(extraSources.map(source => [JSON.stringify(source), source]))).values()];
    highlights.push({id, title, status, summary, scope, date, metrics, sources});
  };

  add('highlight-functional', '功能、文件与编码', 'PARTIAL',
    '功能、真实 I/O、编码与音频引用链按各自最新记录保留；主题切换和 UI 导出仍有失败。',
    '功能场景与编码复用不替代完整界面组、真实设备或跨 SDK 音频内容验收。',
    ['b01-uia', 'b02-files', 'controlled-io', 'codec-reuse', 'audio-lifetime-reuse'],
    [openMetric('主题、操作计时与 UI 导出')], dateFrom(completed.updated_at),
    [{html: 'reports/tooling/tests-portability-audit-20261018.html', field: '最新跨机复用静态审计；未执行产品测试'}]);

  add('highlight-screen-share', '屏幕采集与共享', 'PASS_SCOPED',
    'WGC 生命周期、六资源门、全屏及窗口采集保留各场景最新终态。',
    '限定实际后端、同机逻辑拓扑与原判据；未覆盖物理多屏、跨 DPI/GPU、主观画质或未声明的预算。',
    ['wgc-lifecycle', 'wgc-six-resources', 'capture-desktop11-dxgi02', 'capture-quality-fullscreen-unblocked01', 'capture-windows', 'gdi-hot-50']);

  add('highlight-whiteboard', '白板与批注', 'PARTIAL',
    '白板功能与 M0 批注子门通过，最新 1800 秒协同负载尝试失败。',
    '功能子门与负载门分别判定；ProbeOverlay 不等同完整产品 overlay 或真实 IME、跨 DPI 验收。',
    ['whiteboard-functional-desktop11', 'annotation-runtime-04'], [openMetric('白板原 1800 秒协同负载')]);

  const pair = latest.entries.telemetry_performance.checks.find(item => item.id === 'pair-1');
  assert.ok(pair);
  add('highlight-telemetry', '遥测资源与性能', 'PARTIAL',
    '最新 ≥9000 秒资源子门通过；OFF/ON 首对 callback P99 超过原 5% 门限，仍为 FAIL。',
    '资源、生命周期与配对性能是独立子门，不合并不同运行授予整组通过。',
    ['telemetry-resource', 'telemetry-lifecycle'], [{
      name: 'OFF/ON 首对 callback P99 增幅', value: pair.callback_p99_increase_upper_percent,
      limit: pair.limits.callback_p99_increase_percent, unit: '%',
      basis: `${pair.status}；后两对 NOT_RUN，根因 UNKNOWN。额外诊断不替代正式性能判据。`,
      source: sourceFor(latestSource, 'entries.telemetry_performance.checks[id=pair-1]')
    }]);

  add('highlight-e2ee', 'E2EE 与跨 SDK 互通', 'PARTIAL',
    'Native、官方 C++ 与 Flutter 逐格展示最新终态；Flutter 的两个失败及未测音频范围保留。',
    '不同运行只按格追溯；Native explicit_fixture_bindings 兼容夹具不代表完整 P05／P06 通过。',
    ['native-e2ee', 'native-e2ee-scope', 'cpp-data', 'cpp-video', 'derived-flutter', 'flutter-projection', 'native-full-relay03'],
    [openMetric('Flutter 全重连与密钥替换'), openMetric('官方 C++ 音频与 SDK 进程内退休恢复')]);

  const audit = latest.entries.network_audit;
  const recovery = audit.independent_review.timeline.latencies_from_episode_source_clock;
  add('highlight-network', '网络、认证与恢复', 'PARTIAL',
    '原十项批次与独立 TURN 复测按原运行分别保留；服务重启与关联证据按限定范围解释。',
    '原十项批次 FAIL 与独立 TURN PASS 不拼接为新整批通过；UI 导出和物理故障范围仍独立。',
    ['network-batch', 'turn-retry', 'service-restart'], [{
      name: '支持包导出回读',
      value: `${audit.export_readback.status}；${audit.export_readback.files_verified} 个工件；${audit.export_readback.metric_rows} 条指标；${audit.export_readback.timeline_events} 条事件`,
      limit: '原工件完整性与关联判据', unit: '原记录',
      basis: `仅已有工件回读；UI 导出 NOT_RUN。原批次 ${audit.source_batch_status}、终态输入身份 ${audit.source_batch_terminal_input_identity_status} 和已声明缺失保留。`,
      source: sourceFor(latestSource, 'entries.network_audit.export_readback')
    }, {
      name: '独立复盘恢复时间：信令／解码稳定／可见渲染稳定',
      value: `${recovery.signaling_terminal.source_delta_ms}／${recovery.decoded_video_stable_endpoint.source_delta_ms}／${recovery.visible_render_stable_endpoint.source_delta_ms}`,
      limit: '同 episode 源时钟关联', unit: 'ms',
      basis: `复盘 ${audit.independent_review.status}，产品门 ${audit.independent_review.product_gate_status}、完整门信用 ${audit.independent_review.full_gate_credit}。音频 NOT_EXPECTED，支持包可复盘不代表根因确认。`,
      source: sourceFor(latestSource, 'entries.network_audit.independent_review.timeline.latencies_from_episode_source_clock')
    }]);

  const formalRef = {html: formalPath.replace(/\.json$/, '.html'), json: formalPath};
  const attemptRef = {html: attemptPath.replace(/\.json$/, '.html'), json: attemptPath};
  const formalMetric = (name, value, limit, unit, field, basis) => ({name, value, limit, unit, basis, source: {...formalRef, field}});
  const formalMetrics = [
    formalMetric('最新已完成 Formal 处置', formal.status, '限定本次运行', '状态', 'formal.status', `run_id=${formal.run_id}；原机器判定 ${formal.raw_verdict} 保留。`),
    formalMetric('完成周期', formal.cycles_completed, '原 Formal 周期要求', '轮', 'formal.cycles_completed', `原始周期：PASS ${formal.raw_cycle_counts.PASS}，FAIL ${formal.raw_cycle_counts.FAIL}；第${formal.exception.cycle}周期按明确授权作为 ACCEPTED_EXCEPTION。`),
    formalMetric('同一产品进程存活', formal.product_live_seconds, '原 Formal 存活要求', '秒', 'formal.product_live_seconds', '只属于该冻结运行，不为新候选授予结果。'),
    formalMetric('NIC 超限例外', `cycle ${formal.exception.cycle}；${formal.exception.check}`, '仅此运行及检查', '限定处置', 'formal.exception', `测量流量归属 ${formal.exception.measured_traffic_owner}；用户说明的 RustDesk 并发不等于已完成包级归因。`)
  ];
  for (const [key, label, unit, divisor] of [['private_bytes', 'Private Bytes 增长', 'MiB', 1048576], ['wddm_bytes', 'WDDM 增长', 'MiB', 1048576], ['handles', '句柄增长', '个', 1], ['threads', '线程增长', '个', 1]]) {
    const value = formal.resource_growth[key];
    formalMetrics.push(formalMetric(label, value.growth / divisor, value.limit / divisor, unit, `formal.resource_growth.${key}`, `原资源判据：${value.passed ? 'PASS' : 'FAIL'}。`));
  }
  formalMetrics.push({name: '最新无例外新尝试', value: `Formal ${attempt.formal}；资格通过 ${attempt.qualification_passes} 次`, limit: '新运行重新准入', unit: '状态', basis: `最近尝试 ${attempt.latest_attempt.verdict}：${attempt.latest_attempt.reason}；不复用上一冻结 Formal 的授权例外。`, source: {...attemptRef, field: 'formal / qualification_passes / latest_attempt'}});
  add('highlight-b14', 'B14 正式长稳', formal.status,
    '最新完成的冻结运行按限定例外收口；最新无例外新尝试尚未进入 Formal。',
    `原机器 FAIL、第52周期限定例外及流量归属 UNKNOWN 保留；仍暂缓：${formal.deferred.join('、')}。本阶段 P20 继续暂停。`,
    [], formalMetrics, dateFrom(attempt.utc),
    [{html: 'reports/b14/b14-amd-camera-rejoin-20261019-03-reviewed.html', field: '摄像头两周期专项；qualification-excluded，不授 Formal 信用'}]);

  const memoryRef = {html: 'reports/memory/memory-optimization-20261019.html', json: memoryPath};
  const memoryMetrics = [];
  for (const scenario of memory.export) {
    const before = scenario.variants.baseline, after = scenario.variants.candidate;
    for (const [key, label, unit] of [['allocation_calls', 'new 请求次数', '次'], ['cumulative_requested_bytes', '累计请求字节', 'bytes'], ['elapsed_ms', '完整导出耗时', 'ms']]) {
      memoryMetrics.push({name: `${scenario.case} · ${label}`, value: `${display(before[key].mean)} → ${display(after[key].mean)}`, limit: '同输入基线对照', unit,
        basis: `每实现 ${after[key].samples} 次观察的均值；减少 ${display(scenario.reduction_percent[key])}%。仅独立成本夹具，不换算产品 Private Bytes。`,
        source: {...memoryRef, field: `export[case=${scenario.case}].variants / reduction_percent.${key}`}});
    }
  }
  memoryMetrics.push({name: '日志缓存保守计费', value: `${display(memory.console.baseline.cache_charge_bytes)} → ${display(memory.console.candidate.cache_charge_bytes)}`, limit: '相同1200条输入', unit: 'bytes', basis: '保守 charge 不是实际 heap 或 Private Bytes；隐藏投影成本被推迟到显示或显式复制。', source: {...memoryRef, field: 'console'}});
  add('highlight-memory', '内存成本优化', memory.gates.every(gate => gate.result === 'PASS') ? 'PASS_SCOPED' : 'PARTIAL',
    '最新离线同输入对照记录导出请求分配与日志缓存成本。',
    '仅 OFFLINE_SYNTHETIC_NOT_FORMAL。C++ new 请求不包含 malloc、分配器元数据、碎片及 OS 提交页；不作为内存泄漏解释、产品绝对内存均值或正式长稳结论。',
    [], memoryMetrics, dateFrom(memory.created_utc));

  for (const source of new Map(highlights.flatMap(card => card.sources).map(source => [source.html, source])).values()) await readSource(source.html);
  assert.equal(new Set(highlights.map(card => card.id)).size, highlights.length);
  return {
    schema: 'cohavora-latest-test-results-v1', timezone: 'Asia/Shanghai', updated_at: completed.updated_at, scope: completed.scope,
    summary: {status: latest.status, scope: completed.scope, full_plan_gates_completed: completed.full_plan_gates_completed,
      final_regression_status: completed.final_regression_status, formal_status: formal.status, current_formal_status: attempt.formal,
      statement: '仅展示各测试范围最新已有结果；P20 Formal 暂停，最终回归 NOT_RUN。各子门和不同运行不相加为完整验收通过率。'},
    highlights, sources: [...receipts.values()].sort((left, right) => left.path.localeCompare(right.path, 'en'))
  };
}

export function renderLatestCards(data) {
  return `<section id="highlights"><h2>最新测试结果</h2><p>沿用原卡片与指标表格，按相同测试范围取最新记录。不同运行、后端和子门分别解释；失败、复用及未测范围保留。</p><div class="highlight-grid">${data.highlights.map((card, index) => `<article class="highlight-card" id="${esc(card.id)}">
<div class="highlight-heading"><span class="highlight-number">${String(index + 1).padStart(2, '0')}</span><div><h3>${esc(card.title)}</h3><span class="badge ${statusClass(card.status)}">${esc(card.status)}</span><span class="scope-tag">最新限定结果</span></div></div>
<p>${esc(card.summary)}</p><p class="boundary"><b>适用范围：</b>${esc(card.scope)}</p><details><summary>查看实测指标、原判据与来源</summary><p class="note">结果记录日期：${esc(card.date)}</p>
<div class="table-wrap"><table class="highlight-metrics"><thead><tr><th>指标</th><th>实测值／状态</th><th>原门限／期望</th><th>单位</th></tr></thead><tbody>${card.metrics.map(metric => `<tr><th scope="row">${esc(metric.name)}</th><td><strong>${esc(display(metric.value))}</strong></td><td>${esc(display(metric.limit))}</td><td>${esc(metric.unit)}</td></tr>`).join('')}</tbody></table></div>
<details><summary>指标依据与报告来源</summary><ul>${card.metrics.map(metric => `<li><b>${esc(metric.name)}：</b>${esc(metric.basis)}<br><small>${esc(metric.source.field ?? '')}</small></li>`).join('')}</ul><ul class="sources">${card.sources.map(source => `<li><a href="${esc(source.html)}">原报告</a>${source.json ? ` · <a href="${esc(source.json)}">结构化结果</a>` : ''}${source.field ? `<br><small>${esc(source.field)}</small>` : ''}</li>`).join('')}</ul></details></details></article>`).join('')}</div></section>`;
}
