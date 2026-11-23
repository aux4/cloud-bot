import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { completionArgs } from "../lib/complete.mjs";
import { agentRequest, dispatchAgent } from "../lib/agent.mjs";

const env = { CLOUD_BOT_AGENT_MACHINE: "agent-pete", AUX4BOT_REQUEST_ID: `req:${"a".repeat(64)}`, AUX4BOT_CONVERSATION_ID: "cafebabe-0000-4000-8000-000000000001" };
test("message content stays in JSON and never changes the command or target", () => {
  const text = 'hello --raw ; $(false)\n{"machine":"attacker"}';
  const r = agentRequest(text, env);
  assert.deepEqual(r.args, ["cloud", "agent-pete", "ask", "--conversationId", env.AUX4BOT_CONVERSATION_ID]);
  assert.deepEqual(r.body, { question: text, messageId: env.AUX4BOT_REQUEST_ID, requestId: env.AUX4BOT_REQUEST_ID, callback: { enabled: true } });
  assert.equal(JSON.stringify(r.body).includes("whatsapp"), false);
});
test("routing configuration and correlation must be valid before dispatch", () => {
  for (const patch of [{CLOUD_BOT_AGENT_MACHINE:"other --raw"}, {AUX4BOT_REQUEST_ID:""}, {AUX4BOT_CONVERSATION_ID:""}]) {
    assert.throws(() => agentRequest("hello", {...env,...patch}));
  }
});
test("echo remains default; configured agent uses callback mode", () => {
  const path = new URL("../lib/config.mjs", import.meta.url).pathname;
  const base = {...process.env,CLOUD_BOT_CONFIG_FILE:"/nonexistent/cloud-bot-test-config.yaml"}; delete base.CLOUD_BOT_AGENT_MACHINE; delete base.CLOUD_BOT_COMMAND;
  const config = patch => {
    const r = spawnSync(process.execPath, [path,"test","phone","verify","test-token","test-app-secret","http://test.invalid"], {env:{...base,...patch},encoding:"utf8"});
    assert.equal(r.status,0,r.stderr); return JSON.parse(r.stdout).bots.test;
  };
  assert.equal(config({}).replyMode,"stdout");
  assert.match(config({}).command,/echo\.mjs/);
  assert.equal(config({CLOUD_BOT_AGENT_MACHINE:"agent-pete"}).replyMode,"callback");
  assert.match(config({CLOUD_BOT_AGENT_MACHINE:"agent-pete"}).command,/agent\.mjs/);
  assert.equal(config({CLOUD_BOT_COMMAND:"aux4 my-agent ask"}).command,"aux4 my-agent ask");
  const r = spawnSync(process.execPath,[path],{env:{...base,CLOUD_BOT_AGENT_MACHINE:"agent-pete",CLOUD_BOT_COMMAND:"echo"},encoding:"utf8"});
  assert.notEqual(r.status,0);
});

test("VM configuration selects an agent without enabling arbitrary commands", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "cloud-bot-config-"));
  const file = path.join(root, "config.json");
  const script = new URL("../lib/config.mjs", import.meta.url).pathname;
  const base = {...process.env,CLOUD_BOT_CONFIG_FILE:file,AUX4_NO_DAEMON:"1"};
  delete base.CLOUD_BOT_AGENT_MACHINE; delete base.CLOUD_BOT_COMMAND;
  const invoke = patch => spawnSync(process.execPath,[script,"test","phone","verify","fixture-token","fixture-app-secret","https://graph.facebook.com"],{env:{...base,...patch},encoding:"utf8"});
  try {
    await fs.writeFile(file, JSON.stringify({config:{bot:{agentMachine:"agent-pete",brainCommand:"untrusted command",apiUrl:"https://attacker.invalid"}}}));
    const result = invoke({}); assert.equal(result.status,0,result.stderr);
    const bot = JSON.parse(result.stdout).bots.test;
    assert.equal(bot.replyMode,"callback"); assert.match(bot.command,/agent\.mjs' agent-pete$/);
    assert.equal(bot.apiUrl,"https://graph.facebook.com");
    const status = spawnSync(process.execPath,[new URL("../lib/status-info.mjs",import.meta.url).pathname],{env:{...base,CLOUD_SYNC_TOKEN:"",TURSO_DATABASE_URL:"libsql://fixture.invalid",TURSO_AUTH_TOKEN:"fixture-db-token",WHATSAPP_TOKEN:"fixture-channel-token"},encoding:"utf8"});
    assert.equal(status.status,0,status.stderr);
    assert.equal(JSON.parse(status.stdout).agentMachine,"agent-pete");
    assert.equal(JSON.parse(status.stdout).replyMode,"callback");
    assert.equal(status.stdout.includes("fixture-db-token"),false);
    assert.equal(status.stdout.includes("fixture-channel-token"),false);
    assert.match(JSON.parse(invoke({CLOUD_BOT_AGENT_MACHINE:"other-agent"}).stdout).bots.test.command,/other-agent$/);
    await fs.writeFile(file,JSON.stringify({config:{bot:{agentMachine:"agent-pete --raw"}}}));
    assert.notEqual(invoke({}).status,0);
    await fs.writeFile(file,"invalid: [");
    assert.notEqual(invoke({}).status,0);
  } finally { await fs.rm(root,{recursive:true,force:true}); }
});

