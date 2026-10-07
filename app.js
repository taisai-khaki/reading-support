const sampleText = `Cuando llegué a la casa de mi abuela, la puerta estaba entreabierta. Entré despacio y dejé la mochila junto al perchero. Desde la cocina llegaba un olor delicioso a canela y pan recién horneado.\n\n—¿Eres tú, cariño? —preguntó ella sin levantar la vista de la masa.\n\nMe senté a su lado y le conté todo lo que había pasado durante el viaje. Afuera, la tarde se desvanecía lentamente, pero dentro de la casa el tiempo parecía haberse detenido.`;
const initial = { passages:[{id:'p1',title:'La casa de la abuela',text:sampleText,highlights:[]}], active:'p1', queue:[], repeatQueue:[], round:1 };
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
const CARD_DIRECTIONS = ['es-en', 'en-es'];
const CORRECT_ANSWERS_TO_LEARN = 5;
let revealedCardId = '';

function correctCount(h, direction){
 const value=h.cards?.[direction] ?? (direction==='es-en' ? h.correct : 0);
 return Math.max(0, Number(value) || 0);
}
function makeQueue(available){
 // Put each direction across all words before returning to the other direction.
 return CARD_DIRECTIONS.flatMap(direction=>available
  .filter(h=>correctCount(h,direction)<CORRECT_ANSWERS_TO_LEARN)
  .map(h=>`${h.id}-${direction}`));
}
function findCard(id){
 if(typeof id!=='string')return null;
 const h=activePassage().highlights.find(x=>id.startsWith(x.id+'-'));
 return h?{h,direction:id.endsWith('en-es')?'en-es':'es-en'}:null;
}
function syncQueue(){
 const p=activePassage();
 p.highlights.forEach(h=>{
  if(CARD_DIRECTIONS.every(direction=>correctCount(h,direction)>=CORRECT_ANSWERS_TO_LEARN))h.learned=true;
 });
 const available=p.highlights.filter(h=>!h.learned);
 const valid=makeQueue(available), validIds=new Set(valid), queued=new Set();
 const currentQueue=Array.isArray(state.queue)?state.queue:[];
 const repeatQueue=Array.isArray(state.repeatQueue)?state.repeatQueue:[];
 state.queue=currentQueue.filter(id=>{
  if(!validIds.has(id)||queued.has(id))return false;
  queued.add(id);
  return true;
 });
 state.repeatQueue=repeatQueue.filter(id=>{
  if(!validIds.has(id)||queued.has(id))return false;
  queued.add(id);
  return true;
 });
 // Keep any new or previously missing cards in the current pass.
 state.queue.push(...valid.filter(id=>!queued.has(id)));
 if(!state.queue.length&&state.repeatQueue.length){
  state.queue=state.repeatQueue;
  state.repeatQueue=[];
  state.round=(state.round||1)+1;
 }
 return {available,valid};
}
function prioritizeNextWord(previousHighlightId){
 const isAnotherWord=id=>findCard(id)?.h.id!==previousHighlightId;
 let nextIndex=state.queue.findIndex(isAnotherWord);
 if(nextIndex>=0){
  if(nextIndex>0)state.queue.unshift(state.queue.splice(nextIndex,1)[0]);
  return;
 }
 if(state.repeatQueue.some(isAnotherWord)){
  // Start the next pass early rather than showing the same word back-to-back.
  state.queue=[...state.repeatQueue,...state.queue];
  state.repeatQueue=[];
  state.round=(state.round||1)+1;
  nextIndex=state.queue.findIndex(isAnotherWord);
  if(nextIndex>0)state.queue.unshift(state.queue.splice(nextIndex,1)[0]);
 }
}
function renderReview(){
 const p=activePassage(), {available,valid}=syncQueue();
 const current=findCard(state.queue[0]), card=$('flashcard');
 const translationIsRevealed=current&&revealedCardId===state.queue[0];
 $('queueLabel').textContent=`${state.queue.length} cards left this round`;
 $('roundLabel').textContent=`ROUND ${state.round||1}`;
 const cardsThisRound=state.queue.length+state.repeatQueue.length;
 $('roundProgress').style.width=cardsThisRound?`${state.repeatQueue.length/cardsThisRound*100}%`:'0%';
 const learned=p.highlights.filter(h=>h.learned).length;
 $('learnedFraction').textContent=`${learned} / ${p.highlights.length} learned`;
 $('learnedProgress').style.width=p.highlights.length?`${learned/p.highlights.length*100}%`:'0%';
 $('reviewStatus').textContent=p.highlights.length?(available.length?`${available.length} words · ${valid.length} card directions in progress`:'Everything is learned — lovely work!'):'Add highlights to start reviewing';
 if(current){
  const h=current.h;
  const front=current.direction==='es-en'?h.phrase:(h.translation||h.phrase);
  const answer=current.direction==='es-en'?(h.translation||''):h.phrase;
  const label=current.direction==='es-en'?'SPANISH → ENGLISH':'ENGLISH → SPANISH';
  const count=correctCount(h,current.direction);
  card.className='flashcard';
  card.innerHTML=`<div class="card-content"><p class="card-label">${label}</p><h2 class="card-word">${escapeHtml(front)}</h2><button class="reveal-button" type="button" data-action="toggle-translation" aria-controls="cardReveal" aria-expanded="${Boolean(translationIsRevealed)}">${translationIsRevealed?'Hide translation':'Show translation'}</button><div class="card-reveal" id="cardReveal"${translationIsRevealed?'':' hidden'}><b>Translation</b>${escapeHtml(answer)}${h.explanation?`<br><small>${escapeHtml(h.explanation)}</small>`:''}</div><p class="card-label" style="margin-top:22px">${count} of ${CORRECT_ANSWERS_TO_LEARN} correct · ${current.direction==='es-en'?'Card 1 of 2':'Card 2 of 2'}</p></div>`;
  $('answerActions').style.display='grid';
 } else {
  card.className='flashcard empty';
  card.innerHTML=`<div class="empty-state"><div class="empty-icon">✦</div><h2>${p.highlights.length?'Your review is clear.':'Nothing saved yet.'}</h2><p>${p.highlights.length?'You made it through every card in this passage.':'Highlight a word while reading and it will appear here.'}</p><button class="primary-button" data-view="reader">${p.highlights.length?'Keep reading':'Go to reader'}</button></div>`;
  $('answerActions').style.display='none';
 }
}
const miniDictionary={cuando:'when',llegué:'I arrived',casa:'house',abuela:'grandmother',puerta:'door',entreabierta:'ajar',entré:'I entered',despacio:'slowly',dejé:'I left',mochila:'backpack',junto:'next to',perchero:'coat rack',desde:'from',cocina:'kitchen',llegaba:'came',olor:'smell',delicioso:'delicious',canela:'cinnamon',pan:'bread',recién:'freshly',horneado:'baked',preguntó:'asked',sin:'without',levantar:'lifting',vista:'sight',masa:'dough',senté:'I sat',lado:'side',conté:'I told',todo:'everything',pasado:'happened',durante:'during',viaje:'trip',afuera:'outside',tarde:'afternoon',desvanecía:'faded',lentamente:'slowly',dentro:'inside',tiempo:'time',parecía:'seemed',haberse:'to have',detenido:'stopped',cariño:'darling'};
function offerTranslation(text){const exact={"la casa de mi abuela":'my grandmother’s house',"casa de la abuela":'grandmother’s house',"recién horneado":'freshly baked',"sin levantar la vista":'without looking up',"se desvanecía lentamente":'was slowly fading'};if(exact[text.toLowerCase()])return exact[text.toLowerCase()];return text.toLowerCase().split(/\s+/).map(w=>miniDictionary[w.replace(/[^a-záéíóúñü]/gi,'')]||w).join(' ')}
function openModal(text){pendingText=text.trim();$('selectedExpression').textContent=pendingText;$('translationSuggestion').textContent=offerTranslation(pendingText);$('explanationInput').value='';$('highlightModal').classList.add('open');setTimeout(()=>$('explanationInput').focus(),50)}
function closeModal(){$('highlightModal').classList.remove('open')}
function showToast(msg){$('toast').textContent=msg;$('toast').classList.add('show');setTimeout(()=>$('toast').classList.remove('show'),2200)}
function switchView(view){document.querySelectorAll('.view').forEach(x=>x.classList.toggle('active',x.id===view+'View'));document.querySelectorAll('.nav-link').forEach(x=>x.classList.toggle('active',x.dataset.view===view));if(view==='review')renderReview()}

