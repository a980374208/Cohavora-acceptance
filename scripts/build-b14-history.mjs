import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

// Explicit outputs only. Input locations belong in an external machine manifest.
// node scripts/build-b14-history.mjs --manifest <file> --data <file> --html <file> --receipt <file>
const options = Object.fromEntries(process.argv.slice(2).reduce((pairs, value, index, args) => {
  if (index % 2 === 0) pairs.push([value.replace(/^--/, ''), args[index + 1]]);
  return pairs;
}, []));
for (const key of ['manifest', 'data', 'html', 'receipt']) {
  if (!options[key] || !process.argv.includes(`--${key}`)) throw new Error(`Missing --${key}`);
}
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const decodeJSON = bytes => JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, ''));
const manifestPath = path.resolve(options.manifest);
const manifestBytes = await fs.readFile(manifestPath);
const manifest = decodeJSON(manifestBytes);
const absolute = value => path.resolve(path.dirname(manifestPath), value);
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const numeric = value => typeof value === 'number' && Number.isFinite(value);
const equal = (a, b) => numeric(a) && numeric(b) && Math.abs(a - b) <= 1e-10 * Math.max(1, Math.abs(a), Math.abs(b));
const at = (object, dottedPath) => dottedPath.split('.').reduce((value, key) => value?.[key], object);
const beijing = utc => {
  const date = new Date(utc);
  assert(Number.isFinite(date.valueOf()), `Invalid timestamp: ${utc}`);
  return new Date(date.valueOf() + 8 * 3600 * 1000).toISOString().slice(0, 19).replace('T', ' ') + ' +08:00';
};
const summarize = values => {
  const sorted = [...values].sort((a, b) => a - b);
  const n = values.length;
  return {n, mean: values.reduce((sum, value) => sum + value, 0) / n,
    p50: sorted[Math.ceil(0.50 * n) - 1], p95: sorted[Math.ceil(0.95 * n) - 1], max: sorted[n - 1]};
};
assert(manifest.runs?.length === 5, 'History requires exactly five independent runs');
assert(new Set(manifest.runs.map(run => run.run_id)).size === 5, 'Duplicate manifest run_id');
const definitionPath = absolute(manifest.metric_definitions);
const definitionBytes = await fs.readFile(definitionPath);
const definitionSource = decodeJSON(definitionBytes);
const definitions = definitionSource.metrics.map(({id, name, unit, source_field, note}) => ({id, name, unit, source_field, note}));
assert(definitions.length === 20 && new Set(definitions.map(metric => metric.id)).size === 20, 'Expected 20 unique metric definitions');
for (const metric of definitions) {
  assert(typeof metric.name === 'string' && !metric.name.includes('\ufffd'), `Invalid UTF-8 metric name: ${metric.id}`);
  assert(/^(external_review\.)?cycles\[\*\]\.details\./.test(metric.source_field), `Unexpected scalar path: ${metric.id}`);
}

