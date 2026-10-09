import test from 'node:test';
import assert from 'node:assert/strict';
import { messagePagination, validateMessage } from '../lib/board.ts';

test('board preserves multiline plain text and applies anonymous defaults', () => {
  assert.deepEqual(validateMessage({content:'  第一行\n<script>alert(1)</script>  '}), {content:'第一行\n<script>alert(1)</script>',author:'匿名访客',color:'yellow',position:null});
  assert.deepEqual(validateMessage({content:'你好',author:'  小林  ',color:'blue'}), {content:'你好',author:'小林',color:'blue',position:null});
  assert.equal(validateMessage({content:'留言',author:'   '}).author,'匿名访客');
});
test('whiteboard positions are optional normalized numeric coordinates', () => {
  for(const position of [{x:0,y:1},{x:.45,y:.7}]) assert.deepEqual(validateMessage({content:'便签',position}).position,position);
  for(const position of [null,[],{}, {x:.5},{x:-.1,y:0},{x:1,y:1.01},{x:'0.5',y:0},{x:NaN,y:0},{x:Infinity,y:0}]) assert.throws(()=>validateMessage({content:'便签',position}));
});
test('board rejects blank, oversized and invalid input before storage', () => {
  for (const content of ['', ' \n\t ', 12, null, 'a'.repeat(2001)]) assert.throws(() => validateMessage({content}));
  for (const author of [42, null, 'a'.repeat(25)]) assert.throws(() => validateMessage({content:'留言',author}));
  for (const color of ['red',null,{},'<script>']) assert.throws(() => validateMessage({content:'留言',color}));
  assert.equal(validateMessage({content:'a'.repeat(2000),author:'a'.repeat(24),color:'green'}).content.length,2000);
});
test('board pagination has finite integer bounds', () => {
  assert.deepEqual(messagePagination(new URLSearchParams()),{offset:0,limit:12});
  assert.deepEqual(messagePagination(new URLSearchParams('offset=12&limit=100')),{offset:12,limit:100});
  for(const query of ['offset=-1','offset=1.2','offset=Infinity','offset=999999999999999999999','limit=0','limit=101','limit=no']) assert.throws(() => messagePagination(new URLSearchParams(query)));
});
