(function initializeGlossaryPresets(global) {
  // ImmerseFree 預設術語庫（en → zh-Hant，台灣慣用譯法）。
  //
  // ── 內容來源與授權（重要，不要刪這一段）────────────────────────
  //
  // 這份清單是本專案**自行撰寫**的。每一條都是「英文專業詞彙 ↔ 台灣通行中文
  // 說法」這種常識性對譯：教科書、政府公文、法規、健保與證交所文件、
  // 中文技術社群長年就是這樣講，屬於公有領域的事實對應，不是任何人的著作。
  //
  // **沒有**從沈浸式翻譯、任何商業翻譯外掛、任何線上詞庫、任何第三方
  // glossary 檔案抄錄過條目、條目組合或排列順序。研究階段已經確認：
  // 市面上（含對手產品與其社群）查無任何可下載的術語庫檔案可抄，
  // 所以這裡的每一條都是逐條寫出來的，選詞標準只有兩條：
  //   1. 這個詞在該領域的中英對照文件裡真的會出現（不是為了湊數的生僻詞）
  //   2. 譯法在台灣是通行說法（不用中國大陸用語，例如用「軟體」不用「軟件」）
  //
  // 刻意只收「有中文譯法可寫」的詞。像 Kubernetes、Python 這種台灣人本來就
  // 直接講原文的，收進來只會逼模型硬翻，反而更糟——所以全部 target 都是純
  // 中文字，沒有半個英文字母，這一點有測試守著（tests/glossary.test.cjs）。
  //
  // ── 資料格式 ─────────────────────────────────────────────
  // 每條三個欄位：source（英文原詞）／target（固定譯法）／domain（領域）。
  // 同一個英文詞可以在不同領域各有一條（例如 depression 在財經是「經濟蕭條」、
  // 在醫療是「憂鬱症」），所以唯一性判準是 source + domain，不是 source。
  //
  // 用途：使用者在選項頁勾選領域後，翻譯網頁／PDF／劃詞時，**只有本批文字
  // 真的出現過的詞**會被塞進 prompt（沿用字幕層的 matchTerms 語意），不是整本
  // 字典。優先序最低：使用者的全域釘選、影片內編輯、自動分析都蓋得過它。

  const PRESET_LANGUAGES = Object.freeze({ source: "en", target: "zh-Hant" });

  const DOMAIN_IDS = Object.freeze(["tech", "finance", "medical"]);

  const DOMAIN_LABELS = Object.freeze({
    tech: "科技與軟體",
    finance: "財經與投資",
    medical: "醫療與生技"
  });

  // 用「一行一條、直線分隔」而不是幾百個 JSON 物件：同樣的內容少三倍字元，
  // 而且新增一條就是加一行，看 diff 一眼就知道改了什麼。
  const TECH = `
API|應用程式介面
cache|快取
token|權杖
repository|儲存庫
commit|提交
branch|分支
merge|合併
pull request|拉取請求
deploy|部署
build|建置
compile|編譯
debug|除錯
breakpoint|中斷點
stack trace|堆疊追蹤
exception|例外
thread|執行緒
process|程序
concurrency|並行
parallelism|平行
deadlock|死結
race condition|競爭條件
mutex|互斥鎖
semaphore|號誌
queue|佇列
stack|堆疊
heap|堆積
array|陣列
linked list|鏈結串列
hash table|雜湊表
binary tree|二元樹
algorithm|演算法
complexity|複雜度
recursion|遞迴
iteration|疊代
pointer|指標
reference|參考
garbage collection|垃圾回收
memory leak|記憶體洩漏
buffer|緩衝區
bandwidth|頻寬
latency|延遲
throughput|吞吐量
load balancer|負載平衡器
proxy|代理伺服器
firewall|防火牆
router|路由器
gateway|閘道
protocol|通訊協定
packet|封包
socket|通訊端
port|通訊埠
domain name|網域名稱
subnet|子網路
encryption|加密
decryption|解密
hash|雜湊
signature|簽章
certificate|憑證
authentication|身分驗證
authorization|授權
vulnerability|弱點
patch|修補程式
malware|惡意程式
phishing|網路釣魚
backdoor|後門
sandbox|沙箱
container|容器
image|映像檔
virtual machine|虛擬機器
hypervisor|虛擬機器監視器
cluster|叢集
node|節點
scaling|擴充
replica|複本
shard|分片
index|索引
query|查詢
schema|綱要
transaction|交易
rollback|回復
migration|遷移
backup|備份
restore|還原
snapshot|快照
monitoring|監控
alert|警示
dashboard|儀表板
metric|指標
pipeline|管線
workflow|工作流程
dependency|相依性
package|套件
library|函式庫
framework|框架
module|模組
plugin|外掛
extension|擴充功能
compiler|編譯器
interpreter|直譯器
runtime|執行環境
syntax|語法
semantics|語意
variable|變數
constant|常數
function|函式
parameter|參數
argument|引數
return value|回傳值
scope|作用域
closure|閉包
callback|回呼
asynchronous|非同步
synchronous|同步
event loop|事件迴圈
middleware|中介軟體
endpoint|端點
request|請求
response|回應
header|標頭
payload|酬載
status code|狀態碼
timeout|逾時
retry|重試
throttling|節流
rate limit|速率限制
idempotent|冪等
stateless|無狀態
session|工作階段
credential|憑證資料
password|密碼
privilege|權限
role|角色
audit|稽核
compliance|法規遵循
encryption key|加密金鑰
checksum|總和檢查碼
compression|壓縮
serialization|序列化
parsing|剖析
regular expression|正規表示式
string|字串
integer|整數
floating point|浮點數
boolean|布林值
object|物件
class|類別
instance|實例
inheritance|繼承
polymorphism|多型
encapsulation|封裝
abstraction|抽象化
interface|介面
refactoring|重構
code review|程式碼審查
unit test|單元測試
integration test|整合測試
regression test|迴歸測試
coverage|涵蓋率
continuous integration|持續整合
continuous delivery|持續交付
version control|版本控制
conflict|衝突
fork|分叉
issue|議題
milestone|里程碑
sprint|衝刺
backlog|待辦清單
machine learning|機器學習
deep learning|深度學習
neural network|類神經網路
training|訓練
inference|推論
overfitting|過度擬合
gradient descent|梯度下降
fine-tuning|微調
hallucination|幻覺
dataset|資料集
feature|特徵
classification|分類
clustering|分群
reinforcement learning|強化學習
natural language processing|自然語言處理
computer vision|電腦視覺
speech recognition|語音辨識
optical character recognition|光學字元辨識
crash|當機
firmware|韌體
driver|驅動程式
kernel|核心
operating system|作業系統
file system|檔案系統
directory|目錄
permission|存取權限
shell|命令列環境
script|指令碼
daemon|常駐程式
environment variable|環境變數
configuration|組態
`;

  const FINANCE = `
equity|股權
hedge|避險
yield|殖利率
bond|債券
stock|股票
share|股份
dividend|股利
interest rate|利率
inflation|通貨膨脹
deflation|通貨緊縮
recession|景氣衰退
depression|經濟蕭條
monetary policy|貨幣政策
fiscal policy|財政政策
central bank|中央銀行
quantitative easing|量化寬鬆
liquidity|流動性
solvency|償債能力
leverage|槓桿
margin|保證金
collateral|擔保品
default|違約
credit rating|信用評等
bankruptcy|破產
merger|合併
acquisition|併購
initial public offering|首次公開發行
underwriter|承銷商
prospectus|公開說明書
valuation|估值
market capitalization|市值
price earnings ratio|本益比
book value|帳面價值
earnings per share|每股盈餘
revenue|營收
gross profit|毛利
operating profit|營業利益
net income|淨利
cost of goods sold|銷貨成本
gross margin|毛利率
operating margin|營業利益率
balance sheet|資產負債表
income statement|損益表
cash flow statement|現金流量表
asset|資產
liability|負債
shareholder equity|股東權益
current asset|流動資產
fixed asset|固定資產
depreciation|折舊
amortization|攤銷
accrual|應計
receivable|應收帳款
payable|應付帳款
inventory|存貨
working capital|營運資金
free cash flow|自由現金流
return on equity|股東權益報酬率
return on assets|資產報酬率
compound interest|複利
present value|現值
future value|終值
discount rate|折現率
net present value|淨現值
internal rate of return|內部報酬率
annuity|年金
principal|本金
maturity|到期日
coupon|票面利率
face value|面額
duration|存續期間
credit spread|信用利差
yield curve|殖利率曲線
treasury bond|公債
municipal bond|市政債券
corporate bond|公司債
junk bond|垃圾債券
convertible bond|可轉換公司債
derivative|衍生性金融商品
futures|期貨
option|選擇權
call option|買權
put option|賣權
strike price|履約價
premium|權利金
swap|交換合約
forward contract|遠期合約
arbitrage|套利
short selling|放空
long position|多頭部位
short position|空頭部位
volatility|波動率
beta|貝他係數
alpha|超額報酬
sharpe ratio|夏普比率
diversification|分散投資
portfolio|投資組合
asset allocation|資產配置
rebalancing|再平衡
mutual fund|共同基金
exchange traded fund|指數股票型基金
hedge fund|避險基金
private equity|私募股權
venture capital|創業投資
angel investor|天使投資人
due diligence|實地查核
term sheet|投資條件書
dilution|股權稀釋
vesting|股權分期取得
stock option|員工認股權
buyback|庫藏股
spin off|分拆
tender offer|公開收購
insider trading|內線交易
market maker|造市者
bid price|買價
ask price|賣價
spread|價差
order book|委託簿
limit order|限價委託
market order|市價委託
stop loss|停損
take profit|停利
slippage|滑價
settlement|交割
clearing house|結算所
custodian|保管機構
broker|券商
dealer|自營商
regulator|主管機關
disclosure|資訊揭露
audit report|查核報告
material information|重大訊息
earnings call|法人說明會
guidance|財測
consensus estimate|市場預估
downgrade|調降評等
upgrade|調升評等
bull market|多頭市場
bear market|空頭市場
correction|修正
bubble|泡沫
systemic risk|系統性風險
credit risk|信用風險
market risk|市場風險
operational risk|作業風險
liquidity risk|流動性風險
counterparty|交易對手
exposure|曝險
stress test|壓力測試
capital adequacy|資本適足率
reserve requirement|存款準備率
exchange rate|匯率
appreciation|升值
remittance|匯款
commodity|大宗商品
crude oil|原油
consumer price index|消費者物價指數
gross domestic product|國內生產毛額
unemployment rate|失業率
trade deficit|貿易逆差
trade surplus|貿易順差
tariff|關稅
subsidy|補貼
withholding tax|扣繳稅款
capital gain|資本利得
taxable income|課稅所得
`;

  const MEDICAL = `
placebo|安慰劑
biopsy|切片檢查
diagnosis|診斷
prognosis|預後
symptom|症狀
syndrome|症候群
etiology|病因學
pathology|病理學
epidemiology|流行病學
incidence|發生率
prevalence|盛行率
mortality|死亡率
morbidity|罹病率
remission|緩解
relapse|復發
chronic|慢性
acute|急性
benign|良性
malignant|惡性
tumor|腫瘤
carcinoma|癌
metastasis|轉移
chemotherapy|化學治療
radiotherapy|放射線治療
immunotherapy|免疫治療
surgery|手術
anesthesia|麻醉
sedation|鎮靜
analgesic|止痛劑
antibiotic|抗生素
antiviral|抗病毒藥物
vaccine|疫苗
immunity|免疫力
antibody|抗體
antigen|抗原
inflammation|發炎
infection|感染
sepsis|敗血症
fever|發燒
edema|水腫
lesion|病灶
ulcer|潰瘍
fracture|骨折
sprain|扭傷
concussion|腦震盪
hemorrhage|出血
thrombosis|血栓
embolism|栓塞
aneurysm|動脈瘤
stroke|中風
hypertension|高血壓
hypotension|低血壓
arrhythmia|心律不整
tachycardia|心搏過速
bradycardia|心搏過緩
myocardial infarction|心肌梗塞
angina|心絞痛
heart failure|心臟衰竭
atherosclerosis|動脈粥狀硬化
cholesterol|膽固醇
triglyceride|三酸甘油酯
diabetes|糖尿病
insulin|胰島素
glucose|葡萄糖
metabolism|新陳代謝
obesity|肥胖症
thyroid|甲狀腺
hormone|荷爾蒙
endocrine|內分泌
kidney failure|腎衰竭
dialysis|洗腎
liver cirrhosis|肝硬化
hepatitis|肝炎
jaundice|黃疸
gastritis|胃炎
reflux|逆流
constipation|便祕
diarrhea|腹瀉
nausea|噁心
vomiting|嘔吐
dehydration|脫水
malnutrition|營養不良
anemia|貧血
leukemia|白血病
lymphoma|淋巴瘤
platelet|血小板
plasma|血漿
transfusion|輸血
coagulation|凝血
asthma|氣喘
bronchitis|支氣管炎
pneumonia|肺炎
tuberculosis|肺結核
emphysema|肺氣腫
dyspnea|呼吸困難
hypoxia|缺氧
ventilator|呼吸器
intubation|插管
oxygen saturation|血氧飽和度
allergy|過敏
anaphylaxis|過敏性休克
dermatitis|皮膚炎
eczema|濕疹
psoriasis|乾癬
urticaria|蕁麻疹
arthritis|關節炎
osteoporosis|骨質疏鬆症
rheumatism|風濕
tendonitis|肌腱炎
migraine|偏頭痛
epilepsy|癲癇
seizure|癲癇發作
dementia|失智症
neuropathy|神經病變
paralysis|癱瘓
depression|憂鬱症
anxiety|焦慮症
insomnia|失眠
schizophrenia|思覺失調症
autism|自閉症
rehabilitation|復健
physiotherapy|物理治療
prosthesis|義肢
catheter|導管
stent|支架
pacemaker|心律調節器
transplant|移植
donor|捐贈者
recipient|受贈者
rejection|排斥反應
immunosuppressant|免疫抑制劑
sterilization|滅菌
quarantine|檢疫隔離
isolation ward|隔離病房
outbreak|疫情爆發
pandemic|全球大流行
endemic|地方流行
incubation period|潛伏期
transmission|傳播
carrier|帶原者
screening|篩檢
false positive|偽陽性
false negative|偽陰性
sensitivity|敏感度
specificity|特異度
clinical trial|臨床試驗
randomized|隨機分派
double blind|雙盲
control group|對照組
informed consent|知情同意
adverse event|不良事件
side effect|副作用
contraindication|禁忌症
dosage|劑量
prescription|處方
generic drug|學名藥
pharmacokinetics|藥物動力學
efficacy|療效
toxicity|毒性
withdrawal|戒斷
addiction|成癮
palliative care|安寧緩和醫療
hospice|安寧病房
triage|檢傷分類
emergency room|急診室
intensive care unit|加護病房
outpatient|門診
inpatient|住院
referral|轉診
medical record|病歷
vital signs|生命徵象
`;

  // 解析故意寫得很嚴格：格式壞掉的那一行會直接被丟掉而不是產生半截術語，
  // 但同時也不容忍重複——重複的 source+domain 是資料錯誤，測試會抓。
  function parseBlock(text, domain) {
    const terms = [];
    for (const line of String(text).split("\n")) {
      const row = line.trim();
      if (!row || row.startsWith("#")) continue;
      const divider = row.indexOf("|");
      if (divider <= 0) continue;
      const source = row.slice(0, divider).trim();
      const target = row.slice(divider + 1).trim();
      if (!source || !target) continue;
      terms.push({ source, target, domain });
    }
    return terms;
  }

  const PRESET_TERMS = Object.freeze([
    ...parseBlock(TECH, "tech"),
    ...parseBlock(FINANCE, "finance"),
    ...parseBlock(MEDICAL, "medical")
  ].map((term) => Object.freeze(term)));

  function countByDomain() {
    const counts = {};
    for (const id of DOMAIN_IDS) counts[id] = 0;
    for (const term of PRESET_TERMS) counts[term.domain] += 1;
    return counts;
  }

  // 只回傳被勾選領域的條目。傳空陣列就是一條都不要——關掉開關的人不該
  // 因為「反正只是預設值」而被偷偷塞回去。
  function termsForDomains(domains) {
    const wanted = new Set((Array.isArray(domains) ? domains : []).map((id) => String(id)));
    if (!wanted.size) return [];
    return PRESET_TERMS.filter((term) => wanted.has(term.domain));
  }

  function normalizeDomains(value) {
    const raw = Array.isArray(value) ? value : String(value ?? "").split(/[\s,;]+/);
    const seen = [];
    for (const item of raw) {
      const id = String(item ?? "").trim();
      if (DOMAIN_IDS.includes(id) && !seen.includes(id)) seen.push(id);
    }
    return seen;
  }

  const presets = Object.freeze({
    PRESET_LANGUAGES,
    DOMAIN_IDS,
    DOMAIN_LABELS,
    PRESET_TERMS,
    countByDomain,
    termsForDomains,
    normalizeDomains
  });
  global.ImmerseFreeGlossaryPresets = presets;
  if (typeof module !== "undefined" && module.exports) module.exports = presets;
})(globalThis);
