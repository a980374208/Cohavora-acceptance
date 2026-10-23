import fs from 'node:fs';
import assert from 'node:assert/strict';

const plan = JSON.parse(fs.readFileSync(new URL('../data/test-plan.json', import.meta.url), 'utf8'));
const unique = values => [...new Set(values)];

/** Build the displayed plan from the unchanged, evidence-bound input catalog. */
export function consolidateTests(input) {
  const data = structuredClone(input);
  data.timingMeasurements = structuredClone(plan.timing_measurements);
  const originals = data.retestRecords;
  const byId = new Map(originals.map(record => [record.id, record]));
  assert.equal(originals.length, 52, 'Expected the original 52-item acceptance baseline');
  assert.equal(byId.size, originals.length, 'Duplicate IDs in the acceptance baseline');
  assert.equal(plan.groups.length, 24);
  assert.equal(plan.groups.filter(group => group.plan_kind === 'product').length, 21);
  assert.equal(plan.groups.filter(group => group.plan_kind === 'auxiliary').length, 3);
  assert.equal(new Set(plan.groups.map(group => group.id)).size, plan.groups.length);

  const mapping = [];
  const consumed = new Set();
  const consume = originalId => {
    assert.ok(byId.has(originalId), 'Unknown original ID: ' + originalId);
    assert.ok(!consumed.has(originalId), 'Original ID mapped more than once: ' + originalId);
    consumed.add(originalId);
    return byId.get(originalId);
  };

  data.retestRecords = plan.groups.map((group, index) => {
    assert.equal(group.id, 'T' + String(index + 1).padStart(3, '0'));
    assert.ok(group.gates.length >= 3 && group.gates.every(gate => typeof gate === 'string' && gate.trim()), 'Expected explicit independently judged gates');
    assert.ok(group.originalIds.length > 0);
    assert.ok(['product', 'auxiliary'].includes(group.plan_kind));
    const planCode = group.plan_kind === 'product'
      ? 'P' + String(index + 1).padStart(2, '0')
      : 'A' + String(index - 20).padStart(2, '0');
    assert.equal(group.plan_code, planCode);
    const records = group.originalIds.map(consume);
    for (const originalId of group.originalIds) {
      mapping.push({
        original_id: originalId,
        destination_kind: group.plan_kind,
        destination_id: group.id,
        destination_code: planCode,
        destination_title: group.title,
        disposition: group.originalIds.length > 1 ? 'MERGED' : 'RETAINED_WITH_CONCISE_GATES',
        reason: group.description
      });
    }
    const referenceStatuses = unique(records.flatMap(record => record.reference_statuses || [record.status]));
    const environmentIds = unique(records.flatMap(record => record.environmentIds || []));
    const stage = structuredClone(group.stage_status);
    assert.ok(stage?.status && stage.as_of, 'Expected the frozen stage assessment for ' + planCode);
    assert.equal(stage.full_gate_credit, 0, 'Stage assessment must not grant full-group acceptance credit');
    return {
      id: group.id,
      plan_code: planCode,
      title: group.title,
      domain: group.domain,
      plan_kind: group.plan_kind,
      originalIds: [...group.originalIds],
      original_domains: unique(records.map(record => record.domain)),
      description: group.description,
      gates: [...group.gates],
      conditions: [...group.conditions],
      boundaries: [...group.boundaries],
      status: stage.status,
      stage_status: stage,
      full_gate_credit: stage.full_gate_credit,
      reference_statuses: referenceStatuses,
      date: stage.as_of,
      evidence_scope: group.plan_kind === 'product'
        ? (stage.stage_execution === 'COMPLETED_SCOPED_BATCH' ? 'PRODUCT_ACCEPTANCE_COMPLETED_SCOPE_ASSESSMENT' : 'PRODUCT_ACCEPTANCE_FROZEN_STAGE_ASSESSMENT')
        : 'AUXILIARY_FROZEN_STAGE_ASSESSMENT',
      coverage: records.map(record => '原 ' + record.id + ' · ' + record.title + '；完整case、原重测原因与历史依据见 data/report-input.json。'),
      metrics: [],
      sources: [plan.stage_freeze.stage_report_html, plan.stage_freeze.stage_report,
        ...[stage.disposition_report, stage.disposition_source].filter(Boolean)],
      source_checks: [],
      environmentIds,
      validity: (stage.stage_execution === 'DEFERRED_BY_USER_AFTER_CLOSURE' ? '当前处置按用户要求延期；原实测FAIL和冻结阶段留作历史。' : stage.stage_execution === 'COMPLETED_SCOPED_BATCH' ? '状态依据最新已完成同范围结果及剩余子门更新；原冻结阶段留作历史。' : '状态来自冻结阶段收口；') + '已完成范围、剩余子门、保留失败与未定结论分别保留，不授予整组通过。本次文档更新未新增测试执行，也未改变原结果或版本边界。',
      limitations: group.boundaries.join('；'),
      disposition: 'RETEST_REQUIRED',
      reason: group.description,
      retestScope: [...group.gates],
      curation: {
        disposition: 'RETEST_REQUIRED',
        reason: group.description + ' 原记录 ' + group.originalIds.join('、') + ' 的全文与历史依据保留于输入基准；是否执行按变更、等价证据和各子门条件确定。',
        retestScope: [...group.gates],
        retestGroup: group.title,
        inputChecks: []
      }
    };
  });

  const groupIds = new Set(plan.groups.map(group => group.id));
  for (const action of plan.non_test_actions) {
    consume(action.originalId);
    assert.ok(action.coveredBy.every(id => groupIds.has(id)), 'Unknown covering group');
    mapping.push({
      original_id: action.originalId,
      destination_kind: action.kind,
      destination_id: action.id,
      destination_title: action.title,
      disposition: 'REMOVED_AS_INDEPENDENT_TEST',
      reason: action.reason,
      covered_by: [...action.coveredBy],
      destination: action.destination,
      preserve: action.preserve
    });
  }
  assert.equal(consumed.size, originals.length, 'Every original item must have exactly one destination');
  assert.ok(originals.every(record => consumed.has(record.id)));
  mapping.sort((a, b) => a.original_id.localeCompare(b.original_id));

  data.consolidation = {
    schema: plan.schema,
    revised_at: plan.revised_at,
    source_plan: 'data/test-plan.json',
    source_baseline: 'data/report-input.json',
    scope: plan.scope,
    original_retest_count: originals.length,
    displayed_retest_count: data.retestRecords.length,
    product_count: 21,
    auxiliary_count: 3,
    merged_or_retained_original_count: 50,
    removed_independent_count: plan.non_test_actions.length,
    mapping,
    non_test_actions: structuredClone(plan.non_test_actions),
    policy: [...plan.policy],
    execution: plan.stage_freeze.status,
    stage_execution: 'STOPPED_AFTER_CLOSURE',
    new_test_execution: 'NOT_RUN',
    historical_results_changed: false,
    current_tool_results_changed: false,
    thresholds_changed: false
  };
  data.curationSummary = {
    ...data.curationSummary,
    original_retest_before_consolidation: originals.length,
    retest: data.retestRecords.length,
    product_retest: 21,
    auxiliary_retest: 3,
    removed_independent_retest: plan.non_test_actions.length
  };
  return data;
}
