"""Bounded, permission-aware graph expansion over the indexed corpus only."""
from collections import defaultdict
from app import custom_knowledge


def retrieve(store, payload, for_model=False):
    # Import locally to keep KnowledgeStore's public API independent of this module.
    from app.core import terms, normalized, unique
    issue = str(payload.get('issue',''))
    focus = payload.get('retrieval_focus','')
    if not isinstance(focus,str) or len(focus)>6000:
        raise ValueError('本轮检索重点格式不正确或过长。')
    requests = payload.get('retrieval_queries',[])
    if not isinstance(requests,list) or len(requests)>2:
        raise ValueError('每轮最多补查两项本地知识。')
    for row in requests:
        if (not isinstance(row,dict) or not isinstance(row.get('query'),str)
                or not 0<len(row['query'].strip())<=2000 or not isinstance(row.get('reason'),str)
                or not 0<len(row['reason'].strip())<=1000):
            raise ValueError('补查词或补查理由格式不正确。')
    stage=payload.get('stage','全部')
    custom=not for_model or payload.get('allow_custom') is True
    def allowed_article(aid):
        a=store.by_article.get(aid)
        return bool(a and (custom or a.get('origin')!='user')
                    and (stage=='全部' or a.get('stage') in (stage,'方法')))
    def allowed_node(node):
        if node.startswith('doc:'):
            return allowed_article(node[4:])
        n=store.by_node.get(node,{})
        return bool(n and (stage=='全部' or n.get('stage') in (stage,'方法')))

    primary=(focus.splitlines()[0] if focus else issue)
    secondary=issue+' '+str(payload.get('route',''))+' '+focus
    if not focus:
        secondary+=' '+str(payload.get('observations',''))[-2500:]
    books=store.match_playbooks(primary+' '+issue,stage)
    # A diagnostic playbook is a fallback, not a permanent ranking lock.
    preferred=unique(a for p in books for a in p.get('article_ids',[])) if not focus else []
    direct=store.search(primary,stage,12 if focus else 18,secondary_query=secondary,preferred_articles=preferred,include_custom=custom)
    trace=[{'kind':'search','query':primary[:2000],'reason':'根据本轮明确回答和仍有效的现场陈述检索',
            'article_ids':unique(c['article_id'] for c in direct),'edge_ids':[],'node_ids':[],'hop':0}]
    for c in direct:
        c.update(reason=trace[0]['reason'],retrieval_kind='search')
    supplemental=[]
    for request in requests:
        found=store.search(request['query'],stage,6,secondary_query=primary[:2000],include_custom=custom)
        for c in found:
            c.update(reason=request['reason'],retrieval_kind='supplement')
        supplemental.extend(found)
        trace.append({'kind':'supplement','query':request['query'],'reason':request['reason'],
                      'article_ids':unique(c['article_id'] for c in found),'edge_ids':[],'node_ids':[],'hop':0})

    universe=custom_knowledge.universe(store)
    nodes={n['id']:n for n in universe['nodes']}
    candidates=[e for e in universe['edges'] if e.get('kind') in ('mechanism','explicit')
                and allowed_node(e['source']) and allowed_node(e['target'])]
    adjacency=defaultdict(list)
    for edge in candidates:
        adjacency[edge['source']].append(edge)
        adjacency[edge['target']].append(edge)
    query=primary+' '+' '.join(r['query'] for r in requests)
    qt=set(terms(query))
    def score(edge):
        labels=nodes[edge['source']].get('label','')+' '+nodes[edge['target']].get('label','')
        content=' '.join([labels,edge.get('mechanism',''),' '.join(edge.get('conditions',[])),
                          ' '.join(edge.get('checks',[]))])
        return len(qt & set(terms(content)))
    top_articles=unique(c['article_id'] for c in supplemental+direct)[:5]
    exact=[n['id'] for n in store.nodes if allowed_node(n['id']) and any(
           len(label)>=2 and normalized(label) in normalized(query)
           for label in [n.get('label','')]+n.get('aliases',[]))]
    named=[s for s in ('基膜','涂覆','电芯') if s in query]
    if len(named)==1:
        exact.sort(key=lambda nid:store.by_node[nid].get('stage')!=named[0])
    seeds=unique(exact[:4]+[n['id'] for n in store.nodes if allowed_node(n['id'])
                  and set(n.get('article_ids',[])) & set(top_articles[:3])])[:7]
    # Author links are topic links, never promoted to causal edges.
    seeds+=['doc:'+aid for aid in top_articles if store.by_article[aid].get('links')]
    if not seeds:
        ranked=sorted(candidates,key=score,reverse=True)
        seeds=unique(e['source'] for e in ranked[:2] if score(e)>0)
    visited=set(seeds)
    edges=[]
    graph_chunks=[]
    gaps=[]
    selected=set()
    chunks_by_article=defaultdict(list)
    for chunk in store.chunks:
        chunks_by_article[chunk['article_id']].append(chunk)
    frontier=seeds
    for hop in (1,2):
        next_frontier=[]
        steps=[]
        for start in frontier:
            neighboring=[e for e in adjacency[start] if e['id'] not in selected]
            neighboring.sort(key=score,reverse=True)
            for e in neighboring[:2]:
                # Second-hop traversal must match the current investigation.
                if hop==2 and score(e)<min(2,max(1,len(qt))):
                    continue
                steps.append((score(e),start,e))
        steps.sort(key=lambda row:row[0],reverse=True)
        for _,start,edge in steps:
            if edge['id'] in selected or len(edges)>=(5 if hop==1 else 8):
                continue
            selected.add(edge['id'])
            target=edge['target'] if edge['source']==start else edge['source']
            edge=dict(edge,source_label=nodes[edge['source']]['label'],target_label=nodes[edge['target']]['label'],
                      retrieval_kind='graph',hop=hop,from_node_id=start)
            reason=f'沿“{nodes[start]["label"]}”的关联补查（第 {hop} 层）；关系成立仍需核对适用条件'
            if edge.get('kind')=='explicit':
                reason=f'沿作者指定的知识链接补查（第 {hop} 层）；主题关联不等于因果'
                edge['mechanism']=edge.get('relation','主题关联，不等同已验证因果')
            edge['reason']=reason
            aids=list(edge.get('article_ids',[]))
            aids+=nodes[target].get('article_ids',[])
            found_ids=[]
            for aid in unique(aids)[:4]:
                if not allowed_article(aid):
                    if aid not in store.by_article:
                        gaps.append('关联条目 '+aid+' 未入库，本轮未读取。')
                    continue
                rows=chunks_by_article[aid]
                ranked=sorted(rows,key=lambda c:len(qt & set(c['tf'])),reverse=True)
                for c in ranked[:1]:
                    item={k:c[k] for k in ('id','article_id','title','heading','text','stage')}
                    item.update(score=0,reason=reason,retrieval_kind='graph')
                    graph_chunks.append(item)
                    found_ids.append(aid)
            edges.append(edge)
            trace.append({'kind':'graph','query':primary[:2000],'reason':reason,
                'article_ids':unique(found_ids),'edge_ids':[edge['id']],
                'node_ids':[edge['source'],edge['target']],'hop':hop,'from_node_id':start})
            if target not in visited:
                visited.add(target)
                next_frontier.append(target)
        frontier=next_frontier
    # Deduplicate by section, not just by article. Supplementary and linked
    # material gets space before the long tail of the original symptom matches.
    ordered=(supplemental[:4]+direct[:6]+graph_chunks+supplemental[4:]+direct[6:]) if focus else direct+graph_chunks
    chunks=[]
    seen=set()
    counts=defaultdict(int)
    for c in ordered:
        if c['id'] not in seen and counts[c['article_id']]<2:
            chunks.append(c)
            seen.add(c['id'])
            counts[c['article_id']]+=1
        if len(chunks)>=24:
            break
    if not chunks:
        gaps.append('在当前工序和知识权限范围内未找到匹配片段，请补充现场描述或知识。')
    return chunks,edges,books,trace,unique(gaps)


def included_trace(trace, chunks, edges):
    """Drop budget-excluded material. Never label a merely found article as read."""
    aids={c['article_id'] for c in chunks}
    eids={e['id'] for e in edges}
    result=[]
    for t in trace:
        row=dict(t,article_ids=[i for i in t['article_ids'] if i in aids],
                 edge_ids=[i for i in t['edge_ids'] if i in eids])
        if row['kind']=='graph' and not row['edge_ids']:
            continue
        result.append(row)
    return result
