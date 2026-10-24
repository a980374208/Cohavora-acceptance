import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';

const norm = value => String(value).replaceAll('\\', '/').toLowerCase();
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const parse = bytes => JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, ''));
const asText = value => value == null ? '' : typeof value === 'string' ? value : JSON.stringify(value);
const esc = value => asText(value).replace(/[&<>"']/g, char => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[char]));
const paragraphs = values => (values || []).map(value => '<p>' + esc(value) + '</p>').join('');
const counts = (rows, statusOf) => rows.reduce((result, row) => {
  const status = statusOf(row);
  result[status] = (result[status] || 0) + 1;
  return result;
}, {});
const countText = value => Object.entries(value).map(([status, count]) => status + ' ' + count).join('；');
const badge = status => '<strong class="' + (/^PASS|^READY$|^user_pass$/.test(status) ? 'pass' : /^FAIL/.test(status) ? 'fail' : 'partial') + '">' + esc(status) + '</strong>';

// Result paths come from package-local evidence; unsupported paths remain visible text.
const sourceLink = (source, locator = '') => {
  const relative = asText(source).replaceAll('\\', '/');
  const target = relative + (locator ? '#' + locator : '');
  if (!/^(?:data|reports)\//.test(relative) || relative.split('/').includes('..') || /[\x00-\x1f]/.test(target)) return '<code>' + esc(target) + '</code>';
  return '<a href="' + esc('../../' + target) + '">' + esc(target) + '</a>';
};

const resultMarkup = result => {
  const disposition = result.current_disposition;
  return '<li><p>' + esc(result.title) + '：原始状态 ' + badge(result.status) +
    (disposition ? '；当前处置 ' + badge(disposition.status) + '（' + esc(disposition.date) + '）' : '；当前处置沿用原始状态') +
    '；结果日期 ' + esc(result.date) + '</p><p>' + esc(result.scope) + '</p><p>结果来源：' +
    sourceLink(result.source_path, result.source_locator) + '</p>' +
    (disposition ? '<p>处置来源：' + sourceLink(disposition.source_path || disposition.report_path, disposition.source_locator) + '</p>' : '') + '</li>';
};

/** Rebuild the existing closure report from the main report's current projection. */
export async function refreshStageReport(root, data, {writeEvidence = true} = {}) {
  assert.ok(data.stageRefresh, 'Stage refresh must run before stage report rendering');
  const htmlPath = 'reports/product/stage-closure-20261022.html';
  const jsonPath = 'reports/product/stage-closure-20261022.json';
  const [templateBytes, referenceBytes] = await Promise.all([
    fs.readFile(path.join(root, htmlPath)), fs.readFile(path.join(root, jsonPath))
  ]);
  const template = templateBytes.toString('utf8').replace(/^\uFEFF/, '');
  const previous = parse(referenceBytes);
  const style = template.match(/<style\b[^>]*>[\s\S]*?<\/style>/i)?.[0];
  const navigation = template.match(/<nav\b[^>]*data-report-navigation[^>]*>[\s\S]*?<\/nav>/i)?.[0];
  assert.ok(style && navigation, 'Existing stage report must provide its style and navigation');
  const groups = data.retestRecords;
  assert.equal(groups.length, 24, 'Stage report must contain all frozen groups');
  assert.equal(new Set(groups.map(group => group.plan_code)).size, 24);
  for (const group of groups) {
    assert.ok(group.stage_status?.status && group.stage_status?.as_of, 'Missing current stage assessment: ' + group.plan_code);
    assert.equal(group.status, group.stage_status.status, 'Current plan and stage statuses differ: ' + group.plan_code);
    assert.equal(group.stage_status.full_gate_credit, 0);
    if (group.plan_kind === 'product') assert.ok(Array.isArray(group.completed_results), 'Completed results must be projected before rendering: ' + group.plan_code);
  }
  const decision = data.stageReleaseDecision;
  assert.equal(decision?.status, 'USER_APPROVED_RELEASE');
  assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(decision.date));
  assert.ok(decision.version && decision.statement && decision.source);
  const approval = {...structuredClone(decision.release_approval), date: decision.date, statement: decision.statement, source: decision.source};
  const groupCounts = counts(groups, group => group.status);
  const allResults = groups.flatMap(group => group.completed_results || []);
  const resultCounts = counts(allResults, result => result.current_disposition?.status || result.status);
  const remainingGroups = groups.filter(group => group.stage_status.remaining?.length || group.stage_status.inconclusive?.length);
  const title = previous.title || '冻结测试清单：阶段收口报告';
  const sourceTitle = sourceLink('data/stage-source-changes-20261022.json');
  const resultSummary = groups.filter(group => group.completed_results?.length).map(group =>
    '<p>' + esc(group.plan_code + ' · ' + group.title) + '：' + esc(countText(counts(group.completed_results, result => result.current_disposition?.status || result.status))) + '</p>').join('');

  const remainingRows = remainingGroups.map(group => {
    const stage = group.stage_status;
    return '<tr><td>' + esc(group.plan_code) + '</td><td>' + paragraphs(stage.remaining) +
      (stage.inconclusive?.length ? '<details><summary>未定结论</summary>' + paragraphs(stage.inconclusive) + '</details>' : '') +
      '</td><td>' + badge(stage.status) + '</td><td>按本组当前剩余边界保留；本次仅更新报告，后续执行另行定界。' +
      (stage.disposition_source ? '<p>处置来源：' + sourceLink(stage.disposition_source) + '</p>' : '') +
      '</td><td>STOP_THIS_STAGE_NO_RETEST</td></tr>';
  }).join('');
  const groupRows = groups.map(group => {
    const stage = group.stage_status;
    const results = group.completed_results || [];
    const details = results.length ? '<details><summary>已完成结果：' + esc(results.length) + ' 条范围投影（共享子门不重复计测试项）</summary><ol>' + results.map(resultMarkup).join('') + '</ol></details>' : '';
    const evidence = [...new Set([...(stage.evidence_refs || []), stage.evidence_catalog].filter(value => /^(?:data|reports)\//.test(value)))];
    return '<tr><td>' + esc(group.plan_code) + '</td><td>' + esc(group.title) + '</td><td>' + badge(group.status) +
      '<p>评估日期：' + esc(stage.as_of) + '</p>' +
      (stage.original_status || stage.raw_status ? '<p>原始状态：' + badge(stage.original_status || stage.raw_status) + '</p>' : '') +
      (stage.disposition_source ? '<p>当前处置：' + sourceLink(stage.disposition_source) + '</p>' : '') +
      '</td><td>' + paragraphs(stage.completed_scope) + details + '</td><td>' + paragraphs(stage.remaining) +
      (stage.inconclusive?.length ? '<details><summary>未定结论</summary>' + paragraphs(stage.inconclusive) + '</details>' : '') +
      (stage.retained_failures?.length ? '<details><summary>保留的原始失败／历史边界</summary>' + paragraphs(stage.retained_failures) + '</details>' : '') +
      (evidence.length ? '<details><summary>分组证据</summary>' + evidence.map(value => '<p>' + sourceLink(value) + '</p>').join('') + '</details>' : '') +
      '</td></tr>';
  }).join('');

  const html = '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + esc(title) + '</title>' + style + '</head><body>' + navigation +
    '<main><header><p>COHAVORA · STAGE CLOSURE</p><h1>' + esc(title) + '</h1><p><strong class="partial">阶段已收口 · PARTIAL</strong> 冻结 ' + esc(previous.frozen_at) + '；当前报告更新 ' + esc(decision.date) + '</p><p><a href="stage-closure-20261022.json">报告状态JSON</a> · <a href="../../data/stage-closure-20261022.json">完整冻结阶段数据与证据引用</a> · <a href="../../data/stage-freeze-20261022-plan.json">冻结清单快照</a> · <a href="../../data/stage-source-changes-20261022.json">源码改动清单</a></p></header>' +
    '<aside><p>' + esc(decision.statement) + '</p><p>24组：21产品组、3辅助组；50条原测试映射及2条非测试动作，合计52条原记录。当前处置、最新已完成范围及原始结果分别保留，不计算完成百分比。未新增子门、矩阵或门限。</p><p>本次报告更新未执行构建、产品测试、桌面探测或新增诊断；阶段保持停止。发版批准来自用户评估，来源：' + sourceLink(decision.source) + '。</p></aside>' +
    '<section><h2>阶段结果</h2><table><thead><tr><th>分类</th><th>状态与范围</th></tr></thead><tbody>' +
    '<tr><td>用户评估与发版批准</td><td>' + esc(decision.statement) + '<p>批准状态：' + badge(decision.status) + '；版本 ' + esc(decision.version) + '。</p></td></tr>' +
    '<tr><td>当前分组处置</td><td>' + esc(countText(groupCounts)) + '<p>当前24组状态与主报告使用同一份stage_status；P20用户处置与机器原始判定独立展示。</p></td></tr>' +
    '<tr><td>已完成范围</td><td>' + esc(countText(resultCounts)) + '。各条为完成范围的分组投影，共享范围不重复计产品测试项。<details><summary>各组完成结果的当前处置</summary>' + resultSummary + '</details></td></tr>' +
    '<tr><td>固定余项</td><td>' + esc(remainingGroups.length) + '组保留remaining／inconclusive边界，详见下表。原始FAIL、历史结果及缺测范围按各自来源保留；当前DEFERRED和user_pass按用户处置展示。</td></tr>' +
    '<tr><td>完整主门与最终回归</td><td>完整主门完成0；最终回归NOT_RUN。原冻结技术字段继续保留，用户批准发版' + esc(decision.version) + '见上方决定与来源。</td></tr>' +
    '<tr><td>源码与原阶段记录</td><td>冻结源码改动清单与原始证据继续追溯：' + sourceTitle + '。当前正文按主报告最新完成范围更新，原冻结数据、日期和判据不改写。</td></tr>' +
    '</tbody></table></section>' +
    '<section><h2>固定余项与停止条件</h2><p>以下按唯一计划中每组当前remaining／inconclusive生成，均不在本次报告更新中执行；用户已评估当前剩余待测试项，并批准发版' + esc(decision.version) + '。</p><table><thead><tr><th>计划</th><th>固定余项</th><th>状态</th><th>未执行原因</th><th>停止条件</th></tr></thead><tbody>' + remainingRows + '</tbody></table><p>阶段保持停止，不启动重测、长稳或最终回归；后续执行按新的明确范围定界。</p></section>' +
    '<section><h2>24组冻结状态</h2><p>保留原24组与表格栏目，状态及范围更新为主报告当前投影；原始完成结果的日期、判定和来源见各组展开项。</p><table><thead><tr><th>编号</th><th>原主题</th><th>状态</th><th>已完成范围</th><th>未闭合范围</th></tr></thead><tbody>' + groupRows + '</tbody></table></section>' +
    '<section><h2>资源与证据</h2><p>当前范围来自<a href="../../index.html">主报告</a>与<a href="../../data/test-plan.json">唯一计划</a>；各子门继续绑定自身工件、负载、日期、状态和证据，不拼接完整主门。冻结阶段数据与源码清单保留原记录。</p><p>用户评估／发版批准：' + sourceLink(decision.source) + '；本报告状态：' + sourceLink(jsonPath) + '。批准版本' + esc(decision.version) + '，报告记录批准决定；实际发布执行记录另行留存。</p></section>' +
    '<footer>报告保留已完成范围、当前剩余处置、原始技术结果与用户发版批准；本次未新增产品执行。</footer></main></body></html>\n';
  const reference = {
    schema: previous.schema || 'cohavora-stage-closure-report-reference-v1',
    title, status: 'PARTIAL', task_status: 'STAGE_CLOSED_BY_USER', updated_utc: decision.date,
    current_revision_date: decision.date,
    frozen_at: previous.frozen_at, draft: false, final_snapshot: true, source_artifact_final_freeze: false,
    active_runs: [], stage_data: previous.stage_data || '../../data/stage-closure-20261022.json',
    summary: {
      statement: decision.statement, full_plan_gates_completed: 0, final_regression_status: 'NOT_RUN',
      production_ready: false, completion_percentage: null
    },
    scope: 'Current main-report projection and explicit user release approval; no new test execution or original-result rejudgment.',
    release_approval: approval,
    current_group_status_counts: groupCounts,
    current_groups: groups.map(group => ({
      plan_code: group.plan_code, title: group.title, status: group.status,
      stage_status: structuredClone(group.stage_status), completed_results: structuredClone(group.completed_results || [])
    }))
  };
  const artifacts = [
    {relative: htmlPath, bytes: Buffer.from(html)},
    {relative: jsonPath, bytes: Buffer.from(JSON.stringify(reference, null, 2) + '\n')}
  ];
  for (const artifact of artifacts) {
    const absolute = path.join(root, artifact.relative);
    if (writeEvidence) await fs.writeFile(absolute, artifact.bytes);
    else assert.deepEqual(await fs.readFile(absolute), artifact.bytes, 'Stage report bytes differ from the current main report: ' + artifact.relative);
    const receipt = {
      original_path: artifact.relative, portable_path: artifact.relative,
      sha256: digest(artifact.bytes), bytes: artifact.bytes.length, status: 'COMPLETED_SCOPED_RESULT_SOURCE'
    };
    data.portableFiles ??= {};
    for (const name of [artifact.relative, absolute]) data.portableFiles[norm(name)] = receipt;
    data.stageRefresh.sources = [
      ...(data.stageRefresh.sources || []).filter(source => norm(source.path) !== norm(artifact.relative)),
      {path: artifact.relative, sha256: receipt.sha256, bytes: receipt.bytes, original_path: artifact.relative, status: receipt.status}
    ];
  }
  data.stageRefresh.current_group_status_counts = groupCounts;
  data.stageRefresh.report_updated_at = decision.date;
  data.stageRefresh.release_approval = approval;
  return data;
}
