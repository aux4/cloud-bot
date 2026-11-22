import { spawn } from 'node:child_process';
import { buildBotConfig } from './config.mjs';

async function run(args, input) {
  return new Promise((resolve,reject)=>{
    const child=spawn('aux4',args,{stdio:['pipe','pipe','ignore'],env:process.env});let output='';
    child.stdout.on('data',x=>{output+=x;if(Buffer.byteLength(output)>262144)child.kill();});
    child.once('error',()=>reject(new Error('Chat operation failed')));
    child.once('close',code=>code===0?resolve(output):reject(new Error('Chat operation failed')));
    child.stdin.on('error',()=>{});child.stdin.end(input || '');
  });
}
try {
  let raw='';for await(const chunk of process.stdin){raw+=chunk;if(Buffer.byteLength(raw)>131072)throw new Error();}
  const envelope=JSON.parse(raw);
  if (!envelope || typeof envelope.rawBody !== 'string') throw new Error();
  // This bound command pins routing; generic platform HMAC hooks use channel=webhook.
  envelope.pathParameters={channel:'chat',bot:'chat-bot'};
  const e=process.env;
  const config=buildBotConfig(['whatsapp-bot',e.CLOUD_BOT_PHONE_NUMBER_ID||'1450110568185980','',e.WHATSAPP_TOKEN||'',e.WHATSAPP_APP_SECRET||'','https://graph.facebook.com']);
  if(!config.bots['chat-bot'])throw new Error();
  const common=['--channels',JSON.stringify(config.channels),'--bots',JSON.stringify(config.bots),'--defaults','{}','--db','cloud','--queue',JSON.stringify({name:'whatsapp_bot_inbox',provider:'repository',db:'cloud',visibility:30,maxAttempts:5})];
  const accepted=JSON.parse(await run(['bot','ingest',...common],JSON.stringify(envelope)));
  if(accepted.statusCode!==200)throw new Error();
  await run(['bot','retry-work','--expected',String(accepted.enqueued||0),...common],'');
  process.stdout.write('{"ok":true}');
} catch {process.stderr.write('Chat delivery could not be processed\n');process.exitCode=1;}
