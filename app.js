const sampleText = `Cuando llegué a la casa de mi abuela, la puerta estaba entreabierta. Entré despacio y dejé la mochila junto al perchero. Desde la cocina llegaba un olor delicioso a canela y pan recién horneado.\n\n—¿Eres tú, cariño? —preguntó ella sin levantar la vista de la masa.\n\nMe senté a su lado y le conté todo lo que había pasado durante el viaje. Afuera, la tarde se desvanecía lentamente, pero dentro de la casa el tiempo parecía haberse detenido.`;
const initial = { passages:[{id:'p1',title:'La casa de la abuela',text:sampleText,highlights:[]}], active:'p1', queue:[], round:1 };
let state = JSON.parse(localStorage.getItem('lumbre-state') || 'null') || initial;
let pendingText = '';
const $ = id => document.getElementById(id);
function save(){localStorage.setItem('lumbre-state',JSON.stringify(state))}
function activePassage(){return state.passages.find(p=>p.id===state.active)||state.passages[0]}
function escapeHtml(s){return s.replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}
function render(){
 const p=activePassage(); if(!p)return;
 $('passageTitle').textContent=p.title; $('reviewEyebrow').textContent=p.title.toUpperCase();
 $('wordCount').textContent=`${p.text.trim().split(/\s+/).length} words`;
 $('passageList').innerHTML=state.passages.map(x=>`<div class="passage-item ${x.id===p.id?'active':''}" data-passage="${x.id}"><strong>${escapeHtml(x.title)}</strong><span>${x.highlights.length} saved · ${x.text.trim().split(/\s+/).length} words</span></div>`).join('');
 const activeHighlights=p.highlights.filter(h=>!h.learned).sort((a,b)=>a.start-b.start); let out='', cursor=0;
 activeHighlights.forEach(h=>{out+=escapeHtml(p.text.slice(cursor,h.start));out+=`<mark data-id="${h.id}" title="Click to see translation">${escapeHtml(p.text.slice(h.start,h.end))}</mark>`;cursor=h.end}); out+=escapeHtml(p.text.slice(cursor));
 $('readingText').innerHTML=out.replace(/\n\n/g,'</p><p>').replace(/^/,'<p>').replace(/$/,'</p>');
 $('highlightCount').textContent=`${activeHighlights.length} saved`;
 $('navCount').textContent=state.passages.reduce((n,x)=>n+x.highlights.filter(h=>!h.learned).length,0);
 renderReview(); save();
}
function renderReview(){
 const p=activePassage(); const available=p.highlights.filter(h=>!h.learned); state.queue=state.queue.filter(id=>available.some(h=>h.id===id)); if(!state.queue.length && available.length) state.queue=available.map(h=>h.id);
 const current=available.find(h=>h.id===state.queue[0]); const card=$('flashcard'); $('queueLabel').textContent=`${state.queue.length} remaining`;
 $('roundLabel').textContent=`ROUND ${state.round||1}`; $('roundProgress').style.width=available.length?`${Math.max(5,((available.length-state.queue.length)/available.length)*100)}%`:'0%';
 const learned=p.highlights.filter(h=>h.learned).length; $('learnedFraction').textContent=`${learned} / ${p.highlights.length} learned`; $('learnedProgress').style.width=p.highlights.length?`${learned/p.highlights.length*100}%`:'0%';
 $('reviewStatus').textContent=p.highlights.length?(available.length?`${available.length} words still in progress`:'Everything is learned — lovely work!'):'Add highlights to start reviewing';
 if(current){card.className='flashcard';card.innerHTML=`<div class="card-content"><p class="card-label">WHAT DOES THIS MEAN?</p><h2 class="card-word">${escapeHtml(current.phrase)}</h2><div class="card-reveal"><b>Answer</b>${escapeHtml(current.translation||current.explanation||'No answer added')}</div><p class="card-label" style="margin-top:22px">${current.correct||0} of 5 correct</p></div>`; $('answerActions').style.display='grid'} else {card.className='flashcard empty';card.innerHTML=`<div class="empty-state"><div class="empty-icon">✦</div><h2>${p.highlights.length?'Your review is clear.':'Nothing saved yet.'}</h2><p>${p.highlights.length?'You made it through every word in this passage.':'Highlight a word while reading and it will appear here.'}</p><button class="primary-button" data-view="reader">${p.highlights.length?'Keep reading':'Go to reader'}</button></div>`;$('answerActions').style.display='none'}
}
function openModal(text){pendingText=text.trim();$('selectedExpression').textContent=pendingText;$('translationInput').value='';$('explanationInput').value='';$('highlightModal').classList.add('open');setTimeout(()=>$('translationInput').focus(),50)}
function closeModal(){$('highlightModal').classList.remove('open')}
function showToast(msg){$('toast').textContent=msg;$('toast').classList.add('show');setTimeout(()=>$('toast').classList.remove('show'),2200)}
function switchView(view){document.querySelectorAll('.view').forEach(x=>x.classList.toggle('active',x.id===view+'View'));document.querySelectorAll('.nav-link').forEach(x=>x.classList.toggle('active',x.dataset.view===view));if(view==='review')renderReview()}

