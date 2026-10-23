const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const sources=p=>p.sources.map((s,i)=>'<li><a href="'+esc(s.path)+'">配置依据 '+(i+1)+'</a>：'+esc(s.basis)+'<br><small>samples/acceptance/'+esc(s.path)+'</small></li>').join('');

const ENV_META={
  'env-b14-formal-20261023':{order:10,theme:'B14 长稳',date:'2026-10-22 至 10-23',tag:'最新完成运行',cls:'good',note:'当前 B14 摘要卡、P20 及 H181 绑定环境'},
  'env-b14-retry07':{order:11,theme:'B14 长稳',date:'2026-10-19',tag:'历史同口径归档',cls:'warn',note:'早期 retry07 运行；同口径最新结果已更新至 env-b14-formal-20261023'},
  'env-tencent-external-pilot':{order:12,theme:'B14 长稳',date:'2026-10-08',tag:'历史保留（独立负载）',cls:'warn',note:'外部 100 周期 Pilot／UI-only 有限复核（H184），不替代 Formal'},
  'env-tencent-history':{order:13,theme:'B14 长稳',date:'2026-10-06 至 10-10',tag:'历史保留（独立负载）',cls:'warn',note:'历史 UIA／9000 秒／固定九宫格独立运行（H187/H188/H189），不同负载不互替'},
  'env-wgc-20261021':{order:20,theme:'屏幕共享',date:'2026-10-21',tag:'最新完成运行',cls:'good',note:'当前屏幕共享卡、P07 及 H151/H155 绑定的 100 轮生命周期与 1800 秒六资源环境'},
  'env-gdi-50-20261021':{order:21,theme:'屏幕共享',date:'2026-10-21',tag:'最新完成运行',cls:'good',note:'当前屏幕共享卡、P07 及 H150 绑定的 GDI 50 次热切环境'},
  'env-wgc-quality-2k-20261021':{order:22,theme:'屏幕共享',date:'2026-10-21',tag:'最新完成运行',cls:'good',note:'当前屏幕共享卡与 P07 绑定的 2560×1440 客观画质环境（独立于 2K 成本）'},
  'env-screen-share':{order:23,theme:'屏幕共享',date:'2026-09-29／10-02',tag:'历史保留（独立负载）',cls:'warn',note:'仍提供原 B07/B08 十五项整批与 2K 成本基线；与新客观画质／局部生命周期负载不同，不相互替代'},
  'env-wgc-local':{order:24,theme:'屏幕共享',date:'2026-10-03／10-10',tag:'历史保留（含独立ETW）',cls:'warn',note:'其中 100 轮生命周期已由 env-wgc-20261021 更新；24 轮提升令牌 ETW 专项（H154）仍独立保留'},
  'env-telemetry-pair-20261022':{order:30,theme:'遥测日志',date:'2026-10-22',tag:'最新完成运行',cls:'good',note:'当前 P13 与 B15 卡引用的每侧 60 秒三对正式配对重测（不替换 180 秒表）'},
  'env-telemetry-9000s-20261021':{order:31,theme:'遥测日志',date:'2026-10-20 至 10-21',tag:'最新完成运行',cls:'good',note:'当前 B15 卡、P13 及 H164 绑定的 9030 秒长资源门环境'},
  'env-b15':{order:32,theme:'遥测日志',date:'2026-10-01／10-02',tag:'历史保留（独立负载）',cls:'warn',note:'仍提供 B15 卡表内每侧 180 秒三对配对基线；与 60 秒窗口及长资源门负载不同，不相互替代'},
  'env-e2ee-abba-20261020':{order:40,theme:'E2EE',date:'2026-10-20',tag:'最新完成运行',cls:'good',note:'当前 E2EE 摘要卡、P06 及 H132 绑定的三 Native ABBA 与 600 秒观察环境'},
  'env-e2ee-performance':{order:41,theme:'E2EE',date:'2026-09-30／10-01',tag:'历史同口径归档',cls:'warn',note:'早期 build105 性能记录；同范围已由 env-e2ee-abba-20261020 更新'},
  'env-whiteboard-b12-20261021':{order:50,theme:'白板协同',date:'2026-10-21',tag:'最新完成运行',cls:'good',note:'当前白板卡、P11 及 H156 绑定的三进程八项实服协同环境'},
  'env-whiteboard-1800-20261021':{order:51,theme:'白板协同',date:'2026-10-21',tag:'最新完成运行',cls:'good',note:'当前白板卡与 P11 绑定的 8 进程／4 写者／1800 秒协同负载环境'},
  'env-whiteboard-m5':{order:52,theme:'白板协同',date:'2026-09-22',tag:'历史保留（独立负载）',cls:'warn',note:'仍提供白板卡 M5 合成 4K offscreen 工程指标；与实服 B12 负载不同，不相互替代'},
  'env-whiteboard-b12':{order:53,theme:'白板协同',date:'2026-10-02',tag:'历史同口径归档',cls:'warn',note:'早期 B12 三进程记录；同范围已由 env-whiteboard-b12-20261021 更新'},
  'env-local-tools':{order:60,theme:'工具门',date:'2026-10-12',tag:'基准日工具门',cls:'good',note:'附录 4 条 CURRENT_VALID 限定离线／静态工具门环境'},
  'env-b11-300s':{order:61,theme:'容量基线',date:'2026-09-29',tag:'历史保留（独立负载）',cls:'warn',note:'仍提供平均内存占用区会议稳态 300 样本及 H010 容量基线（20 Mbps 独立配置）'},
  'env-b11-lowcap':{order:62,theme:'容量基线',date:'2026-09-29',tag:'历史保留（独立负载）',cls:'warn',note:'3 Mbps 混合负载短前置失败记录（H011），与 20 Mbps 配置不互替'},
  'env-common-final-regression':{order:63,theme:'综合回归',date:'2026-10-02',tag:'历史保留（公共基线）',cls:'warn',note:'2026-10-02 综合自动化限定回归公共环境（H031 等历史保留条目绑定）'}
};

