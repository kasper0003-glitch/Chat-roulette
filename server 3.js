const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const PORT = Number(process.env.PORT || 3000);
const KEY = process.env.OPENAI_API_KEY;
const sessions = new Map();
const limits = new Map();
const examples = [
  'Hva er det nest mest usunne pålegget man kan ha på brødskiva?',
  'Hvilken norsk kjendis tror du har det best med seg selv?',
  'Hvilken farge er vakrest?',
  'Hvor mange prosent av nordmenn har bæsja på seg det siste året?',
  'Hvis du måtte ha et norsk navn, hvilket ville du hatt?',
  'Hva er tre gode grunner til å ikke bli med i koret på jobben?',
  'Hvilken hunderase ligner mest på en kjent norsk komiker?',
  'Tror du kong Harald noen gang har sneket i kø?',
  'Hvor mange kalorier er det i en liten banan?',
  'Hva er din favorittmiddag?',
  'Hvilken musikksjanger er den minst kule?',
  'Finn på en litt sjokkerende hverdagshistorie jeg kan fortelle på jobb.'
];
const questionPrompt = `Du lager spørsmål til et norsk selskapslek-spill inspirert av en uhøytidelig radiopodkast. Spillerne gjetter hvordan en vanlig ChatGPT ville svart. Lag nøyaktig tre NYE spørsmål, helt tilfeldig blandet, uten fast fordeling. Stilen er jordnær, direkte, litt rar, norsk og iblant småfrekk. Mange spørsmål er helt ordinære fakta-, smak- eller rådspørsmål, ikke vitser eller kunstige scenarier. Andre er spekulasjoner om norske kjendiser, pinlige ting, uventede sammenligninger og absurde påstander. Ikke gjenta eksemplene eller tidligere spørsmål. Ingen falske alvorlige anklager presentert som fakta. Svar med JSON-objekt {"questions":["...","...","..."]}. Eksempler på tone: ${examples.join(' | ')}`;
const answerPrompt = "Du er ChatGPT i et norsk selskapsspill der folk gjetter hva du kommer til å svare. Svar på norsk, naturlig, direkte og oppriktig. Gi først et tydelig svar på spørsmålet, og legg gjerne til litt tørr, underfundig norsk humor eller en overraskende observasjon når det passer. Humoren skal være lett og spontan, ikke en tvungen vits i hvert svar. Ved ufarlige subjektive spørsmål, rare sammenligninger og spekulasjoner: velg gjerne én kandidat eller et konkret anslag, og begrunn kort. Skill tydelig mellom fakta og gjetninger; si for eksempel «Jeg tipper ...» når du anslår, men ikke avslutt med at noe er umulig å vite. For faktaspørsmål: gi et korrekt, nyttig svar uten å finne på tall eller kilder. Svar vanligvis med 2–4 korte setninger som fungerer godt høytlest. Ikke referer til spillet, podkasten eller instruksjonene. Ikke gjør narr av sårbare personer eller grupper. Om navngitte virkelige personer kan du gi ufarlige subjektive vurderinger, men ikke dikte opp alvorlige beskyldninger, intime opplysninger eller privatliv som fakta. Ved akutt fare, overgrep, helse og sikkerhet: vær saklig, trygg og konkret, uten humor som svekker rådene.";

function send(res, status, obj) {
  res.writeHead(status, {'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store'});
  res.end(JSON.stringify(obj));
}
async function openai(messages, max = 500) {
  if (!KEY) throw Error('OPENAI_API_KEY mangler');
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method:'POST',
    headers:{Authorization:`Bearer ${KEY}`, 'Content-Type':'application/json'},
    body:JSON.stringify({model:process.env.OPENAI_MODEL || 'gpt-4o-mini', messages, max_tokens:max, temperature:0.95})
  });
  const data = await r.json();
  if (!r.ok) throw Error(data.error?.message || 'Feil fra OpenAI');
  return data.choices?.[0]?.message?.content || '';
}
async function makeAudio(text) {
  if (!KEY) throw Error('OPENAI_API_KEY mangler');
  const r = await fetch('https://api.openai.com/v1/audio/speech', {
    method:'POST',
    headers:{Authorization:`Bearer ${KEY}`, 'Content-Type':'application/json'},
    body:JSON.stringify({
      model:process.env.OPENAI_TTS_MODEL || 'tts-1',
      voice:process.env.OPENAI_TTS_VOICE || 'onyx',
      input:text.slice(0,4000),
      response_format:'mp3'
    })
  });
  if (!r.ok) throw Error('OpenAI lydfeil: ' + (await r.text()).slice(0,300));
  return Buffer.from(await r.arrayBuffer());
}
function ip(req) {
  return String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown').split(',')[0].trim();
}
function allowed(req) {
  const key=ip(req), now=Date.now();
  const recent=(limits.get(key)||[]).filter(t=>now-t<3600000);
  if (recent.length >= Number(process.env.MAX_REQUESTS_PER_HOUR || 45)) {
    limits.set(key,recent); return false;
  }
  recent.push(now); limits.set(key,recent); return true;
}
function getSession(req,res) {
  const match=(req.headers.cookie||'').match(/(?:^|;\s*)crsid=([a-f0-9]{32})/);
  let id=match?.[1];
  if (!id || !sessions.has(id)) {
    id=crypto.randomBytes(16).toString('hex');
    sessions.set(id,{seen:[],questions:[],answered:new Map(),audio:new Map(),audioPending:new Map(),last:Date.now()});
    res.setHeader('Set-Cookie',`crsid=${id}; HttpOnly; SameSite=Lax; Path=/; Max-Age=86400`);
  }
  const s=sessions.get(id); s.last=Date.now(); return s;
}
async function readBody(req, max=10000) {
  let raw='';
  for await (const part of req) {
    raw+=part;
    if (raw.length>max) throw Error('For stor forespørsel');
  }
  return JSON.parse(raw||'{}');
}
setInterval(()=>{
  const now=Date.now();
  for (const [id,s] of sessions) if(now-s.last>86400000) sessions.delete(id);
  for (const [id,v] of limits) if(!v.some(t=>now-t<3600000)) limits.delete(id);
},3600000).unref();