document.addEventListener('click',e=>{
 const nav=e.target.closest('[data-view]');if(nav){switchView(nav.dataset.view);return}
 const pi=e.target.closest('[data-passage]');if(pi){state.active=pi.dataset.passage;state.queue=[];state.repeatQueue=[];state.round=1;revealedCardId='';render();return}
 const mark=e.target.closest('mark');if(mark){const h=activePassage().highlights.find(x=>x.id===mark.dataset.id);if(h){openModal(h.phrase);pendingText=h.phrase; $('translationSuggestion').textContent=h.translation||offerTranslation(h.phrase);$('explanationInput').value=h.explanation||''; $('saveHighlight').dataset.edit=h.id}return}
});
$('readingText').addEventListener('mouseup',()=>{const sel=window.getSelection();const text=sel.toString().trim();if(text && $('readingText').contains(sel.anchorNode)){pendingText=text;$('selectionHint').innerHTML=`<span>✦</span> Save “${escapeHtml(text.length>34?text.slice(0,34)+'…':text)}” for review`;$('selectionHint').style.cursor='pointer'}});
$('selectionHint').addEventListener('click',()=>{if(pendingText)openModal(pendingText)});
$('saveHighlight').addEventListener('click',()=>{const p=activePassage(),translation=$('translationSuggestion').textContent.trim(),explanation=$('explanationInput').value.trim(),editId=$('saveHighlight').dataset.edit;if(editId){const h=p.highlights.find(x=>x.id===editId);if(h){h.translation=translation;h.explanation=explanation}delete $('saveHighlight').dataset.edit}else{const start=p.text.indexOf(pendingText);if(start<0){showToast('That selection could not be found');return}if(p.highlights.some(h=>h.start===start)){showToast('That expression is already saved');return}p.highlights.push({id:'h'+Date.now(),phrase:pendingText,start,end:start+pendingText.length,translation,explanation,cards:{'es-en':0,'en-es':0},learned:false})}closeModal();pendingText='';$('selectionHint').innerHTML='<span>↗</span> Select any word or expression to save it';$('selectionHint').style.cursor='default';render();showToast('Translation added to your flashcards')});
['closeModal','cancelModal'].forEach(id=>$(id).addEventListener('click',closeModal));$('highlightModal').addEventListener('click',e=>{if(e.target.id==='highlightModal')closeModal()});
$('wrongBtn').addEventListener('click',()=>answer(false));$('rightBtn').addEventListener('click',()=>answer(true));
$('flashcard').addEventListener('click',e=>{
 const toggle=e.target.closest('[data-action="toggle-translation"]');
 if(!toggle)return;
 const currentId=state.queue[0];
 revealedCardId=revealedCardId===currentId?'':currentId;
 renderReview();
});
function answer(correct){
 const p=activePassage(), id=state.queue[0], card=findCard(id);
 if(!card){syncQueue();render();return}
 state.queue.shift();
 const h=card.h;
 h.cards={'es-en':correctCount(h,'es-en'),'en-es':correctCount(h,'en-es')};
 if(correct)h.cards[card.direction]=Math.min(CORRECT_ANSWERS_TO_LEARN,h.cards[card.direction]+1);
 const directionCount=h.cards[card.direction];
 if(CARD_DIRECTIONS.every(direction=>h.cards[direction]>=CORRECT_ANSWERS_TO_LEARN))h.learned=true;
 if(!h.learned&&directionCount<CORRECT_ANSWERS_TO_LEARN){
  state.repeatQueue=Array.isArray(state.repeatQueue)?state.repeatQueue:[];
  state.repeatQueue.push(id);
 }
 revealedCardId='';
 syncQueue();
 prioritizeNextWord(h.id);
 render();
 const message=h.learned?'Learned in both directions — removed from your passage!':!correct?'No problem. It’s back in the rotation.':directionCount>=CORRECT_ANSWERS_TO_LEARN?'Great — this direction is set. Keep going in the other direction.':`Nice. ${CORRECT_ANSWERS_TO_LEARN-directionCount} more correct in this direction.`;
 showToast(message);
}

$('clearHighlights').addEventListener('click',()=>{const p=activePassage();if(p.highlights.length&&confirm('Remove all saved words from this passage?')){p.highlights=[];state.queue=[];state.repeatQueue=[];state.round=1;revealedCardId='';render()}});
function newPassage(){const title=prompt('Name your passage:','A new Spanish passage');if(!title)return;const text=prompt('Paste your Spanish text here:');if(!text)return;const id='p'+Date.now();state.passages.push({id,title,text,highlights:[]});state.active=id;state.queue=[];state.repeatQueue=[];state.round=1;revealedCardId='';render()}
$('newPassageBtn').addEventListener('click',newPassage);$('newPassageBtnSmall').addEventListener('click',newPassage);render();