const runs = [];
const comparisons = [];
for (const input of manifest.runs) {
  const sourcePath = absolute(input.source_path);
  const sourceReadPath = input.source_read_path ? absolute(input.source_read_path) : sourcePath;
  // Read each original once: the same immutable bytes supply the hash, parse and optional backup.
  const bytes = await fs.readFile(sourceReadPath);
  const sourceHash = sha256(bytes);
  const review = decodeJSON(bytes);
  assert(review.run_id === input.run_id, `Source run_id mismatch: ${input.key}`);
  assert(review.mode === 'Formal', `Not a Formal source: ${input.key}`);
  assert(review.verdict === 'FAIL', `Unexpected original verdict: ${input.key}`);
  assert(review.cycles?.length === 100, `Expected 100 cycles: ${input.key}`);
  assert(numeric(review.duration_seconds) && review.duration_seconds >= 28800, `Incomplete eight-hour source: ${input.key}`);
  assert(new Set(review.cycles.map(cycle => cycle.cycle_id)).size === 100, `Duplicate cycle_id: ${input.key}`);
  const privateGrowth = review.resource_growth?.private_bytes;
  assert(numeric(privateGrowth?.growth) && privateGrowth.limit === 64 * 1048576, `Original Private Bytes gate mismatch: ${input.key}`);
  assert(equal(privateGrowth.growth / 1048576, input.expected_private_growth_mib), `Private Bytes source mismatch: ${input.key}`);
  const perCycle = review.cycles.map((cycle, index) => {
    assert(cycle.cycle === index + 1 && typeof cycle.cycle_id === 'string', `Invalid cycle sequence: ${input.key}/${index + 1}`);
    const row = {cycle: cycle.cycle, cycle_id: cycle.cycle_id, raw_verdict: cycle.verdict};
    for (const metric of definitions) {
      const scalarPath = metric.source_field.replace(/^(external_review\.)?cycles\[\*\]\./, '');
      const raw = at(cycle, scalarPath);
      assert(numeric(raw), `Missing/non-numeric scalar: ${input.key}/${cycle.cycle}/${metric.id}`);
      row[metric.id] = metric.id === 'telemetry_queue_peak_mib' ? raw / 1048576 : raw;
    }
    return row;
  });
  const metrics = definitions.map(metric => ({...metric, ...summarize(perCycle.map(cycle => cycle[metric.id]))}));
  const observedCounts = Object.fromEntries([...new Set(perCycle.map(cycle => cycle.raw_verdict))].map(verdict => [verdict, perCycle.filter(cycle => cycle.raw_verdict === verdict).length]));
  assert(Object.entries(review.cycle_counts ?? {}).every(([key, count]) => observedCounts[key] === count), `Source cycle verdict count mismatch: ${input.key}`);
  const sourceBackUp = manifest.source_backup_directory ? path.join(absolute(manifest.source_backup_directory), input.key + '-external-review.json') : null;
  if (sourceBackUp && sourceReadPath !== sourceBackUp) {
    await fs.mkdir(path.dirname(sourceBackUp), {recursive: true});
    await fs.writeFile(sourceBackUp, bytes, {flag: 'wx'});
  }
  const run = {
    key: input.key, label: input.label, run_id: review.run_id,
    source_path: input.source_path, source_read_path: sourceReadPath, source_sha256: sourceHash, source_bytes: bytes.length,
    source_backup_path: sourceBackUp, started_utc: review.started_utc, finished_utc: review.finished_utc,
    started_beijing: beijing(review.started_utc), finished_beijing: beijing(review.finished_utc),
    cycle_count: review.cycles.length, duration_seconds: review.duration_seconds,
    product_live_seconds_before_close: review.product_lifetime_floor?.product_live_elapsed_seconds_before_close ?? null,
    raw_verdict: review.verdict, raw_cycle_counts: review.cycle_counts, observed_cycle_counts: observedCounts,
    original_private_bytes_growth: {...privateGrowth, growth_mib: privateGrowth.growth / 1048576, limit_mib: privateGrowth.limit / 1048576},
    metrics, per_cycle: perCycle
  };
  if (input.existing_aggregate) {
    const aggregatePath = absolute(input.existing_aggregate);
    const aggregateBytes = await fs.readFile(aggregatePath);
    const aggregate = decodeJSON(aggregateBytes);
    assert(aggregate.run_id === review.run_id, `Aggregate run_id mismatch: ${input.key}`);
    let aggregateBinding = {kind: 'original-external-review', path: input.source_path, sha256: sourceHash};
    if (aggregate.source_sha256 !== sourceHash) {
      // A packaged aggregate may bind the scoped same-run projection instead of the large raw verifier JSON.
      assert(typeof aggregate.source_path === 'string', `Missing aggregate projection path: ${input.key}`);
      const projectionPath = path.resolve(path.dirname(aggregatePath), '..', aggregate.source_path);
      const projectionBytes = await fs.readFile(projectionPath);
      const projection = decodeJSON(projectionBytes);
      assert(sha256(projectionBytes) === aggregate.source_sha256, `Aggregate projection SHA-256 mismatch: ${input.key}`);
      assert(projection.run_id === review.run_id && projection.external_review?.run_id === review.run_id, `Aggregate projection run_id mismatch: ${input.key}`);
      for (const cycle of perCycle) {
        const projectedCycle = projection.external_review.cycles.find(row => row.cycle === cycle.cycle && row.cycle_id === cycle.cycle_id);
        assert(projectedCycle, `Projection cycle mismatch: ${input.key}/${cycle.cycle}`);
        for (const metric of definitions) {
          const scalarPath = metric.source_field.replace(/^(external_review\.)?cycles\[\*\]\./, '');
          const projectedRaw = at(projectedCycle, scalarPath);
          const projectedValue = metric.id === 'telemetry_queue_peak_mib' ? projectedRaw / 1048576 : projectedRaw;
          assert(equal(cycle[metric.id], projectedValue), `Projection scalar mismatch: ${input.key}/${cycle.cycle}/${metric.id}`);
        }
      }
      aggregateBinding = {kind: 'same-run-scoped-projection', path: projectionPath, sha256: aggregate.source_sha256, raw_scalar_values_compared: 2000};
    }
    assert(aggregate.metrics?.length === 20, `Aggregate metric count mismatch: ${input.key}`);
    let fieldsChecked = 0;
    for (const metric of metrics) {
      const existing = aggregate.metrics.find(row => row.id === metric.id);
      assert(existing && existing.unit === metric.unit && existing.n === metric.n, `Aggregate metric identity/count mismatch: ${input.key}/${metric.id}`);
      fieldsChecked += 2;
      for (const field of ['mean', 'p50', 'p95', 'max']) {
        assert(equal(metric[field], existing[field]), `Aggregate ${field} mismatch: ${input.key}/${metric.id}: ${metric[field]} vs ${existing[field]}`);
        fieldsChecked++;
      }
    }
    comparisons.push({run_id: review.run_id, aggregate_path: input.existing_aggregate, aggregate_sha256: sha256(aggregateBytes),
      aggregate_source_binding: aggregateBinding, metric_count: 20, statistics_fields_checked: fieldsChecked, numeric_tolerance: 'abs(a-b) <= 1e-10 * max(1,abs(a),abs(b))', status: 'PASS'});
  }
  runs.push(run);
}
assert(comparisons.length === 3, 'Expected three existing aggregate cross-checks');
const data = {
  schema: 'cohavora-b14-historical-cycle-metrics', schema_version: 1,
  created_utc: new Date().toISOString(), status: 'READ_ONLY_DERIVED_NO_RETEST',
  title: 'B14 历史五次八小时／一百轮重要实测指标',
  metric_definitions_source: {path: manifest.metric_definitions, sha256: sha256(definitionBytes)},
  derivation_method: {
    sample: '每个run独立使用原external-review.cycles的100个逐轮摘要值；不跨run拼接，不把最新run数值回填旧run。',
    mean: 'sum(100 per-cycle scalars)/100; equal cycle weight',
    p50: 'nearest rank: sorted_values[ceil(0.50*n)-1]',
    p95: 'nearest rank: sorted_values[ceil(0.95*n)-1]', max: 'maximum of the 100 per-cycle scalar values',
    queue_bytes_to_mib: 'telemetry_queue_peak_mib = queue_peak_bytes / 1048576',
    render_p95: '逐轮render P95分桶下界、上界及增幅保守上界各自统计，仍表示桶边界；并非原始逐帧或全部回调的分布。',
    original_verdict_preserved: true, original_private_bytes_limit_mib: 64, no_product_test_executed: true
  },
  totals: {runs: runs.length, cycles: runs.reduce((sum, run) => sum + run.cycle_count, 0),
    metric_rows: runs.reduce((sum, run) => sum + run.metrics.length, 0), scalar_samples: 5 * 100 * 20,
    duration_seconds: runs.reduce((sum, run) => sum + run.duration_seconds, 0)},
  limitations: [
    '本页仅比较20项重要实测；首帧与UI operation timing另有证据和缺口，不混入本表，也不补造缺失耗时。',
    '原机器判定与原Private Bytes 64 MiB门限保留；本次用户暂定PASS处置见验收首页，不在历史统计中改写。',
    '日志窗口CPU不代表全八小时平均；逐轮share-stop Private Bytes增量不等同首末各十个room-release窗口中位数差。',
    '包内JSON保留每个指标100个逐轮数值，可离线独立复算；原路径及SHA-256用于核对本机原始证据，包外路径在其他电脑可能不可用。'
  ], runs, existing_aggregate_cross_checks: comparisons
};
assert(data.totals.metric_rows === 100 && data.totals.cycles === 500 && data.totals.scalar_samples === 10000, 'History totals mismatch');

