import assert from 'node:assert/strict';
import {readFileSync, writeFileSync} from 'node:fs';
import {resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {ethers} from './runtime.mjs';

export const EXPECTED = Object.freeze({chainId:1,token:'0x2b82cdeb8477415d541799abb0cc48044c8ea5f3',decimals:18,
  tokenCodeHash:'0x01fb92b21a7414fcac4480618142f8968a5d2bae8071370fb5e9369b97fc55bc',
  tokenSupply:'1000000000000000000000000000',shareSize:'100000000000000000000000',
  treasury:'0x1C651928150DADDDA9C2C040a9D4901d862f8eC4'});
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const PROVIDERS=['https://ethereum-rpc.publicnode.com','https://rpc.mevblocker.io'];

/// Replace only compiler-declared immutable slots; every remaining runtime byte must match.
export function bindRuntime(artifact,values) {
  const bytes=Buffer.from(artifact.deployedBytecode.slice(2),'hex');
  const covered=new Set();
  for(const [id,references] of Object.entries(artifact.immutableReferences)) {
    const name=artifact.immutableBindings[id];
    assert.ok(['token','tokenCodeHash','tokenSupply','treasury'].includes(name),'UNKNOWN_IMMUTABLE');
    assert.ok(Object.hasOwn(values,name),'MISSING_IMMUTABLE_'+name);
    const value=name==='tokenSupply'?ethers.toBeHex(BigInt(values[name])):values[name];
    const replacement=Buffer.from(ethers.zeroPadValue(value,32).slice(2),'hex');
    for(const {start,length} of references) {
      assert.equal(length,32);assert.ok(start>=0&&start+length<=bytes.length);
      for(let offset=start;offset<start+length;offset++){assert.ok(!covered.has(offset),'OVERLAPPING_IMMUTABLE');covered.add(offset);}
      replacement.copy(bytes,start);
    }
  }
  return '0x'+bytes.toString('hex');
}

export function validateTokenSnapshot(snapshot) {
  assert.equal(snapshot.chainId,EXPECTED.chainId,'CHAIN_ID_MISMATCH');
  assert.equal(snapshot.address.toLowerCase(),EXPECTED.token,'TOKEN_ADDRESS_MISMATCH');
  assert.equal(ethers.keccak256(snapshot.code),EXPECTED.tokenCodeHash,'TOKEN_RUNTIME_MISMATCH');
  assert.equal(Number(snapshot.decimals),EXPECTED.decimals,'TOKEN_DECIMALS_MISMATCH');
  assert.equal(String(snapshot.totalSupply),EXPECTED.tokenSupply,'TOKEN_SUPPLY_MISMATCH');
  assert.equal(snapshot.name,'EmberEVO');assert.equal(snapshot.symbol,'EMBEO');
}

async function rpc(endpoint,method,params) {
  assert.ok(PROVIDERS.includes(endpoint));
  assert.ok(['eth_chainId','eth_getBlockByNumber','eth_getCode','eth_call'].includes(method),'READ_ONLY_METHOD_REQUIRED');
  const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},redirect:'error',
    body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:AbortSignal.timeout(15_000)});
  if(!response.ok) throw Error('RPC_HTTP_'+response.status);
  const text=await response.text();if(text.length>2_000_000)throw Error('RPC_BODY_LIMIT');
  const result=JSON.parse(text);if(result.error||result.id!==1||!Object.hasOwn(result,'result'))throw Error('RPC_INVALID_RESPONSE');
  return result.result;
}

// Bind already-fetched finalized/numeric headers by full identity. This is a
// provider-consistency check, not an independent proof of Ethereum consensus.
function blockIdentity(raw) {
  assert.ok(raw && typeof raw==='object' && !Array.isArray(raw),'MALFORMED_RPC_HEADER');
  const quantity=value=>{assert.match(value??'',/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/,'MALFORMED_RPC_HEADER_QUANTITY');return BigInt(value);};
  const hash=value=>{assert.match(value??'',/^0x[0-9a-fA-F]{64}$/,'MALFORMED_RPC_HEADER_HASH');return value.toLowerCase();};
  return {number:quantity(raw.number),hash:hash(raw.hash),parentHash:hash(raw.parentHash),timestamp:quantity(raw.timestamp),
    ...raw.gasLimit!==undefined?{gasLimit:quantity(raw.gasLimit)}:{}};
}
export function validateBlockIdentity(actual,expected,code='BLOCK_IDENTITY_MISMATCH') {
  const a=blockIdentity(actual),b=blockIdentity(expected);
  assert.ok(a.number===b.number&&a.hash===b.hash&&a.parentHash===b.parentHash&&a.timestamp===b.timestamp&&
    (a.gasLimit===undefined||b.gasLimit===undefined||a.gasLimit===b.gasLimit),code);
}