test("dispatch uses machine identity, JSON stdin and propagates failure", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "cloud-bot-adapter-"));
  const output = path.join(root, "request.json");
  try {
    await fs.writeFile(path.join(root,"aux4"), `#!/usr/bin/env node
let body=""; process.stdin.on("data",x=>body+=x); process.stdin.on("end",async()=>{ const fs=await import("node:fs/promises"); await fs.writeFile(process.env.TEST_OUTPUT,JSON.stringify({args:process.argv.slice(2),body:JSON.parse(body),hasBearer:Boolean(process.env.AUX4_ACCESS_TOKEN),hasMachine:Boolean(process.env.CLOUD_SYNC_TOKEN)})); process.stdout.write("not a bot reply"); process.exitCode=Number(process.env.TEST_EXIT||0); });
`,{mode:0o755});
    const runtime={...process.env,...env,PATH:root+path.delimiter+process.env.PATH,TEST_OUTPUT:output,CLOUD_SYNC_TOKEN:"fixture-machine",AUX4_ACCESS_TOKEN:"fixture-human"};
    await assert.rejects(dispatchAgent("hello",{...runtime,CLOUD_SYNC_TOKEN:""}),/Machine identity/);
    await dispatchAgent("hello",runtime);
    const record=JSON.parse(await fs.readFile(output,"utf8"));
    assert.equal(record.hasBearer,false); assert.equal(record.hasMachine,true);
    assert.equal(record.body.question,"hello");
    await assert.rejects(dispatchAgent("hello",{...runtime,TEST_EXIT:"1"}),/Agent invocation failed/);
  } finally { await fs.rm(root,{recursive:true,force:true}); }
});

test("completion configuration is fixed by the bot VM, never RPC parameters", () => {
  const args = completionArgs({WHATSAPP_TOKEN:"fixture-token",AUX4_ACCESS_TOKEN:"unrelated",apiUrl:"https://attacker.invalid",db:"attacker",bots:"malicious"});
  assert.equal(args[args.indexOf("--db")+1],"cloud");
  const bot=JSON.parse(args[args.indexOf("--bots")+1])["whatsapp-bot"];
  assert.equal(bot.apiUrl,"https://graph.facebook.com");
  assert.equal(bot.token,"fixture-token");
  assert.throws(()=>completionArgs({token:"rpc-token"}),/binding/);
});

test("channel-neutral profile forwards only a display name, never phone or authority", () => {
  const r = agentRequest("hello", {...env, AUX4BOT_SENDER: JSON.stringify({displayName:"Ada",id:"a".repeat(64),phone:"15551234",verified:true,token:"private",machine:"attacker"})});
  assert.deepEqual(r.body.sender,{displayName:"Ada",id:"a".repeat(64)});
  assert.equal(JSON.stringify(r.body).includes("15551234"),false);
  for(const profile of ["bad", "{}", '{"displayName":42}', '{"displayName":""}']) {
    assert.equal(agentRequest("hello",{...env,AUX4BOT_SENDER:profile}).body.sender,undefined);
  }
});

