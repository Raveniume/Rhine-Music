import test from 'node:test';
import assert from 'node:assert/strict';
import { readPlaylistOrder, savePlaylistOrder, orderedPlaylists } from '../src/playlist-order.ts';
import { NeteasePlaylists } from '../src/netease-playlists.ts';

test('local order is scoped, stable for new lists and safe with malformed saved data', () => {
  const previous = globalThis.localStorage, data = new Map();
  globalThis.localStorage = { getItem:k=>data.get(k), setItem:(k,v)=>data.set(k,v), removeItem:k=>data.delete(k) };
  try {
    savePlaylistOrder('netease:1', ['b','b','a']);
    assert.deepEqual(readPlaylistOrder('netease:1'), ['b','a']);
    assert.deepEqual(readPlaylistOrder('qq:1'), []);
    const lists = ['a','new','b','newer'].map(id=>({id}));
    assert.deepEqual(orderedPlaylists(lists, readPlaylistOrder('netease:1')).map(x=>x.id), ['b','a','new','newer']);
    assert.deepEqual(lists.map(x=>x.id), ['a','new','b','newer']);
    data.set('rhine-playlist-order:broken', '{'); assert.deepEqual(readPlaylistOrder('broken'), []);
    savePlaylistOrder('netease:1', []); assert.deepEqual(readPlaylistOrder('netease:1'), []);
  } finally { globalThis.localStorage = previous; }
});

test('reordering during a page request cannot return songs from another playlist', async () => {
  const previous = globalThis.fetch;
  let release;
  globalThis.fetch = async input => {
    const url = new URL(input, 'http://127.0.0.1');
    if (url.pathname.endsWith('/playlists')) return Response.json({ playlists:[{id:'99',name:'A',trackCount:100},{id:'88',name:'B',trackCount:1}],hasMore:false });
    if (url.searchParams.get('offset') === '50') return new Promise(resolve => { release=()=>resolve(Response.json({total:100,tracks:[{id:'A-50'}]})); });
    return Response.json({total:100,tracks:[{id:'A-0'}]});
  };
  const library = new NeteasePlaylists(()=>{});
  try {
    await library.load();
    const pending = library.queue(0, 50);
    while(!release) await new Promise(resolve=>setImmediate(resolve));
    library.playlists.reverse(); release();
    assert.deepEqual((await pending).map(track=>track.id), ['A-0','A-50']);
  } finally { library.dispose(); globalThis.fetch = previous; }
});
