import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiError } from '../lib/domain.ts';
import { enforceRateLimit } from '../lib/rate-limit.ts';

test('Rate limiter allows up to the window max then rejects with 429, independently per key',()=>{
  const rule={action:'unit-rate-'+Math.random(),windowMs:60_000,max:3};
  enforceRateLimit(rule,['alice']);enforceRateLimit(rule,['alice']);enforceRateLimit(rule,['alice']);
  assert.throws(()=>enforceRateLimit(rule,['alice']),(e:Error)=>e instanceof ApiError && (e as ApiError).status===429);
  // A different caller has its own bucket.
  enforceRateLimit(rule,['bob']);enforceRateLimit(rule,['bob']);enforceRateLimit(rule,['bob']);
  assert.throws(()=>enforceRateLimit(rule,['bob']),ApiError);
  // A separate rule (action) is not shared with the first.
  enforceRateLimit({action:'unit-other-'+Math.random(),windowMs:60_000,max:1},['alice']);
});

test('Rate limiter window resets after expiry',async()=>{
  const rule={action:'unit-expiry-'+Math.random(),windowMs:30,max:1};
  enforceRateLimit(rule,['carol']);
  assert.throws(()=>enforceRateLimit(rule,['carol']),ApiError);
  await new Promise(r=>setTimeout(r,45));
  enforceRateLimit(rule,['carol']); // no throw after window elapsed
  assert.ok(true);
});
