(function initializeLanguageCore(global) {
  const SIMPLIFIED_ONLY = /[这为发后个们来时国会说对与业东两产从众优传价体余侧儿关兴养写军农冲决况冻净击刘则刚创别删动务势华协单卖卢卫却厂历压县变叶号叹听启吴员问间队阳阴际陈陆张强录径彻忆怀态总恶惊爱戏战户扫扩担拟拥择挂挤挥损换据无旧术机杀杂权条极构枪柜标样楼欢岁归毕气汇汉汤沟没泽洁济浓测浏涂渐渔湾湿灭灯灵灾灿炉点炼热爷牵犹独狭狮现环电画疗监盘矿码砖礼离种积称稳窝竞笔笼签简类粮纠纪约级纤练组细终经结给绝统继绩绪续维绿网罗罚职联聪肃肠肤肾胆胜胶脉脏脑脚脱脸腊舰艺节范茧荐药获莲营萨虑虚虫虽蚀蚁补装见观规觉览触誉计认让议讯记讲许论讼设访证评识诈诉诊词译试诗诚话诞询该详语误诱说请诸诺读课谁调谈谊谋谢谣贫货贩贪贯责账购质贺赁资赋赌赏赔赖赚赛赵赶趋跃践车轨转轮软轰轻载较辅辆辈辉边辽达迁过迈运还进远违连迟适选递逻遗邮邻郑释鉴针钟钢钥钦钩钱钻铁铃铜铝铭银铺链销锁锅锋锐错锦键锻镇镜长门闭问闯闲闻阁阅阔队阳际陈险随隐难雾静顶顺须顾顿颁预领颇频题颜额风飞饭饮馆马驯驰驱驶骂骄验骑骗骚鱼鲁鲜鸟鸡鸭麦黄齐齿龙]/u;
  const TRADITIONAL_ONLY = /[這為發後裡個們來時國會說對與業東兩產從眾優傳價體餘側兒關興養寫軍農衝決況凍淨擊劉則剛創別刪動務勢華協單賣盧衛卻廠歷壓縣變葉號嘆聽啟吳員問間隊陽陰際陳陸張強錄徑徹憶懷態總惡驚愛戲戰戶掃擴擔擬擁擇掛擠揮損換據無舊術機殺雜權條極構槍櫃標樣樓歡歲歸畢氣匯漢湯溝沒澤潔濟濃測瀏塗漸漁灣濕滅燈靈災燦爐點煉熱爺牽猶獨狹獅現環電畫療監盤著礦碼磚禮離種積稱穩窩競筆籠簽簡類糧糾紀約級纖練組細終經結給絕統繼績緒續維綠網羅罰職聯聰肅腸膚腎膽勝膠脈臟腦腳脫臉臘艦藝節範繭薦藥獲蓮營薩慮虛蟲雖蝕蟻補裝見觀規覺覽觸譽計認讓議訊記講許論訟設訪證評識詐訴診詞譯試詩誠話誕詢該詳語誤誘說請諸諾讀課誰調談誼謀謝謠貧貨販貪貫責賬購質賀賃資賦賭賞賠賴賺賽趙趕趨躍踐車軌轉輪軟轟輕載較輔輛輩輝邊遼達遷過邁運還進遠違連遲適選遞邏遺郵鄰鄭釋裡鑒針鐘鋼鑰欽鉤錢鑽鐵鈴銅鋁銘銀鋪鏈銷鎖鍋鋒銳錯錦鍵鍛鎮鏡長門閉問闖閒聞閣閱闊隊陽際陳險隨隱難霧靜頂順須顧頓頒預領頗頻題顏額風飛飯飲館馬馴馳驅駛罵驕驗騎騙騷魚魯鮮鳥雞鴨麥黃齊齒龍]/u;
  // 同一組字元的全域版本，用來數「寫錯字體的字有幾個」，
  // 而不是只問「有沒有出現過」。
  const SIMPLIFIED_ONLY_ALL = new RegExp(SIMPLIFIED_ONLY.source, "gu");
  const TRADITIONAL_ONLY_ALL = new RegExp(TRADITIONAL_ONLY.source, "gu");

  function isAlreadyTargetLanguage(text, targetLanguage) {
    const value = String(text ?? "").trim();
    if (!value) return false;
    const letters = value.match(/\p{L}/gu) ?? [];
    const han = value.match(/\p{Script=Han}/gu) ?? [];
    const target = String(targetLanguage ?? "");
    if (target === "zh-Hant" || target === "zh-Hans") {
      if (han.length < 2 || han.length / Math.max(1, letters.length) < 0.45) return false;
      return target === "zh-Hant" ? !SIMPLIFIED_ONLY.test(value) : !TRADITIONAL_ONLY.test(value);
    }
    if (target === "ja") return /[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(value);
    if (target === "ko") return /\p{Script=Hangul}/u.test(value);
    if (target === "th") return /\p{Script=Thai}/u.test(value);
    if (target === "en") {
      const latin = value.match(/\p{Script=Latin}/gu) ?? [];
      return latin.length >= 2 && latin.length / Math.max(1, letters.length) >= 0.7;
    }
    return false;
  }

  // Result validation needs to accept a natural translation that contains
  // names, acronyms, URLs, numbers, or product codes. The stricter
  // isAlreadyTargetLanguage check is intentionally conservative because it is
  // also used to decide whether page text should be skipped. A translation
  // result is different: a small amount of target-script text is enough as
  // long as the result is not clearly written in the opposite Chinese script.
  function hasTargetLanguageSignal(text, targetLanguage) {
    const value = String(text ?? "").trim();
    if (!value) return false;
    const target = String(targetLanguage ?? "");
    if (target === "zh-Hant" || target === "zh-Hans") {
      const letters = value.match(/\p{L}/gu) ?? [];
      const han = value.match(/\p{Script=Han}/gu) ?? [];
      if (han.length < 2 || han.length / Math.max(1, letters.length) < 0.2) return false;
      // 一兩個異體字不足以判定整段寫錯了字體。人名音譯（克里斯、瑪麗）和引用
      // 原文都會夾帶這種字，用「出現過就否決」會把好譯文整段丟掉，使用者只會
      // 看到「翻譯結果不是設定的目標語言」這種假錯誤，還白白多打一次 API。
      // 真的整段用錯字體時，比例遠高於這個門檻。
      const wrongScript = target === "zh-Hant"
        ? (value.match(SIMPLIFIED_ONLY_ALL) ?? []).length
        : (value.match(TRADITIONAL_ONLY_ALL) ?? []).length;
      return wrongScript <= Math.max(1, Math.floor(han.length * 0.05));
    }
    if (target === "ja") return /[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(value);
    if (target === "ko") return /\p{Script=Hangul}/u.test(value);
    if (target === "th") return /\p{Script=Thai}/u.test(value);
    if (target === "en") {
      const letters = value.match(/\p{L}/gu) ?? [];
      const latin = value.match(/\p{Script=Latin}/gu) ?? [];
      return latin.length >= 2 && latin.length / Math.max(1, letters.length) >= 0.5;
    }
    return false;
  }

  const languageCore = Object.freeze({ isAlreadyTargetLanguage, hasTargetLanguageSignal });
  global.ImmerseFreeLanguage = languageCore;
})(globalThis);
