// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// 자산관리셸(AAS) 데이터셋 탐색기: 셸 → 서브모델 → 요소 나무, 고른 항목의 뜻(semanticId) · 온톨로지 대응 · 원본 JSON (⚠ 가상 데이터)
// 데이터: assets/data/aas.json (examples/aas/build_aas.py)
import { $, esc, T } from './lib/dom.js?v=3b73d59c';
import { renderCq } from './cypher/cq-view.js?v=61f7818e';
(function () {
  const PAM = 'https://1004aiteam-power.github.io/ontology-space/asset#', CIM = 'http://iec.ch/TC57/CIM100#', GRID = 'http://example.org/grid#';
  const KIND = { AssetAdministrationShell: 'AAS', AssetInformation: 'Asset', Submodel: 'SM', Property: 'Prop', MultiLanguageProperty: 'MLP', ReferenceElement: 'Ref',
    SubmodelElementCollection: 'SMC', SubmodelElementList: 'SML', Entity: 'Ent', ConceptDescription: 'CD' };
  // 뜻이 어디에 있나: 온톨로지 · CIM · 표준 사전/템플릿 · 이 예제가 정한 것
  const SRC = {
    pam: { cls: 'on', ko: '자산관리 온톨로지', en: 'Asset-management ontology' },
    grid: { cls: 'on', ko: '예제 변전소 (CIM 개체)', en: 'Sample substation (CIM individual)' },
    cim: { cls: 'cim', ko: 'IEC CIM', en: 'IEC CIM' },
    cdd: { cls: 'std', ko: 'IEC CDD (IDTA 명판 템플릿)', en: 'IEC CDD (IDTA nameplate template)' },
    idta: { cls: 'std', ko: 'IDTA 사양 · 템플릿', en: 'IDTA specification / template' },
    own: { cls: 'own', ko: '이 예제가 정한 식별자', en: 'Identifier defined by this example' }
  };
  let D, nodes = [], sel = 0;

  const short = (iri) => iri.startsWith(PAM) ? 'pam:' + iri.slice(PAM.length) : iri.startsWith(CIM) ? 'cim:' + iri.slice(CIM.length) : iri.startsWith(GRID) ? 'ex:' + iri.slice(GRID.length) : iri;
  const refValue = (r) => (r && r.keys && r.keys[0] ? r.keys[0].value : null);
  const langText = (v) => (Array.isArray(v) && v[0] && v[0].text != null ? v[0].text : null);
  const children = (e) => e.submodelElements || e.statements || (Array.isArray(e.value) && e.value[0] && e.value[0].modelType ? e.value : null) || [];

  // 나무에 보일 한 줄 값
  function preview(e) {
    switch (e.modelType) {
      case 'Property': return e.value;
      case 'MultiLanguageProperty': return langText(e.value);
      case 'ReferenceElement': return '→ ' + short(refValue(e.value));
      case 'SubmodelElementList': return `[${e.value.length}]`;
      case 'AssetAdministrationShell': case 'Submodel': case 'Entity': case 'ConceptDescription': return langText(e.displayName) || '';
      default: return '';
    }
  }

  // 환경(JSON)을 나무 노드의 평평한 목록으로: { el, name, path, depth, owner }
  function flatten() {
    nodes = [];
    const add = (el, name, path, depth, extra) => { nodes.push(Object.assign({ el, name, path, depth }, extra)); return nodes.length - 1; };
    const walk = (parent, path, depth, sm, inList) => children(parent).forEach((c, i) => {
      const name = inList ? `[${i}]` : c.idShort, p = inList ? path + name : path ? path + '.' + name : name;
      add(c, name, p, depth, { sm });
      walk(c, p, depth + 1, sm, c.modelType === 'SubmodelElementList');
    });
    for (const sh of D.env.assetAdministrationShells) {
      add(sh, sh.idShort, '', 0, {});
      add(Object.assign({ modelType: 'AssetInformation' }, sh.assetInformation), 'assetInformation', '', 1, {});
      for (const ref of sh.submodels) {
        const sm = D.env.submodels.find(s => s.id === refValue(ref));
        add(sm, sm.idShort, '', 1, { sm: sm.idShort });
        walk(sm, '', 2, sm.idShort, false);
      }
    }
    D.env.conceptDescriptions.forEach(cd => add(cd, cd.idShort, '', 0, { group: 'cd' }));
  }

  const semOf = (el) => refValue(el.semanticId) || (el.isCaseOf && refValue(el.isCaseOf[0])) || null;
  const srcOf = (iri) => (iri && D.terms[iri] ? SRC[D.terms[iri].source] : null);
  const dot = (el) => { const s = srcOf(semOf(el)); return `<i class="dot ${s ? s.cls : ''}"></i>`; };

  function renderTree() {
    let html = '', depth = -1, cdHead = false;
    nodes.forEach((n, i) => {
      if (n.group === 'cd' && !cdHead) {
        while (depth-- > -1) html += '</li></ul>';
        html += `<p class="sub" style="margin:10px 6px 2px">${T('개념 설명 (ConceptDescription)', 'Concept descriptions')}</p>`;
        depth = -1; cdHead = true;
      }
      if (n.depth > depth) html += '<ul>'; else { html += '</li>'; for (let d = depth; d > n.depth; d--) html += '</ul></li>'; }
      depth = n.depth;
      const v = preview(n.el);
      html += `<li><button type="button" data-i="${i}"${i === sel ? ' aria-current="true"' : ''}>${dot(n.el)}<span class="k">${KIND[n.el.modelType] || ''}</span><span class="n">${esc(n.name)}</span>${v ? `<span class="v">${esc(v)}</span>` : ''}</button>`;
    });
    while (depth-- > -1) html += '</li></ul>';
    $('aasTree').innerHTML = html;
  }

  // 이 항목이 온톨로지에서는 어떤 한 줄인가 (값이 온톨로지 속성에 대응할 때만)
  function ontologyLine(n) {
    const el = n.el, sem = semOf(el), asset = 'pam:' + D.asset.replace(/-/g, '_');
    if (el.modelType === 'AssetAdministrationShell') return `${asset} a ${short(el.assetInformation.assetType)} .`;
    if (el.modelType === 'AssetInformation') return `${asset} pam:eamNumber "${el.specificAssetIds[0].value}" .`;
    if (!sem || !sem.startsWith(PAM) || /[\[.]/.test(n.path)) return null;       // 목록 · 묶음 안의 항목은 주어가 자산이 아님
    const p = short(sem);
    if (el.modelType === 'ReferenceElement') return `${asset} ${p} ${short(refValue(el.value))} .`;
    if (el.modelType === 'Entity') return `${asset} pam:hasComponent pam:${el.idShort} .`;
    if (el.modelType !== 'Property') return null;
    const num = el.valueType === 'xs:decimal' || el.valueType === 'xs:integer';
    return `${asset} ${p} ${num ? el.value : `"${el.value}"`} .`;
  }

  function note(n) {
    const el = n.el;
    switch (el.modelType) {
      case 'AssetAdministrationShell': return T('셸 자체에는 값이 없습니다. 자산이 무엇인지(assetInformation)와 서브모델 목록만 가집니다. 서브모델은 문자열 id로 가리킵니다.', 'The shell itself carries no values: only what the asset is (assetInformation) and a list of submodels, pointed at by string id.');
      case 'AssetInformation': return T('globalAssetId가 온톨로지의 자산 개체 IRI와 같습니다. 셸과 온톨로지가 같은 변압기를 말한다는 고리입니다.', 'globalAssetId equals the IRI of the asset individual in the ontology — the hook showing both describe the same transformer.');
      case 'Submodel': return el.idShort === 'Nameplate'
        ? T('IDTA 02006 디지털 명판 템플릿의 식별자를 그대로 썼습니다. 다른 회사의 AAS 도구도 뜻을 압니다.', 'Uses the identifiers of the IDTA 02006 Digital Nameplate template unchanged, so other vendors\' AAS tools know the meaning.')
        : T('IDTA 템플릿이 아니라 이 예제가 정한 서브모델입니다. 대신 안의 항목마다 온톨로지 용어를 뜻으로 달았습니다.', 'Not an IDTA template but a submodel defined by this example; each item inside carries an ontology term as its meaning.');
      case 'SubmodelElementList': return T('순서 있는 목록입니다. 항목에는 idShort가 없어 [0], [1] … 위치로 가리킵니다.', 'An ordered list. Items have no idShort and are addressed by position: [0], [1] …');
      case 'SubmodelElementCollection': return T('진단 기록 한 건을 묶은 것. 온톨로지에서는 pam:Diagnosis 개체 하나이고, Record가 그 개체를 가리킵니다.', 'One diagnosis record. In the ontology this is one pam:Diagnosis individual; Record points at it.');
      case 'ReferenceElement': return T('값이 문자열 참조입니다. 다리 파일(aas-links.ttl)이 이것을 온톨로지 개체로 가는 실제 연결로 바꿉니다.', 'The value is a string reference. The bridge file (aas-links.ttl) turns it into a real link to the ontology individual.');
      case 'Entity': return T('구성품 하나. 자체 셸이 없는 부품이라 CoManagedEntity로 적었습니다.', 'One component. It has no shell of its own, so it is a CoManagedEntity.');
      case 'ConceptDescription': return T('뜻 풀이를 셸에 함께 실은 것. isCaseOf가 온톨로지 · CIM의 용어를 가리킵니다.', 'A definition shipped with the shell. isCaseOf points at the ontology or CIM term.');
      case 'Property': if (el.valueId) return T('값은 글자이고, valueId가 그 값에 해당하는 온톨로지 개체를 가리킵니다.', 'The value is text; valueId points at the ontology individual that the value stands for.');
        return el.valueType === 'xs:string' ? '' : T('AAS에서는 숫자도 문자열로 적고 valueType으로 자료형을 알려 줍니다.', 'In the AAS even numbers are written as strings; valueType tells the data type.');
      default: return '';
    }
  }

  // 상세 JSON: 자식이 많은 것은 자식을 줄여서
  function snippet(el) {
    const cut = (k, v) => (Array.isArray(v) && v.length && v[0] && v[0].modelType && (k === 'submodelElements' || k === 'statements' || k === 'value') ? `… ${v.length} ${v[0].modelType}${v.length > 1 ? ' …' : ''}` : v);
    const o = Object.assign({}, el);
    if (el.modelType === 'AssetInformation') delete o.modelType;
    return JSON.stringify(o, cut, 2);
  }

  function renderDetail() {
    const n = nodes[sel], el = n.el, sem = semOf(el), src = srcOf(sem), term = sem ? D.terms[sem] : null;
    const rows = [[T('종류', 'Kind'), `<code>${esc(el.modelType)}</code>`]];
    const title = langText(el.displayName);
    if (title) rows.push([T('이름', 'Name'), esc(title)]);
    const v = el.modelType === 'Property' ? `${esc(el.value)} <small class="muted">(${esc(el.valueType)})</small>` : el.modelType === 'MultiLanguageProperty' ? esc(langText(el.value)) : el.modelType === 'ReferenceElement' ? `→ <code>${esc(short(refValue(el.value)))}</code>` : null;
    if (v) rows.push([T('값', 'Value'), v]);
    if (el.valueId) rows.push(['valueId', `<code>${esc(short(refValue(el.valueId)))}</code>`]);
    if (el.id) rows.push(['id', `<code>${esc(el.id)}</code>`]);
    if (el.globalAssetId) rows.push(['globalAssetId', `<code>${esc(short(el.globalAssetId))}</code>`]);
    if (sem) rows.push([el.isCaseOf ? 'isCaseOf' : 'semanticId', `<code>${esc(short(sem))}</code>${term && term.label ? ` <span class="muted">“${esc(term.label)}”</span>` : ''}`]);
    if (src) rows.push([T('뜻의 출처', 'Meaning from'), `<span class="tag ${src.cls}">${esc(T(src.ko, src.en))}</span>`]);
    const line = ontologyLine(n), why = note(n);
    $('aasDetail').innerHTML = `<h3>${esc(n.name)}</h3>
      <p class="path">${esc(n.sm ? n.sm + (n.path ? ' / ' + n.path : '') : el.modelType)}</p>
      <dl>${rows.map(([k, x]) => `<dt>${k}</dt><dd>${x}</dd>`).join('')}</dl>
      ${why ? `<p class="why">${esc(why)}</p>` : ''}
      ${line ? `<h4>${T('온톨로지에서는 (같은 사실 한 줄)', 'In the ontology (the same fact in one line)')}</h4><pre><code class="language-turtle">${esc(line)}</code></pre>` : ''}
      <h4>${T('AAS JSON', 'AAS JSON')}</h4><pre><code class="language-json">${esc(snippet(el))}</code></pre>`;
    if (window.hljs) $('aasDetail').querySelectorAll('pre code').forEach(c => hljs.highlightElement(c));
  }

  function renderStats() {
    const s = D.stats, items = [
      [T('셸 · 서브모델', 'Shell · submodels'), `1 · ${s.submodels}`],
      [T('서브모델 요소', 'Submodel elements'), s.elements],
      [T('개념 설명', 'Concept descriptions'), s.concepts],
      [T('AAS RDF 트리플', 'AAS RDF triples'), s.triples.toLocaleString()],
      [T('다리 (실제 연결)', 'Bridge links'), s.linkTriples],
      [T('합친 그래프 노드 · 관계', 'Merged graph nodes · rels'), `${s.nodes} · ${s.rels}`]
    ];
    $('aasStats').innerHTML = items.map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('');
    $('aasLegend').innerHTML = `<span>${T('뜻(semanticId)이 가리키는 곳:', 'Where the meaning (semanticId) points:')}</span>` +
      [['#12805c', T('이 사이트 온톨로지', "this site's ontology")], ['#1f6feb', 'IEC CIM'], ['#b45309', T('표준 사전 · IDTA 템플릿', 'standard dictionary / IDTA template')], ['var(--line)', T('이 예제가 정함 · 없음', 'defined here / none')]]
        .map(([c, l]) => `<span><i style="background:${c}"></i>${l}</span>`).join('');
  }

  function showCq() { renderCq($('aasCq'), D.cq, { open: 2, empty: T('(결과 없음: 어긋난 값이 없습니다)', '(no rows: nothing has drifted)') }); }

  function renderAll() { renderStats(); renderTree(); renderDetail(); showCq(); }

  async function main() {
    if (!$('aasTree')) return;
    try { D = await (await fetch('assets/data/aas.json')).json(); } catch (e) { $('aasTree').textContent = 'aas.json?'; return; }
    flatten();
    sel = Math.max(0, nodes.findIndex(n => n.name === 'HealthIndex'));
    $('aasTree').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-i]');
      if (!b) return;
      sel = +b.dataset.i;
      $('aasTree').querySelectorAll('button[aria-current]').forEach(x => x.removeAttribute('aria-current'));
      b.setAttribute('aria-current', 'true');
      renderDetail();
    });
    document.addEventListener('langchange', renderAll);
    renderAll();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', main); else main();
})();