document.addEventListener('click',e=>{
 const nav=e.target.closest('[data-view]');if(nav){switchView(nav.dataset.view);return}
 const pi=e.target.closest('[data-passage]');if(pi){state.active=pi.dataset.passage;state.queue=[];state.round=1;render();return}
 const mark=e.target.closest('mark');if(mark){const h=activePassage().highlights.find(x=>x.id===mark.dataset.id);if(h){openModal(h.phrase);pendingText=h.phrase; $('translationInput').value=h.translation||'';$('explanationInput').value=h.explanation||''; $('saveHighlight').dataset.edit=h.id}return}
});
$('readingText').addEventListener('mouseup',()=>{const sel=window.getSelection();const text=sel.toString().trim();if(text && $('readingText').contains(sel.anchorNode)){pendingText=text;$('selectionHint').innerHTML=`<span>✦</span> Save “${escapeHtml(text.length>34?text.slice(0,34)+'…':text)}” for review`;$('selectionHint').style.cursor='pointer'}});
$('selectionHint').addEventListener('click',()=>{if(pendingText)openModal(pendingText)});
$('saveHighlight').addEventListener('click',()=>{const p=activePassage(),translation=$('translationInput').value.trim(),explanation=$('explanationInput').value.trim(),editId=$('saveHighlight').dataset.edit;if(!translation&&!explanation){showToast('Add a translation or explanation first');return} if(editId){const h=p.highlights.find(x=>x.id===editId);if(h){h.translation=translation;h.explanation=explanation}delete $('saveHighlight').dataset.edit}else{const start=p.text.indexOf(pendingText);if(start<0){showToast('That selection could not be found');return} if(p.highlights.some(h=>h.start===start)){showToast('That expression is already saved');return}p.highlights.push({id:'h'+Date.now(),phrase:pendingText,start,end:start+pendingText.length,translation,explanation,correct:0,learned:false})}closeModal();pendingText='';$('selectionHint').innerHTML='<span>↗</span> Select any word or expression to save it';$('selectionHint').style.cursor='default';render();showToast('Saved to your flashcards')});
['closeModal','cancelModal'].forEach(id=>$(id).addEventListener('click',closeModal));$('highlightModal').addEventListener('click',e=>{if(e.target.id==='highlightModal')closeModal()});
$('wrongBtn').addEventListener('click',()=>answer(false));$('rightBtn').addEventListener('click',()=>answer(true));
function answer(correct){const p=activePassage(),id=state.queue.shift(),h=p.highlights.find(x=>x.id===id);if(!h)return;if(correct)h.correct=(h.correct||0)+1;if(h.correct>=5)h.learned=true;else state.queue.push(id);if(!state.queue.length&&p.highlights.some(x=>!x.learned)){state.round=(state.round||1)+1;state.queue=p.highlights.filter(x=>!x.learned).map(x=>x.id)}render();showToast(h.learned?'Learned — removed from your passage!':correct?'Nice. Five correct answers will lock it in.':'No problem. It will return after this round.')}
$('clearHighlights').addEventListener('click',()=>{const p=activePassage();if(p.highlights.length&&confirm('Remove all saved words from this passage?')){p.highlights=[];state.queue=[];render()}});
function newPassage(){const title=prompt('Name your passage:','A new Spanish passage');if(!title)return;const text=prompt('Paste your Spanish text here:');if(!text)return;const id='p'+Date.now();state.passages.push({id,title,text,highlights:[]});state.active=id;state.queue=[];state.round=1;render()}
$('newPassageBtn').addEventListener('click',newPassage);$('newPassageBtnSmall').addEventListener('click',newPassage);render();