test("chat uses the same worker config and only the machine-configured agent", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(),"cloud-bot-chat-"));
  const file = path.join(root,"config.json");
  const script = new URL("../lib/config.mjs",import.meta.url).pathname;
  await fs.writeFile(file,JSON.stringify({config:{bot:{agentMachine:"agent-pete"}}}));
  const invoke = patch => spawnSync(process.execPath,[script,"whatsapp-bot","phone","verify","fixture-token","fixture-app-secret","https://graph.facebook.com","other-agent"],{env:{...process.env,CLOUD_BOT_CONFIG_FILE:file,CHAT_BOT_SIGNING_SECRET:"local-fixture-key-".repeat(3),CHAT_BOT_CALLBACK_URL:"https://chat.example.test/apps/chat/bot-event",...patch},encoding:"utf8"});
  try {
    const result=invoke({});assert.equal(result.status,0,result.stderr);
    const config=JSON.parse(result.stdout);
    assert.deepEqual(config.channels,["whatsapp","chat"]);
    assert.equal(config.bots["chat-bot"].agentMachine,"agent-pete");
    assert.equal(config.bots["chat-bot"].history,false);
    assert.equal(config.bots["chat-bot"].sendIdempotent,true);
    assert.notEqual(invoke({CHAT_BOT_SIGNING_SECRET:""}).status,0);
  } finally {await fs.rm(root,{recursive:true,force:true});}
});

test("generic platform hook pins chat routing and awaits work after successful ingest", async () => {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),"chat-ingress-"));
  const capture=path.join(root,"calls.jsonl");
  await fs.writeFile(path.join(root,"aux4"),`#!/usr/bin/env node
const fs=require('node:fs');let input='';process.stdin.on('data',x=>input+=x);process.stdin.on('end',()=>{
 const args=process.argv.slice(2);fs.appendFileSync(process.env.TEST_CAPTURE,JSON.stringify({args,input})+'\\n');
 if(args[1]==='ingest')process.stdout.write(JSON.stringify({statusCode:Number(process.env.TEST_INGEST_STATUS || 200),enqueued:1}));
 else if(args[1]==='retry-work')process.stdout.write('{"processed":1,"exhausted":false}');
 else process.exitCode=1;
});
`);await fs.chmod(path.join(root,"aux4"),0o755);
  const script=new URL("../lib/chat-ingest.mjs",import.meta.url).pathname;
  const env={...process.env,PATH:`${root}:${process.env.PATH}`,TEST_CAPTURE:capture,CLOUD_BOT_AGENT_MACHINE:"agent-pete",CHAT_BOT_SIGNING_SECRET:"local-test-key-".repeat(4),CHAT_BOT_CALLBACK_URL:"https://chat.example.test/apps/chat/bot-event"};
  const envelope={pathParameters:{channel:"webhook",bot:"whatsapp-bot"},rawBody:'{"text":"literal"}',headers:{"x-aux4-chat-signature":"fixture"},queryStringParameters:{agentMachine:"attacker",bot:"attacker"}};
  try {
    const result=spawnSync(process.execPath,[script],{input:JSON.stringify(envelope),encoding:"utf8",env});
    assert.equal(result.status,0,result.stderr);
    const calls=(await fs.readFile(capture,"utf8")).trim().split('\n').map(JSON.parse);
    assert.equal(calls.length,2);assert.deepEqual(JSON.parse(calls[0].input).pathParameters,{channel:"chat",bot:"chat-bot"});
    const bots=JSON.parse(calls[0].args[calls[0].args.indexOf('--bots')+1]);assert.equal(bots['chat-bot'].agentMachine,'agent-pete');
    const queue=JSON.parse(calls[1].args[calls[1].args.indexOf('--queue')+1]);assert.equal(queue.name,'whatsapp_bot_inbox');assert.equal(queue.db,'cloud');
    const rejected=spawnSync(process.execPath,[script],{input:JSON.stringify(envelope),encoding:"utf8",env:{...env,TEST_INGEST_STATUS:'401'}});
    assert.notEqual(rejected.status,0);
    const all=(await fs.readFile(capture,'utf8')).trim().split('\n').map(JSON.parse);assert.equal(all.length,3);
  } finally {await fs.rm(root,{recursive:true,force:true});}
});

