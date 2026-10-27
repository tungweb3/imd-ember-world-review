import type {GoldOrder,GoldState} from './worldGoldClient.ts';
import type {EconomyWalletState} from './economyWallet.ts';
export function topupProducts(products:GoldState['products']){
 return products.filter(p=>p.enabled&&p.kind==='topup'&&/^[1-9][0-9]{0,18}$/.test(p.gold)&&typeof p.embeo==='string'&&/^[1-9][0-9]{0,77}$/.test(p.embeo)).sort((a,b)=>BigInt(a.gold)<BigInt(b.gold)?-1:BigInt(a.gold)>BigInt(b.gold)?1:a.product.localeCompare(b.product));
}
/** A mined wallet receipt is not ledger credit. Never show success based on a hash, provider receipt or aggregate
 * balance change alone: only the server's book (finalized payment, or its verified fast credit) says credited. */
export function purchaseStage(order:GoldOrder|null,wallet:Pick<EconomyWalletState,'phase'|'step'|'plan'>,now:number){
 if(!order)return 'choose';
 const booked=order.status==='paid'||order.fastCredit==='credited'||order.fastCredit==='settled';
 if(booked&&typeof order.creditedGold==='string'&&/^(0|[1-9][0-9]*)$/.test(order.creditedGold)&&BigInt(order.creditedGold)>=BigInt(order.gold))return 'credited';
 const same=wallet.plan?.kind==='pay'&&wallet.plan.payment.orderId===order.id;
 if(order.status==='paid'||same&&wallet.phase==='confirmed'&&wallet.step==='execute')return 'awaiting-credit';
 if(['sending','pending','unknown','checking'].includes(wallet.phase))return 'pending';
 if(order.expires_ms<=now)return 'expired';
 if(same&&['approve-required','reset-required'].includes(wallet.phase))return 'approve';
 if(same&&wallet.phase==='confirm')return 'confirm';
 return 'review';
}
export function goldPurchaseError(code:string,zh:boolean){
 const copy:Record<string,[string,string]>={
  CHAIN_MISMATCH:['請先在錢包切換至 Ethereum 主網，再核對原單。','Switch your wallet to Ethereum mainnet, then review the original order.'],
  USER_REJECTED:['已取消錢包確認，尚未完成本筆付款。','Wallet confirmation cancelled. This payment is not completed.'],
  INSUFFICIENT_EMBEO:['錢包的 EMBEO 不足，請確認餘額。','Insufficient EMBEO. Check your wallet balance.'],
  AUTH_REQUIRED:['請確認已登入 World，且錢包已解鎖、連接的是登入的那個帳號（在「我的錢包」可以選擇與連接）。','Make sure you are signed in to World and your wallet is unlocked and connected with the signed-in account (choose and connect it under My wallet).'],
  ACCOUNT_MISMATCH:['錢包與登入帳號不同，請重新登入並核對。','Your wallet differs from the signed-in account. Sign in again and review.'],
  CONTEXT_CHANGED:['錢包或登入狀態已變更，請重新核對原單。','Wallet or session changed. Review the original order again.'],
  PENDING_TRANSACTION:['原交易仍待確認，請查詢原交易，不要重複付款。','An original transaction is unresolved. Check it; do not pay again.'],
  ORDER_ALREADY_PAID:['鏈上顯示原單已付款，請查詢原單入帳。','The original order is already paid on chain. Check its ledger credit.'],
  ORDER_EXPIRED:['報價已到期；若已送出交易，請查詢原單。','Quote expired. If a transaction was sent, check the original order.'],
  FEATURE_PAUSED:['目前暫停新購點，原交易仍會核對入帳。','New purchases are paused. Original payments are still reconciled.'],
  TERMS_REQUIRED:['請先閱讀並勾選同意通行證條款，再簽名確認。','Read and accept the pass terms before signing.'],
  PASS_ALREADY_ACTIVE:['每日通行證仍在有效期間，到期後才能再次購買。','Your day pass is still active. You can buy another after it ends.'],
  PASS_ORDER_PENDING:['已有一筆待付款的通行證訂單，請先完成，或等它到期（約 15 分鐘）再重新下單。','You already have a pending pass order. Finish it, or wait for it to expire (about 15 minutes) before ordering again.'],
  TRANSACTION_REVERTED:['鏈上交易失敗，請核對原交易；鏈上手續費仍可能產生。','Transaction reverted. Check the original transaction; network fees may still apply.'],
  REQUEST_TIMEOUT:['錢包回覆逾時，請先核對原交易，勿重複付款。','Wallet response timed out. Check the original transaction before retrying.'],
  // Codes that used to fall through to the generic "reference code" line.
  INVALID_GOLD_CHALLENGE:['付款確認訊息的時間和這台裝置的時鐘對不上。請把電腦或手機的時間設為自動同步，再重新核對原單。','The payment message time does not match this device clock. Set your device time to sync automatically, then review the order again.'],
  CHALLENGE_EXPIRED:['付款確認已逾時（5 分鐘），請重新按簽名確認。尚未扣點。','The payment confirmation expired (5 minutes). Sign again; nothing was charged.'],
  INSUFFICIENT_GOLD:['GOLD 不足，請先購點再付款。','Not enough GOLD. Buy GOLD first, then pay.'],
  ECONOMY_HALTED:['帳本暫停中，暫時不能付款；已付款項目不受影響。','The ledger is paused; payments are not possible right now. Completed payments are unaffected.'],
  NOT_CONFIGURED:['錢包付款設定尚未載入，請按「更新餘額與狀態」後再試。','Payment settings are not loaded yet. Press "Refresh ledger", then try again.'],
  INVALID_CHAIN_RESPONSE:['錢包回傳的資料格式不正確，尚未送出交易。請重新整理頁面後再試；若一再出現，請告訴站方。','The wallet returned data in an unexpected format; nothing was sent. Reload the page and try again; tell us if it keeps happening.'],
  WALLET_TIMEOUT:['錢包一直沒有回應，已停止等待，尚未扣點。請打開錢包取消待處理的請求後再試。','The wallet did not answer, so the request was dropped; nothing was charged. Open your wallet, cancel any pending request, and try again.'],
  RATE_LIMITED:['操作太頻繁，請等一分鐘再試。','Too many requests. Wait a minute and try again.'],
  INVALID_SIGNATURE:['錢包回傳的簽名格式不正確，尚未扣點，請再試一次。','The wallet returned an invalid signature; nothing was charged. Try again.'],
 };
 return copy[code]?.[zh?0:1]??(zh?'目前無法完成，請更新原單狀態後再試。參考代碼：':'Unable to complete. Refresh the original order before retrying. Reference: ')+code;
}
