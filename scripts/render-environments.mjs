const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const sources=p=>p.sources.map((s,i)=>'<li><a href="'+esc(s.path)+'">配置依据 '+(i+1)+'</a>：'+esc(s.basis)+'<br><small>samples/acceptance/'+esc(s.path)+'</small></li>').join('');

export function renderHighlightEnvironments(ids,profiles){
  const map=new Map(profiles.map(p=>[p.id,p]));
  return '<div class="test-environment"><h4>测试服务器与客户端配置</h4>'+ids.map(id=>{const p=map.get(id);if(!p)throw Error('Missing environment '+id);return '<div class="environment-case"><h5>'+esc(p.label)+'</h5><dl><dt>服务器</dt><dd>'+esc(p.server)+'</dd><dt>客户端</dt><dd>'+esc(p.client)+'</dd><dt>负载与拓扑</dt><dd>'+esc(p.load)+'</dd></dl><p class="note">'+esc(p.boundary)+'</p><details><summary>配置来源</summary><ul class="sources">'+sources(p)+'</ul></details></div>';}).join('')+'</div>';
}

export function renderEnvironmentOverview(profiles){
  return '<section id="test-environments"><h2>测试服务器与客户端配置总览</h2><p>配置绑定各自原测试范围和运行日期。带宽配置与出口门限、实测吞吐分别保留；缺少环境记录时标明未记录，不从当前主机或其他运行补写。全部云厂商名称使用“阿里云”“腾讯云”。</p><div class="table-wrap"><table class="environment-overview"><thead><tr><th>原测试范围</th><th>服务器</th><th>客户端</th><th>负载与适用边界</th></tr></thead><tbody>'+profiles.map(p=>'<tr id="'+esc(p.id)+'"><th scope="row">'+esc(p.label)+'</th><td>'+esc(p.server)+'</td><td>'+esc(p.client)+'</td><td>'+esc(p.load)+'<p class="note">'+esc(p.boundary)+'</p><details><summary>环境配置依据</summary><ul class="sources">'+sources(p)+'</ul></details></td></tr>').join('')+'</tbody></table></div><p class="note">未关联到上表环境的历史记录，服务器或客户端配置在现存最终结果中未完整记录；待重测／补测项目的实际配置应在下一次执行前冻结。</p></section>';
}
