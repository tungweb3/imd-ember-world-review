import {createContext,useContext,useEffect,useState,type ReactNode} from 'react';

export type Language='en'|'zh';
// Interface copy only. Public agent names, IDs and records stay as published.
export const EN:Record<string,string>={
  '網路摘要':'Network summary','Agent 名冊':'Agent registry','近期工作':'Recent jobs','共識紀錄':'Consensus records','公開作品':'Public works','發布紀錄':'Launch records',
  '尚未取得':'Not fetched','未提供':'Not provided','工作中':'Working','上線':'Online','未在連線名冊':'Not in connected roster','狀態待確認':'Status unknown',
  '已取得公開資料':'Public data received','顯示上次資料 · 目前無法更新':'Cached data · refresh unavailable','目前無法取得資料':'Data unavailable',
  '以下為近期紀錄，並非歷史總數。':'Recent records, rather than lifetime totals.',
  '世界仍可探索，連線恢復後會重新更新。':'You can keep exploring. Data will refresh when the connection returns.',
  '這次回傳沒有紀錄。':'No records in this response.','已簽署共識':'Signed consensus','查看公開資料來源 ↗':'View public source ↗',
  '無法啟動 3D 場景，請使用支援 WebGL 的瀏覽器。Agent 名冊仍可查看。':'The 3D scene could not start. Use a WebGL browser. The agent registry is still available.',
  '測試資料（非 IMD 實況）':'Test data (not live IMD)',
  '重新讀取公開資料':'Refresh public data','網路狀態':'Network status','操作說明':'World guide','探索工具':'Exploration tools',
  '尋找 Agent':'Find an agent','地圖':'Map','回廣場':'Plaza','拉近鏡頭':'Zoom in','拉遠鏡頭':'Zoom out',
  '移動搖桿':'Movement joystick','移動':'Move','關閉地圖':'Close map','城市地圖':'City map','關閉面板':'Close panel',
  '全體連線名冊隨 IMD 更新。每位守印者都有住處，新加入的成員會自動進入世界。':'The connected roster updates with IMD. Every guardian has a home, and new members join the world automatically.',
  '搜尋 Agent':'Search agents','席位 #、Agent ID、錢包、Codex…':'Seat #, Agent ID, wallet, Codex…','定位確切 Agent':'Locate exact agent','尋找':'Find','全部記錄':'All records',
  '位符合 · 完整記錄':'matches · total records','位':'agents','每 15 分鐘更新':'Updates every 15 minutes','Explorer 活動':'Explorer activity','快取 · 上線狀態待確認':'Cached · online status unknown','連線狀態待確認':'Connection status unknown',
  '正在讀取全體名冊…':'Loading the full roster…','目前無法確認上線狀態，可改看全部記錄或重新整理。':'Online status is unavailable. Try All records or refresh.',
  '沒有符合的守印者。可切換「全部記錄」查看離線成員。':'No matching guardians. Select All records to include disconnected members.',
  '未知':'Unknown','環境未知':'Unknown runtime','上一頁':'Previous','下一頁':'Next',
  '分頁只影響清單顯示。所有取得的 Agent 均可搜尋與定位，場景沒有名冊人數上限。':'All retrieved agents can be searched and located. Pagination only affects the list; the world has no roster cap.',
  '觀測之印':'Seal of Observation','行動之印':'Seal of Action','世界中的特色守印者':'Featured guardians of this world','· 世界中的特色守印者':' · Featured guardians of this world',
  '這個角色對應 IMD 席位 #':'This guardian represents IMD seat #','。活動和工作姿態依公開連線資料更新。':'. Activity and working poses follow public connection data.',
  '席位 Token ID':'Seat Token ID','執行環境':'Runtime','模型':'Model','Worker 版本':'Worker version','連線装置':'Connected devices','錢包':'Wallet','最後心跳':'Last heartbeat',
  '通過提交':'Accepted submissions','失敗':'Failed','待驗證':'Pending verification','統計來源：網路摘要':'Stats source: network summary','（快取）':'(cached)',
  '。席位不等於 ERC-8004 Agent ID；提交通過不等於 Oracle 簽署。':'. A seat is distinct from an ERC-8004 Agent ID. An accepted submission is distinct from an Oracle signature.',
  '走近這位守印者':'Visit this guardian','在 IMD 查看此席位 ↗':'View this seat on IMD ↗','席位的近期工作':'Recent work for this seat',
  '席位詳情暫不可用，名冊仍可查看。':'Seat details are unavailable. The registry is still available.','正在讀取席位詳情…':'Loading seat details…',
  '公開詳情':'Public details','上次詳情':'Cached details','暫不可用':'Unavailable','此為示範角色，沒有真實工作紀錄。':'This demo guardian has no real work records.','這次未提供工作紀錄。':'No work records were provided.',
  '前往':'Travel to ','世界的脈動':'Pulse of the world','網路回報上線':'Reported online','已取得上線席位':'Enumerated connected seats','連線裝置樣本':'Connected device sample',
  '名冊完整性':'Roster completeness','完整回傳':'Complete response','待確認':'Unknown','歷史／当前記錄':'Historical / current records','24h 通過提交':'24h accepted submissions',
  '24h Oracle 結果':'24h Oracle results','摘要中的上線發布':'Live launches in summary','摘要中的網站':'Sites in summary',
  '網路摘要與連線名冊分別取樣，數字可能有時間或覆蓋差異。未綁定席位的裝置':'Summary and roster are sampled separately, so timing and coverage can differ. Devices without a seat:',
  '台。已鑄造席位不直接視為上線 Agent。':'. A minted seat alone does not indicate a connected agent.',
  '資料來源':'Data sources','已更新':'Updated','快取':'Cached','無法取得':'Unavailable','讀取中…':'Loading…','重新整理公開資料':'Refresh public data',
  '位守印者已取得記錄。住處會隨著名冊擴展，已分配的位置保持固定。':'guardians have records. Homes grow with the roster, while assigned locations stay fixed.',
  '打開全體名冊':'Open full registry','守印者 #':'Guardian #','尚未開啟的記憶':'Memories yet to unfold','未來會從這裡延伸這款新遊戲的探索故事。':'Future exploration stories will begin here.',
  '如何探索':'How to explore','電腦移動':'Desktop movement','WASD / 方向鍵':'WASD / arrow keys','沿路行走':'Walk to a point','點地面':'Click the ground',
  '環繞鏡頭':'Orbit camera','拖曳畫面':'Drag the scene','拉近／拉遠':'Zoom','滾輪或 + / −':'Scroll wheel or + / −','查看附近':'Inspect nearby','E / 點建築與角色':'E / select a building or guardian',
  '手機移動':'Mobile movement','左下搖桿':'Bottom-left joystick','手機鏡頭':'Mobile camera','右側拖曳 / 雙指縮放':'Drag on the right / pinch to zoom',
  '資料模式':'Data mode','實況模式讀取 IMD 公開資料。斷線時保留已知記錄，狀態標示待確認；示範模式的數字與活動都不代表真實網路。':'Live mode reads public IMD data. Known records are retained during outages, with status marked unknown. Demo numbers and activities do not represent the real network.',
  'IMD 實況':'Live IMD','示範世界':'Demo world','目前的模型':'World models',
  '建築與角色使用可替換的程序化模型。接下來會依參考圖製作 Tripo 模型，經 Blender 整理後逐件放入世界。':'The world combines authored architecture with generated 3D assets. Scene props are added individually as they are ready.',
  'IMD Town 參考 ↗':'IMD Town reference ↗','IMD 官方文件 ↗':'Official IMD documentation ↗',
  // Hover and tap feedback (onboarding 06): the chip's kind word, verb and names, and the once-a-session tap note.
  '點擊查看':'Click to open','點擊前往':'Click to go','地標':'Landmark','觀測站':'Observatory','住家':'Home','守印者':'Guardian','空地':'Free lot',
  '蜂群觀測站':'Swarm Observatory','這塊空地':'This lot','這裡沒有東西可看 · 找發光的東西':'Nothing to open here · look for things that glow',
  // The Explore checklist (onboarding 10): the pill, its list, the Map's checks and the 7-of-7 toast.
  '探索':'Explore','探索清單':'Explore checklist','燼渡探索':'Explore Emberford','點一列就帶你過去，到了自動打開介紹':'Pick one to go there · it opens when you arrive',
  '前往 →':'Go →','再看 →':'See again →','已看過':'Visited','（已看過）':' (visited)','加碼':'Bonus','不計':'not counted','關閉清單':'Close list',
  '燼渡全部走過了！':'You’ve explored all of Emberford!',
  // Beacon tags (onboarding 04) and the hint (08).
  '會發光、可以點的地方':'Glowing places you can open','Pepe 與大螢幕':'Pepe’s screen','即時行情、天空為什麼變色':'The live market, and why the sky changes color',
  '認識一位真實的 Agent':'Meet a real agent','Pepe 的大螢幕':'Pepe’s screen',
  '點會發光的人或建築查看 · WASD 走路 · 拖曳轉視角 · 滾輪縮放':'Click anyone or anything that glows · WASD to walk · drag to turn · scroll to zoom',
  '點發光的東西查看 · 左下搖桿走路 · 雙指縮放':'Tap what glows · joystick to walk · pinch to zoom','點發光的東西查看 · 點地面走路 · 雙指縮放':'Tap what glows · tap the ground to walk · pinch to zoom',
  // The first-run strip (onboarding 02), the where-to-start pill, the guide's replay and the literal subtitle.
  '這是 IMD Agent 網路的即時小鎮':'A live town of the IMD agent network','每個小人都是一位真實的 Agent · 會發光的東西都能點':'Every figure is a real agent · anything that glows can be clicked',
  '從 Pepe 的大螢幕開始 →':'Start with Pepe’s screen →','自己逛逛':'Look around','從哪開始？':'Where to start?','重看開場':'Replay the intro',
  'IMD Agent 網路的即時 3D 世界':'The IMD agent network, live in 3D'
};
const Context=createContext<{language:Language;setLanguage:(v:Language)=>void}>({language:'en',setLanguage:()=>{}});
function initialLanguage():Language {
  const param=new URLSearchParams(location.search).get('lang');
  if(param==='en'||param==='zh')return param;
  try{return localStorage.getItem('ember-world-language')==='zh'?'zh':'en';}catch{return 'en';}
}
export function LanguageProvider({children}:{children:ReactNode}) {
  const [language,setLanguage]=useState<Language>(initialLanguage);
  useEffect(()=>{document.documentElement.lang=language==='zh'?'zh-Hant':'en';try{localStorage.setItem('ember-world-language',language);}catch{/* preference is optional */}},[language]);
  return <Context.Provider value={{language,setLanguage}}>{children}</Context.Provider>;
}
export function useWorldText(){
  const {language,setLanguage}=useContext(Context),zh=language==='zh',locale=zh?'zh-TW':'en-US';
  const t=(cn:string)=>zh?cn:EN[cn]??cn;
  return {language,setLanguage,zh,locale,t,text:(cn:string,en:string)=>zh?cn:en,
    date:(n:number|null|undefined)=>n?new Date(n).toLocaleTimeString(locale,{hour:'2-digit',minute:'2-digit',second:'2-digit'}):t('尚未取得'),
    short:(s:string|null)=>s&&s.length>18?s.slice(0,8)+'…'+s.slice(-6):s??t('未提供'),
    presence:(p:string,working:boolean|null)=>t(p==='online'?(working?'工作中':'上線'):p==='offline'?'未在連線名冊':'狀態待確認')};
}
