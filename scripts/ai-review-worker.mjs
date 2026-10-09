import { readAiConfig } from '../lib/ai-service.mjs';
import { processAiJob } from '../lib/ai-queue.mjs';
import { getPool } from '../db/postgres.mjs';
const config=readAiConfig();if(!config.enabled)process.exit(0);
let stopping=false;for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{stopping=true;});
console.log('SkillHub AI worker ready (one job at a time).');
while(!stopping){try{if(await processAiJob(config))continue;}catch{console.warn('SkillHub AI worker database temporarily unavailable.');}await new Promise(resolve=>setTimeout(resolve,2000));}
await getPool().end();