const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[char]));
const num = value => numeric(value) ? value.toLocaleString('en-US', {maximumFractionDigits: 6, useGrouping: false}) : '未留存';
const sections = runs.map(run => `<section id="run-${esc(run.key)}" data-run-id="${esc(run.run_id)}">
  <h2>${esc(run.label)}</h2>
  <p class="run-identity">run_id：<code>${esc(run.run_id)}</code></p>
  <dl class="run-meta"><div><dt>北京时间</dt><dd>${esc(run.started_beijing)} 至 ${esc(run.finished_beijing)}</dd></div>
  <div><dt>实测范围</dt><dd>${run.cycle_count}轮／${esc(num(run.duration_seconds))}秒${run.product_live_seconds_before_close === null ? '' : '；关闭前产品存活' + esc(num(run.product_live_seconds_before_close)) + '秒'}</dd></div>
  <div><dt>原机器判定</dt><dd><strong class="raw-fail">${esc(run.raw_verdict)}</strong>；逐轮原判定 ${Object.entries(run.raw_cycle_counts).map(([key, value]) => esc(key) + ' ' + value).join('／')}</dd></div>
  <div><dt>原跨周期Private Bytes增长</dt><dd>+${esc(num(run.original_private_bytes_growth.growth_mib))} MiB；原门限${run.original_private_bytes_growth.limit_mib} MiB；原检查${run.original_private_bytes_growth.passed ? 'PASS' : 'FAIL'}</dd></div></dl>
  <div class="table-wrap"><table class="history-statistics"><caption>${esc(run.label)}：20项逐轮摘要值统计</caption><thead><tr><th scope="col">指标</th><th scope="col">n/100</th><th scope="col">mean</th><th scope="col">P50</th><th scope="col">P95</th><th scope="col">max</th><th scope="col">unit</th></tr></thead><tbody>
  ${run.metrics.map(metric => `<tr data-metric-id="${esc(metric.id)}"><th scope="row">${esc(metric.name)}${metric.note ? '<small>' + esc(metric.note) + '</small>' : ''}</th><td>${metric.n}/100</td><td><strong>${esc(num(metric.mean))}</strong></td><td>${esc(num(metric.p50))}</td><td>${esc(num(metric.p95))}</td><td>${esc(num(metric.max))}</td><td>${esc(metric.unit)}</td></tr>`).join('\n')}
  </tbody></table></div>
  <details><summary>原始来源与20项字段</summary><p>原路径：<code>${esc(run.source_path)}</code></p><p>SHA-256：<code>${esc(run.source_sha256)}</code>（${run.source_bytes} bytes）</p><p>原始UTC起止：${esc(run.started_utc)} 至 ${esc(run.finished_utc)}</p><ul>${run.metrics.map(metric => '<li>' + esc(metric.name) + '：<code>' + esc(metric.source_field) + '</code></li>').join('')}</ul></details>
  <p class="top-link"><a href="#history-overview">返回五次运行导航</a></p>
</section>`).join('\n');
const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>B14 历史五次八小时／一百轮重要实测指标</title><link rel="stylesheet" href="../../assets/report-style.css">
<style>
body{font-size:14px}main{max-width:1240px;margin:0 auto;padding:28px 24px 48px}h1{color:var(--navy);font-size:28px;line-height:1.4}h2{color:var(--navy);font-size:22px}nav[data-report-navigation]{padding:12px 24px;background:#eef2f7;color:var(--ink)}section{margin:26px 0;background:var(--paper);border:1px solid var(--line);border-radius:10px;padding:24px;scroll-margin-top:20px}.intro{color:var(--muted)}.boundary{background:var(--amber-bg);border-left:4px solid var(--amber);padding:12px 16px}.run-nav{display:flex;gap:8px;flex-wrap:wrap;padding:0;list-style:none}.run-nav a{display:block;background:var(--paper);border:1px solid var(--line);border-radius:6px;padding:7px 12px}.run-meta{display:grid;gap:8px;margin:14px 0 20px}.run-meta div{display:grid;grid-template-columns:210px 1fr;gap:10px}.run-meta dt{font-weight:600}.run-meta dd{margin:0}.raw-fail{color:var(--red)}.table-wrap{overflow-x:auto}.history-statistics{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums;min-width:870px}.history-statistics caption{text-align:left;font-weight:600;color:var(--muted);padding:0 0 10px}.history-statistics th,.history-statistics td{border:1px solid var(--line);padding:10px 12px;text-align:right;vertical-align:top}.history-statistics thead th{background:var(--navy);color:white;white-space:nowrap}.history-statistics th:first-child{width:44%;text-align:left}.history-statistics tbody tr:nth-child(even){background:var(--bg)}.history-statistics th small{display:block;color:var(--muted);font-size:12px;line-height:1.6;font-weight:400;margin-top:4px}details{margin-top:16px}details p,details li{font-size:12px}summary{cursor:pointer;color:var(--blue)}code{font-family:var(--font-mono);font-size:12px;overflow-wrap:anywhere}.top-link{margin:16px 0 0}.method{background:var(--blue-bg);border:1px solid var(--blue-border);padding:14px 18px;border-radius:8px}@media(max-width:700px){main{padding:18px 12px}section{padding:16px 12px}.run-meta div{grid-template-columns:1fr;gap:0}h1{font-size:23px}}
</style></head><body>
<nav data-report-navigation><a href="../../index.html#highlight-b14">验收首页 · B14</a> · <a href="../index.html">全部报告</a> · <a href="../../data/b14-historical-metrics.json">五次统计与逐轮数据JSON</a></nav>
<main id="history-overview"><header><h1>B14 历史五次八小时／一百轮重要实测指标</h1><p class="intro">5次独立Formal运行，各100轮、20项；共500轮、100个指标行、10000个逐轮数值。各次运行使用自己的原external-review，保留原机器结果及来源。</p></header>
<p class="boundary">本页保留各run原机器判定FAIL和原Private Bytes 64 MiB门限；本次用户暂定PASS处置见<a href="../../index.html#highlight-b14">首页B14说明</a>。历史指标统计不改变原始检查结果。</p>
<nav aria-label="历史运行跳转"><ul class="run-nav">${runs.map(run => '<li><a href="#run-' + esc(run.key) + '">' + esc(run.label) + '</a></li>').join('')}</ul></nav>
<div class="method"><p><b>统一统计口径：</b>每项n/100为有效逐轮数；mean为100个逐轮摘要值等权平均；P50/P95采用最近秩法，排序后取第ceil(p×n)项，max为其中最大值。页面显示至多六位小数，JSON保留原数值精度。</p><p>每轮最大值的分位数只描述这100个最大值；render P95分桶上下界及增幅保守上界保持原语义，均不代表原始逐帧、全部回调或端到端时延分布。队列峰值字节按1048576换算MiB。</p><p>本页仅列20项重要实测，首帧和UI operation timing的留存缺口另行说明，不混入这五张表。各run逐轮数值与字段说明保存在<a href="../../data/b14-historical-metrics.json">包内JSON</a>，可离线独立复算。</p></div>
${sections}
<footer><p class="intro">仅对已完成证据作离线派生，未运行产品、测试或构建；未以本统计授予新的验收资格。</p></footer></main></body></html>
`;
assert((html.match(/<tr data-metric-id=/g) ?? []).length === 100, 'HTML metric row count mismatch');
assert((html.match(/<table class="history-statistics"/g) ?? []).length === 5, 'HTML table count mismatch');
assert((html.match(/<th scope="col">/g) ?? []).length === 35, 'HTML column count mismatch');
assert(!html.includes('\ufffd'), 'HTML contains UTF-8 replacement characters');
const dataBytes = Buffer.from(JSON.stringify(data, null, 2) + '\n', 'utf8');
const htmlBytes = Buffer.from(html, 'utf8');
for (const [target, bytes] of [[options.data, dataBytes], [options.html, htmlBytes]]) {
  await fs.mkdir(path.dirname(path.resolve(target)), {recursive: true});
  await fs.writeFile(path.resolve(target), bytes);
}
const receipt = {
  schema: 'cohavora-b14-history-static-receipt', created_utc: new Date().toISOString(), status: 'PASS_STATIC_DERIVATION',
  manifest: {path: manifestPath, sha256: sha256(manifestBytes)}, input_reads_per_run: 1,
  original_source_reads_this_invocation: runs.filter(run => path.resolve(run.source_read_path) === absolute(run.source_path)).length,
  source_backup_reads_this_invocation: runs.filter(run => path.resolve(run.source_read_path) !== absolute(run.source_path)).length,
  no_product_build_or_test: true, totals: data.totals,
  checks: {unique_run_ids: 5, cycles_per_run: 100, metrics_per_run: 20, numeric_samples_per_metric: 100,
    metric_rows: 100, statistic_fields: ['n', 'mean', 'p50', 'p95', 'max', 'unit'], html_tables: 5, html_columns_per_table: 7,
    original_private_bytes_limit_mib: 64, original_verdict_preserved: true, utf8_replacement_characters: 0},
  sources: runs.map(run => ({run_id: run.run_id, source_path: run.source_path, read_path: run.source_read_path, sha256: run.source_sha256, bytes: run.source_bytes, backup_path: run.source_backup_path})),
  existing_aggregate_cross_checks: comparisons,
  outputs: [{path: path.resolve(options.data), sha256: sha256(dataBytes), bytes: dataBytes.length},
    {path: path.resolve(options.html), sha256: sha256(htmlBytes), bytes: htmlBytes.length}]
};
await fs.mkdir(path.dirname(path.resolve(options.receipt)), {recursive: true});
await fs.writeFile(path.resolve(options.receipt), JSON.stringify(receipt, null, 2) + '\n');
console.log(JSON.stringify({status: receipt.status, totals: receipt.totals, outputs: receipt.outputs, receipt: path.resolve(options.receipt)}, null, 2));
