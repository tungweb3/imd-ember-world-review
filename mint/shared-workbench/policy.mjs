import {FIXED_SKIN,assertClothingCompatibility} from './appearance.mjs';
export const MAX_SUPPLY=2222,PROPOSED_PRICE_ATOMIC=300000n*10n**18n;
export const walletPattern=/^0x[0-9a-fA-F]{40}$/;
export function snapshotWallets(rows){
  const wallets=new Set();
  for(const row of rows){if(!walletPattern.test(row.wallet)||/^0x0{40}$/i.test(row.wallet)||!Number.isSafeInteger(row.activeAgentCount)||row.activeAgentCount<0)throw Error('SNAPSHOT_ROW_INVALID');if(row.activeAgentCount>=1)wallets.add(row.wallet.toLowerCase());}
  if(wallets.size>MAX_SUPPLY)throw Error('FREE_ELIGIBILITY_EXCEEDS_2222');
  return [...wallets].sort();
}
/** No NFT/IMD token id, wallet, mint time or metadata URL is part of a composed appearance. */
export function canonicalAppearance(selection){
  if(!selection||typeof selection!=='object'||Array.isArray(selection))throw Error('APPEARANCE_INVALID');
  const fields=Object.keys(selection).sort(),required=['body','bottom','hat','shoes','skin','top'];
  if(fields.length!==required.length||fields.some((key,i)=>key!==required[i]))throw Error('APPEARANCE_INVALID');
  if(selection.skin!==FIXED_SKIN)throw Error('SKIN_MUST_BE_GREEN');
  assertClothingCompatibility(selection);
  return JSON.stringify(fields.map(key=>{if(typeof selection[key]!=='string'||!/^[a-z0-9][a-z0-9_-]*$/.test(selection[key]))throw Error('APPEARANCE_INVALID');return [key,selection[key]];}));
}
export const displayName=id=>{if(!Number.isSafeInteger(id)||id<1||id>MAX_SUPPLY)throw Error('TOKEN_ID_INVALID');return 'Ember Evo '+id;};
