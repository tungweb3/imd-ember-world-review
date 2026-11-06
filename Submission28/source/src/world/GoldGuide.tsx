import './celestaoGateway.css';

/** Public explanation of GOLD for players arriving from partner sites (鼠道修仙, 玄曜).
 * Plain text and one link into World: no sign-in, wallet call, order or tracking on this page.
 * Wording follows the World GOLD panel and the staking hall; change them together. */
export const GOLD_GUIDE={
 zh:{what:'GOLD 是 IMD Ember World 的站內點數，用來支付 World 和合作網站的服務，例如玄曜的命理解讀、鼠道修仙的外觀。',
  limits:'GOLD 綁定你的錢包，World 和合作網站共用同一份餘額。不可轉讓、不可賣出，也不能兌回 EMBEO。用 GOLD 付款沒有手續費。',
  buy:'用 EMBEO 購買：100 EMBEO 換 1 GOLD，在以太坊主網付款，鏈上手續費另計，以錢包顯示為準。付款完成後約 15 分鐘入帳。購買是單向的，GOLD 不能換回 EMBEO。',
  stake:'質押 EMBEO：在 World 的質押挖礦館質押 EMBEO，每天可以得到 GOLD，份量和規則以館內說明為準。本金可隨時取回。',
  first:'第一次使用：需要一個瀏覽器錢包（例如 MetaMask）。在 World 用錢包登入時，你會簽一段登入訊息，這不花錢也不轉移資產。之後每一筆 GOLD 付款，都會再請你在 World 核對金額並簽名確認。',
  free:'鼠道修仙不需要 GOLD 也能完整遊玩；GOLD 只用來買外觀。'},
 en:{what:'GOLD is the points currency of IMD Ember World. It pays for services in World and on partner sites, such as Celestial Atlas readings and Squeek Ascension cosmetics.',
  limits:'GOLD is bound to your wallet, and World and its partner sites share one balance. It cannot be transferred, sold or redeemed for EMBEO. Paying with GOLD has no fee.',
  buy:'Buy with EMBEO: 100 EMBEO for 1 GOLD, paid on Ethereum mainnet. Network fees are separate and shown by your wallet. GOLD is credited about 15 minutes after payment. A purchase is one-way: GOLD cannot be changed back into EMBEO.',
  stake:'Stake EMBEO: staking EMBEO in the World Staking Hall earns GOLD every day; the amounts and rules are shown in the hall. You can withdraw your principal at any time.',
  first:'First time: you need a browser wallet such as MetaMask. Signing in to World asks you to sign a sign-in message, which costs nothing and moves no assets. Every GOLD payment then asks you to check the amount in World and sign it.',
  free:'Squeek Ascension is fully playable without GOLD; GOLD only buys cosmetics.'}
} as const;
export default function GoldGuide(){
 const zh=new URLSearchParams(location.search).get('lang')!=='en',g=zh?GOLD_GUIDE.zh:GOLD_GUIDE.en,say=(a:string,b:string)=>zh?a:b;
 return <main className="celestao-gateway-page" lang={zh?'zh-Hant':'en'}><section className="celestao-gateway" aria-labelledby="gold-guide-title">
  <p className="celestao-gateway-brand">IMD Ember World</p>
  <h1 id="gold-guide-title">{say('什麼是 GOLD？','What is GOLD?')}</h1>
  <p>{g.what}</p><p>{g.limits}</p>
  <h2>{say('怎麼取得','How to get it')}</h2><p>{g.buy}</p><p>{g.stake}</p>
  <h2>{say('第一次使用','Getting started')}</h2><p>{g.first}</p>
  <p className="celestao-gateway-note">{g.free}</p>
  <a className="celestao-gateway-primary" href="/?open=gold">{say('進入 World 購買 GOLD','Open World to buy GOLD')}</a>
  <p className="celestao-gateway-note"><a href={zh?'/gold/?lang=en':'/gold/?lang=zh'}>{zh?'English':'繁體中文'}</a></p>
 </section></main>;
}
