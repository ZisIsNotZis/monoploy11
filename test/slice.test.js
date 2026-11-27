import test from 'node:test';
import assert from 'node:assert/strict';
import { createSliceConfig } from '../src/data/slice.js';
import { startSession, runGame } from '../src/engine/flow.js';
import { applyCard, tickTimers } from '../src/engine/game.js';
import { rentFor, buyPrice, assetsOf } from '../src/engine/economy.js';
import { reachableLandings, sliceTargetIds } from '../src/engine/insight.js';
import { render } from '../src/ui/render.js';

const make=()=>startSession(createSliceConfig());
test('upgrade → high season → closure → reopening has visible, reversible consequences',()=>{
  const s=make(),p=s.players[0],q=s.players[1],id=p.properties[0],street=s.properties[id].street;
  const baseline=rentFor(s,id);
  assert.equal(applyCard(s,p,'worker',id),true);
  assert.equal(rentFor(s,id),baseline*2);
  assert.equal(applyCard(s,p,'inflate',street),true);
  assert.equal(rentFor(s,id),baseline*4);
  applyCard(s,q,'close',street); assert.equal(rentFor(s,id),0);
  tickTimers(s);assert.equal(rentFor(s,id),0);
  tickTimers(s);assert.equal(rentFor(s,id),baseline*4);
  tickTimers(s);assert.equal(rentFor(s,id),baseline*2);
  applyCard(s,p,'worker',id);assert.equal(s.properties[id].level,3);
  assert.equal(applyCard(s,p,'worker',id),false);
});

test('takeovers pay the previous owner and the premium is a real asset cost',()=>{
  const s=make(),p=s.players[0],q=s.players[1],id=q.properties[0];
  const beforeMoney=s.players.reduce((v,p)=>v+p.cash+p.deposit,0);
  const price=buyPrice(s,id),beforeAssets=assetsOf(s,p),oldCash=q.cash;
  assert.equal(applyCard(s,p,'buyland',id),true);
  assert.equal(q.cash-oldCash,Math.round(price*1.25));
  assert.equal(assetsOf(s,p),beforeAssets-Math.round(price*.25));
  assert.equal(s.players.reduce((v,p)=>v+p.cash+p.deposit,0),beforeMoney);
  assert.equal(s.properties[id].ownerId,p.id);assert.ok(p.properties.includes(id));assert.ok(!q.properties.includes(id));
  const before=JSON.stringify(s);
  assert.equal(applyCard(s,p,'buyland','market'),false);assert.equal(JSON.stringify(s),before);
  assert.ok(!sliceTargetIds(s,p,'buyland').includes('market'));
});

test('movement previews equal all reachable outcomes of the real slice movement loop',async()=>{
  for(let steps=1;steps<=6;steps++) {
    const reference=make(),expected=new Set(reachableLandings(reference,reference.players[0],steps));
    const actual=new Set(),scripts=[[]];
    while(scripts.length) {
      const script=scripts.shift(),s=make(),p=s.players[0];p.forcedDice=steps;
      let at=0;
      const stop={stop:true};
      try {
        await runGame(s,{render(){},async step(){},async ask(prompt){
          if(prompt.type==='action') {if(prompt.player.id!==p.id)throw stop;return {action:'roll',dice:1};}
          if(prompt.type==='direction'&&prompt.remainingSteps>0) {
            if(at>=script.length)throw {branch:prompt.options};
            return script[at++];
          }
          if(prompt.type==='direction')return prompt.options[0];
          return false;
        }});
      } catch(error) {
        if(error.branch) {for(const id of error.branch)scripts.push([...script,id]);continue;}
        if(error!==stop)throw error;
      }
      actual.add(p.position);
    }
    assert.deepEqual(actual,expected,`exact ${steps}-step endpoints`);
  }
});

// Execute production render functions without a browser; snapshots remain plain markup.
const element=()=>({innerHTML:'',hidden:false,clientWidth:1000,clientHeight:800,style:{},classList:{toggle(){}},querySelector(){return {onclick:null};},querySelectorAll(){return [];}});
const root=()=>Object.fromEntries(['system','players','board','log','insight','dice','cards','hand','choice'].map(k=>[k,element()]));
test('production UI renders readable action, supply, exact-step previews and results without missing handlers',()=>{
  const s=make(),r=root(),a={};render(r,s,a);
  assert.match(r.cards.innerHTML,/翻修/);assert.match(r.cards.innerHTML,/125%|免费|本回合/);
  assert.match(r.board.innerHTML,/租 2,800/);assert.match(r.insight.innerHTML,/轮到你了/);
  s.pending={type:'diceValue',min:1,max:6};render(r,s,a);assert.match(r.choice.innerHTML,/晨光街|晚风街|书屋/);
  s.pending={type:'supply',options:[{id:'grow',name:'把生意做大',desc:'翻修 + 旺季'}]};render(r,s,a);assert.match(r.choice.innerHTML,/把生意做大/);
  s.over=true;s.phase='over';s.winnerTeam='t1';render(r,s,a);assert.match(r.choice.innerHTML,/总资产/);assert.match(r.choice.innerHTML,/再开一局/);
});

// A non-numeric answer to the exact-step prompt must not be accepted as a step count.
test('non-integer exact-step answers are refused and the card stays in hand',async()=>{
  const s=make(),p=s.players[0];
  assert.ok(p.cards.includes('remotedice'),'starting hand has the exact-step card');
  const asked=[];let actionAsks=0;
  const stop={stop:true};
  try{
    await runGame(s,{render(){},async step(){},async ask(prompt){
      if(prompt.type==='action') {
        if(prompt.player.id!==p.id)throw stop;
        actionAsks+=1;
        return actionAsks<=3?{action:'card',index:p.cards.indexOf('remotedice')}:{action:'roll',dice:1};
      }
      if(prompt.type==='diceValue') {asked.push(prompt);return ['晨光街',1.5,4][asked.length-1];}
      return false;
    }});
  } catch(error) {if(error!==stop)throw error;}
  assert.equal(asked.length,3,'the prompt is asked again after each refused answer');
  assert.equal(p.cards.filter(id=>id==='remotedice').length,0,'only the valid answer spends the card');
  assert.ok(!s.log.some(l=>/NaN/.test(l.text)),'no NaN reaches the log');
  assert.equal(s.lastRoll?.value,4,'the accepted step count is the integer that was offered');
  assert.ok(s.log.some(l=>/使用定步：本回合走 4 步/.test(l.text)),'the effect is stated in plain words');
  assert.equal(p.sliceCardsUsed,1,'the refused answers did not count as played cards');
});