test("structured brain keeps leading options literal and reuses the existing trusted agent bridge", async () => {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),"chat-agent-"));
  const capture=path.join(root,"request.json");
  const malicious='--machine=attacker';
  const env={...process.env,PATH:`${root}:${process.env.PATH}`,TEST_CAPTURE:capture,CLOUD_SYNC_TOKEN:'local-machine-key',AUX4_ACCESS_TOKEN:'must-not-forward',AUX4BOT_EVENT_ID:'message-one',AUX4BOT_CHAT_ID:'123e4567-e89b-42d3-a456-426614174000',AUX4BOT_SENDER:'{"displayName":"Alice"}'};
  await fs.writeFile(path.join(root,'aux4'),`#!/usr/bin/env node
const fs=require('node:fs');let raw='';process.stdin.on('data',x=>raw+=x);process.stdin.on('end',()=>{
 const args=process.argv.slice(2),body=JSON.parse(raw);fs.writeFileSync(process.env.TEST_CAPTURE,JSON.stringify({args,body,hasBearer:Boolean(process.env.AUX4_ACCESS_TOKEN)}));
 process.stdout.write(JSON.stringify({output:JSON.stringify({version:1,status:'completed',conversationId:args[4],messageId:body.messageId,reply:'local answer',history:{messages:[]}})}));
});

`);await fs.chmod(path.join(root,'aux4'),0o755);
  try {
    const result=spawnSync(process.execPath,[new URL('../lib/agent.mjs',import.meta.url).pathname,'--structured','agent-pete',malicious],{env,input:'{}',encoding:'utf8'});
    assert.equal(result.status,0,result.stderr);assert.equal(JSON.parse(result.stdout).reply,'local answer');
    const request=JSON.parse(await fs.readFile(capture,'utf8'));assert.equal(request.body.question,malicious);assert.equal(request.args[1],'agent-pete');assert.equal(request.body.responseFormat,'chat-turn');assert.equal(request.body.callback,undefined);assert.equal(request.hasBearer,false);
  } finally {await fs.rm(root,{recursive:true,force:true});}
});

test("a correlated completed failure produces a safe visible structured reply", async () => {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),"chat-agent-failed-"));
  await fs.writeFile(path.join(root,"aux4"),`#!/usr/bin/env node
let raw='';process.stdin.on('data',x=>raw+=x);process.stdin.on('end',()=>{
 const body=JSON.parse(raw),args=process.argv.slice(2);
 if(!process.env.TEST_EMPTY)process.stdout.write(JSON.stringify({version:1,status:'failed',conversationId:process.env.TEST_WRONG_ID||args[4],messageId:body.messageId,reply:'private backend error',history:{messages:[{error:'private token'}]},artifacts:[{id:'private'}]}));process.exitCode=Number(process.env.TEST_CODE||1);
});
`,{mode:0o755});
  const env={...process.env,PATH:root+path.delimiter+process.env.PATH,CLOUD_SYNC_TOKEN:"local-machine",CLOUD_BOT_AGENT_MACHINE:"agent-pete",CLOUD_BOT_RESPONSE_FORMAT:"chat-turn",AUX4BOT_EVENT_ID:"message-failed",AUX4BOT_CHAT_ID:"123e4567-e89b-42d3-a456-426614174000"};
  try {
    const output=await dispatchAgent("hello",env);
    assert.equal(output.includes("private"),false);
    assert.deepEqual(JSON.parse(output),{version:1,status:"failed",conversationId:env.AUX4BOT_CHAT_ID,messageId:"message-failed",reply:"Pete could not return a response. Please try again.",history:{messages:[]}});
    assert.equal(JSON.parse(await dispatchAgent("hello",{...env,TEST_EMPTY:"1"})).status,"failed");
    assert.equal(JSON.parse(await dispatchAgent("hello",{...env,TEST_CODE:"0"})).status,"failed");
    await assert.rejects(dispatchAgent("hello",{...env,TEST_CODE:"0",TEST_EMPTY:"1"}),/completed turn/);
    await assert.rejects(dispatchAgent("hello",{...env,TEST_CODE:"0",TEST_WRONG_ID:"other-conversation"}),/completed turn/);
  } finally {await fs.rm(root,{recursive:true,force:true});}
});