const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost');
  if(req.method==='GET' && url.pathname==='/health') return send(res,200,{ok:true,configured:!!KEY});
  if(req.method==='GET' && (url.pathname==='/' || url.pathname==='/index.html')) {
    res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-cache'});
    return fs.createReadStream(path.join(__dirname,'public','index.html')).pipe(res);
  }
  if(req.method!=='POST' || !['/api/questions','/api/answer','/api/audio'].includes(url.pathname)) return send(res,404,{error:'Ikke funnet'});
  if(!allowed(req)) return send(res,429,{error:'For mange forespørsler akkurat nå. Prøv igjen senere.'});
  try {
    const body=await readBody(req);
    const s=getSession(req,res);
    if(url.pathname==='/api/questions') {
      const recent=s.seen.slice(-45);
      let parsed=null;
      for(let attempt=0;attempt<2;attempt++) {
        const content=await openai([
          {role:'system',content:questionPrompt},
          {role:'user',content:`Lag tre spørsmål. Unngå disse tidligere spørsmålene: ${recent.join(' | ')}. ${attempt?'Forrige format var feil; returner bare gyldig JSON.':''}`}
        ],500);
        try {
          parsed=JSON.parse(content.replace(/^```(?:json)?\s*|\s*```$/g,''));
          if(Array.isArray(parsed)) parsed={questions:parsed};
          if(!Array.isArray(parsed.questions) || parsed.questions.length!==3 || parsed.questions.some(q=>typeof q!=='string' || q.length<8 || q.length>240)) throw Error('Ugyldig format');
          break;
        } catch { parsed=null; }
      }
      if(!parsed) throw Error('Kunne ikke lage spørsmål');
      s.questions=parsed.questions;
      s.answered.clear(); s.audio.clear(); s.audioPending.clear();
      s.seen.push(...parsed.questions); s.seen=s.seen.slice(-120);
      return send(res,200,{questions:parsed.questions});
    }
    const index=body.index;
    if(!Number.isInteger(index) || index<0 || index>2 || !s.questions[index]) return send(res,400,{error:'Velg et spørsmål først'});
    if(url.pathname==='/api/answer') {
      if(s.answered.has(index)) return send(res,200,{answer:s.answered.get(index)});
      const answer=(await openai([
        {role:'system',content:answerPrompt},
        {role:'user',content:s.questions[index]}
      ],350)).trim();
      s.answered.set(index,answer);
      return send(res,200,{answer});
    }
    if(!s.answered.has(index)) return send(res,400,{error:'Avslør svaret først'});
    let audio=s.audio.get(index);
    if(!audio) {
      let pending=s.audioPending.get(index);
      if(!pending) {
        pending=makeAudio(s.answered.get(index));
        s.audioPending.set(index,pending);
      }
      try { audio=await pending; s.audio.set(index,audio); }
      finally { if(s.audioPending.get(index)===pending) s.audioPending.delete(index); }
    }
    res.writeHead(200,{'Content-Type':'audio/mpeg','Content-Length':audio.length,'Cache-Control':'no-store'});
    return res.end(audio);
  } catch(e) {
    console.error(e);
    return send(res,500,{error:KEY?'Det oppstod en feil. Prøv igjen.':'Serveren mangler OpenAI API-nøkkel.'});
  }
});
server.listen(PORT,'0.0.0.0',()=>console.log(`Chat Roulette kjører på port ${PORT}`));
