import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';

const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

/** Apply an explicit acceptance decision without modifying frozen runtime judgments. */
export async function refreshB14Disposition(root, data) {
  const source = 'data/b14-user-disposition-20261023.json';
  const bytes = await fs.readFile(path.join(root, source));
  const decision = JSON.parse(bytes.toString('utf8'));
  const historyBytes = await fs.readFile(path.join(root, decision.history_data));
  const history = JSON.parse(historyBytes.toString('utf8'));
  assert.equal(decision.schema, 'cohavora-b14-user-provisional-disposition-v1');
  assert.equal(decision.status, 'user_pass');
  assert.equal(decision.run_id, data.b14CycleSummary.run_id);
  assert.equal(data.b14CycleSummary.raw_verdict, 'FAIL');
  assert.equal(decision.frozen_private_growth_limit_mib, 64);
  assert.equal(decision.user_reference_limit_mib, 68);
  assert.equal(decision.preserved.new_threshold, 'NOT_FROZEN');
  assert.equal(history.runs.length, 5);
  assert.equal(new Set(history.runs.map(run => run.run_id)).size, 5);
  for (const run of history.runs) {
    assert.equal(run.cycle_count, 100);
    assert.equal(run.metrics.length, 20);
  }
  const card = data.highlights.find(row => row.id === 'highlight-b14');
  assert.ok(card);
  card.status = decision.status;
  card.summary = '最新完整100轮／8小时运行原机器判定FAIL（Private Bytes增长95.869140625 MiB）；按2026-10-23用户明确决定暂定PASS，未闭环风险和原始记录继续保留。';
  card.scope = '仅本次B14长稳验收的用户暂定处置；原64 MiB资源门、原始FAIL和根因UNKNOWN不变。不授予无例外Formal通过、完整发布验收或生产就绪。';
  card.failureAnalysis = {
    title: '历史8小时长稳测试',
    summary: '内存增长：10月10日122.500 MiB；10月11日100.412 MiB；10月19日58.903 MiB；10月20日52.881 MiB；10月23日95.869 MiB。五次均完整执行100轮。',
    explanation: '其中3次超过本次讨论的保守参考值68 MiB；按原冻结64 MiB门限统计也是3次。68 MiB尚未冻结为新门限，历史测量和原判定不改写。',
    conclusion: '现有证据不能确定为内存泄漏，也不能据此说明不存在内存泄漏。按用户决定暂定PASS；用户认为未闭环残余估算10～38 MiB规模较小，接受当前风险。',
    basis: '估算来源为本对话的历史诊断讨论；10月11日约100 MB增长中，曾估算约62～90 MB为系统及组件保留（堆提交页与碎片30～45 MB、WGC帧池16～20 MB、日志遥测10～15 MB及单例缓存）',
    details: '上述分项尚未形成同run、同窗口、互斥的量化归因；MB沿用原估算单位，不能直接抵扣MiB实测。10～38 MiB不是已证实的泄漏量或上限。后续继续定位残余，依据闭环证据确定合理新门限；未来重测前另行冻结。',
    receipt: source
  };
  card.user_disposition = structuredClone(decision);
  card.historyMetricsPath = decision.history_page;
  card.limitations = [...card.limitations.filter(text => !text.includes('无本run') && !text.includes('问题定位与修复仍active')), '本次暂定PASS属于用户风险接受；历史保留量和10～38 MiB残余仍为本对话估算，不是已证明的泄漏上限。'];
  card.sources = [...new Set([...card.sources, source, decision.history_data, decision.history_page])];
  data.b14UserDisposition = {source, sha256: hash(bytes), value: decision, history_source: decision.history_data, history_sha256: hash(historyBytes)};
  data.b14CycleSummary.user_disposition = {status: decision.status, date: decision.date, source, raw_verdict: 'FAIL', new_threshold: 'NOT_FROZEN'};
  data.b14CycleSummary.procedure_note = data.b14CycleSummary.procedure_note.replace('无用户例外', '原机器回执未应用例外；2026-10-23用户暂定PASS另列');
  data.b14CycleSummary.limitations = data.b14CycleSummary.limitations.map(text => text.replace('无本run例外', '原机器回执未应用例外；本次用户暂定PASS独立记录'));
  for (const [relative, content] of [[source, bytes], [decision.history_data, historyBytes], [decision.history_page, await fs.readFile(path.join(root, decision.history_page))]]) {
    const item = {original_path: relative, portable_path: relative, sha256: hash(content), bytes: content.length, status: 'DOCUMENT_DISPOSITION_OR_HISTORICAL_SUMMARY'};
    data.portableFiles[relative.toLowerCase()] = item;
  }
  return data;
}