const renderMeta=id=>{
  const meta=ENV_META[id];
  if(!meta)return '';
  return '<br><span class="badge '+esc(meta.cls)+'">'+esc(meta.tag)+'</span><small class="stat-note">'+esc(meta.theme)+' · 运行日期：'+esc(meta.date)+' · '+esc(meta.note)+'</small>';
};

export function renderHighlightEnvironments(ids,profiles){
  const map=new Map(profiles.map(p=>[p.id,p]));
  return '<div class="test-environment"><h4>测试服务器与客户端配置</h4>'+ids.map(id=>{const p=map.get(id);if(!p)throw Error('Missing environment '+id);const meta=ENV_META[id];return '<div class="environment-case"><h5>'+esc(p.label)+(meta?' <span class="badge '+esc(meta.cls)+'">'+esc(meta.tag)+' · '+esc(meta.date)+'</span>':'')+'</h5><dl><dt>服务器</dt><dd>'+esc(p.server)+'</dd><dt>客户端</dt><dd>'+esc(p.client)+'</dd><dt>负载与拓扑</dt><dd>'+esc(p.load)+'</dd></dl><p class="note">'+esc(p.boundary)+'</p><details><summary>配置来源</summary><ul class="sources">'+sources(p)+'</ul></details></div>';}).join('')+'</div>';
}

export function renderEnvironmentOverview(profiles){
  const sorted=[...profiles].sort((a,b)=>(ENV_META[a.id]?.order??999)-(ENV_META[b.id]?.order??999));
  const rows=sorted.map(p=>'<tr id="'+esc(p.id)+'"><th scope="row">'+esc(p.label)+renderMeta(p.id)+'</th><td>'+esc(p.server)+'</td><td>'+esc(p.client)+'</td><td>'+esc(p.load)+'<p class="note">'+esc(p.boundary)+'</p><ul class="sources">'+sources(p)+'</ul></td></tr>').join('');
  const table='<details class="appendix environment-profiles" id="environment-profiles"><summary>查看全部测试环境配置（'+profiles.length+'项）</summary><div class="table-wrap"><table class="environment-overview"><thead><tr><th>原测试范围</th><th>服务器</th><th>客户端</th><th>负载与适用边界</th></tr></thead><tbody>'+rows+'</tbody></table></div></details>';
  return '<section id="test-environments"><h2>测试服务器与客户端配置总览</h2><p>配置绑定各自原测试范围和运行日期；按测试主题分组并优先列出最新完成运行，不同负载的历史保留环境与已被同口径替代的历史归档分别标识，不直接认定相互替代。带宽配置与出口门限、实测吞吐分别保留；缺少环境记录时标明未记录，不从当前主机或其他运行补写。全部云厂商名称使用“阿里云”“腾讯云”。</p>'+table+'<p class="note">未关联到上述环境的历史记录，服务器或客户端配置在现存最终结果中未完整记录；待重测／补测项目的实际配置应在下一次执行前冻结。</p></section>';
}