export async function runPreflight(addresses={}) {
  assert.equal(Boolean(addresses.vault),Boolean(addresses.payments),'BOTH_CONTRACT_ADDRESSES_REQUIRED');
  for(const address of Object.values(addresses))assert.match(address,/^0x[0-9a-fA-F]{40}$/);
  const heads=await Promise.all(PROVIDERS.map(async endpoint=>({endpoint,chainId:await rpc(endpoint,'eth_chainId',[]),
    finalized:await rpc(endpoint,'eth_getBlockByNumber',['finalized',false])})));
  for(const head of heads){assert.equal(head.chainId,'0x1');blockIdentity(head.finalized);}
  const height=heads.map(head=>BigInt(head.finalized.number)).reduce((a,b)=>a<b?a:b),tag='0x'+height.toString(16);
  const tokenAbi=new ethers.Interface(['function decimals() view returns(uint8)','function name() view returns(string)',
    'function symbol() view returns(string)','function totalSupply() view returns(uint256)']);
  const rows=[],headers=[];
  for(const {endpoint} of heads) {
    const header=await rpc(endpoint,'eth_getBlockByNumber',[tag,false]);
    const identity=blockIdentity(header);assert.equal(identity.number,height,'WRONG_RPC_BLOCK');
    for(const head of heads)if(BigInt(head.finalized.number)===height)validateBlockIdentity(header,head.finalized,'FINALIZED_HEADER_MISMATCH');
    headers.push(header);
    const code=await rpc(endpoint,'eth_getCode',[EXPECTED.token,tag]);
    const snapshot={chainId:1,address:EXPECTED.token,code};
    for(const name of ['decimals','name','symbol','totalSupply']) {
      const value=await rpc(endpoint,'eth_call',[{to:EXPECTED.token,data:tokenAbi.encodeFunctionData(name)},tag]);
      snapshot[name]=tokenAbi.decodeFunctionResult(name,value)[0].toString();
    }
    validateTokenSnapshot(snapshot);
    const row={endpoint,blockNumber:Number(height),blockHash:header.hash,blockTimestamp:Number(BigInt(header.timestamp)),token:snapshot};
    if(addresses.vault) {
      row.contracts={};
      for(const [key,name] of [['vault','EmbeoStakingVault'],['payments','EmbeoPayments']]) {
        const artifact=JSON.parse(readFileSync(resolve(root,'artifacts',name+'.json'),'utf8'));
        const expected=bindRuntime(artifact,EXPECTED),actual=await rpc(endpoint,'eth_getCode',[addresses[key],tag]);
        assert.equal(actual.toLowerCase(),expected.toLowerCase(),'DEPLOYED_RUNTIME_OR_IMMUTABLE_MISMATCH_'+name);
        const iface=new ethers.Interface(artifact.abi),getters=key==='vault'?['token','tokenCodeHash','tokenSupply','SHARE_SIZE']:['token','tokenCodeHash','tokenSupply','treasury'];
        const values={};
        for(const getter of getters){const result=await rpc(endpoint,'eth_call',[{to:addresses[key],data:iface.encodeFunctionData(getter)},tag]);values[getter]=iface.decodeFunctionResult(getter,result)[0].toString();}
        assert.equal(values.token.toLowerCase(),EXPECTED.token);assert.equal(values.tokenCodeHash,EXPECTED.tokenCodeHash);assert.equal(values.tokenSupply,EXPECTED.tokenSupply);
        if(key==='vault')assert.equal(values.SHARE_SIZE,EXPECTED.shareSize);else assert.equal(values.treasury.toLowerCase(),EXPECTED.treasury.toLowerCase());
        row.contracts[key]={address:addresses[key],runtimeKeccak256:ethers.keccak256(actual),runtimeExactMatch:true,values};
      }
    }
    rows.push(row);
  }
  validateBlockIdentity(headers[0],headers[1],'CROSS_PROVIDER_BLOCK_MISMATCH');
  const result={schema:'imd.world.economy-mainnet-readonly-preflight/v1',recordedAt:new Date().toISOString(),
    status:addresses.vault?'DEPLOYED_IMMUTABLE_RUNTIME_READBACK_VERIFIED':'TOKEN_PREFLIGHT_ONLY_NO_DEPLOYED_CONTRACT_VERIFIED',
    publicChainWrites:false,productionReady:false,requiresIndependentSwarmApproval:true,rows};
  writeFileSync(resolve(root,'evidence',addresses.vault?'deployed-readonly-preflight.json':'token-readonly-preflight.json'),JSON.stringify(result,null,2)+'\n');
  return result;
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const addresses={};
  for(const arg of process.argv.slice(2)) {
    const match=/^--(vault|payments)=(0x[0-9a-fA-F]{40})$/.exec(arg);if(!match||addresses[match[1]])throw Error('ONLY_EXPLICIT_CONTRACT_ADDRESSES_ACCEPTED');
    addresses[match[1]]=match[2];
  }
  const result=await runPreflight(addresses);
  console.log(JSON.stringify({status:result.status,blockNumber:result.rows[0].blockNumber,blockHash:result.rows[0].blockHash,publicChainWrites:false}));
}
