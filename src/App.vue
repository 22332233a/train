<template>
  <div class="live-stream-container" @click="handleClick">
    
    <!-- 1. 顶部数据栏 (仿直播看板) -->
    <header class="stats-bar">
      <div class="stat-box fans">
        <span class="label">粉丝数</span>
        <span class="value">{{ fans }}</span>
      </div>
      <div class="stat-box vc">
        <span class="label">舰长数</span>
        <span class="value highlight">{{ vcCount }}</span>
      </div>
      <div class="stat-box heat">
        <span class="label">热度</span>
        <span class="value">{{ heat }}</span>
      </div>

    </header>

    <!-- 2. 弹幕滚动层 (核心视觉) -->
    <div class="danmaku-layer">
      <div 
        v-for="(dm, index) in visibleDanmaku" 
        :key="index"
        class="danmaku-item"
        :class="dm.type"
        :style="{ top: dm.top + '%', animationDuration: dm.speed + 's' }"
      >
        <span class="dm-user" v-if="dm.user">{{ dm.user }}:</span>
        <span class="dm-text">{{ dm.text }}</span>
      </div>
    </div>

    <!-- 3. 底部对话框 (点击交互区) -->
    <div class="dialogue-overlay">
      <div class="dialogue-box">
        <div class="speaker-name" v-if="currentLine.speaker">
          {{ currentLine.speaker }}
        </div>
        <div class="text-content">
          {{ displayedText }}<span class="cursor">_</span>
        </div>
        
        <!-- 继续提示 -->
        <div class="next-hint" v-if="!isTyping && !isChoosing && !gameOver">
          (点击屏幕继续)
        </div>
      </div>
    </div>

    <!-- 4. 选项层 (暂停弹幕时显示) -->
    <transition name="fade">
      <div v-if="isChoosing" class="choices-modal" @click.stop>
        <div class="choices-title">直播间决策</div>
        <button 
          v-for="(opt, i) in currentLine.choices" 
          :key="i"
          @click="selectOption(opt)"
          class="choice-btn"
          :class="opt.type || 'normal'"
        >
          <div class="btn-text">{{ opt.text }}</div>
          <div class="btn-effect" v-if="opt.vc || opt.fans">
            {{ opt.vc ? '+' + opt.vc + '舰' : '' }} {{ opt.fans ? '+' + opt.fans + '粉' : '' }}
          </div>
        </button>
      </div>
    </transition>

    <!-- 5. 结局结算页 -->
    <transition name="fade">
      <div v-if="gameOver" class="result-screen" @click.stop>
        <div class="result-card">
          <h1 class="result-title">{{ endingTitle }}</h1>
          <p class="result-desc">{{ endingDesc }}</p>
          
          <div class="final-data">
            <div class="data-row">
              <span>最终粉丝:</span>
              <span :class="fans >= 10000 ? 'good' : 'bad'">{{ fans }}</span>
            </div>
            <div class="data-row">
              <span>最终舰长:</span>
              <span :class="vcCount >= 50 ? 'good' : 'bad'">{{ vcCount }}</span>
            </div>
          </div>

          <button @click="restart" class="restart-btn">重新开始直播</button>
        </div>
      </div>
    </transition>

  </div>
</template>
<script setup>
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue';

// ================= ⚙️ 配置 (保持原样) =================
const MAX_DAYS = 8; 

// ================= 📊 状态统计 (保持原样) =================
const restCount = ref(0);
const addBroadcastCount = ref(0);
const normalEndCount = ref(0);
const hasRestThenResume = ref(false);
let lastRoundWasRest = false;
// 🛌 休息天数计数器 (初始为 0)
const restDaysCount = ref(0);
// ================= 🎮 游戏基础状态 (保持原样) =================
const currentScene = ref('start');
const lineIndex = ref(0);
const currentRound = ref(1);
const fans = ref(100);
const vcCount = ref(0);
const stress = ref(0);
const heat = ref(500);
const isStreaming = ref(false);
const gameOver = ref(false);

// 文本与弹幕
const displayedText = ref('');
const isTyping = ref(false);
const isChoosing = ref(false);
const danmakuList = ref([]);
let typeTimer = null;
let danmakuTimer = null;
let autoLogicTimer = null; 

// 结局展示
const endingTitle = ref('');
const endingDesc = ref('');

// ================= 🏆 结局收集与首局逻辑 (保持原样) =================
const endingsUnlocked = ref({
  burnout: false,      
  lazy_quit: false,    
  average: false,      
  success_surge: false 
});
const fileName = 'config.json';
const fullPath = `/assets/${fileName}`;
const isFirstPlay = ref(true); 

// ✅ 修复：定义标记变量
const restActionJustTaken = ref(false);
// --- 真结局阶段标记 (必须定义在这里) ---
const phase1_active = ref(false); 
const phase2_active = ref(false);
const phase3_active = ref(false);
const reachedTrueEndingPath = ref(false); // 总开关
// ================= 📜 剧本数据 (保持原样) =================
const script = {
  start: [
    { speaker: "", text: "你来了" },

  ],
  decision_start: [
    { 
      speaker: "日程安排", 
      text: "第 {{day}} 月", 
      isDecision: true,
      choices: [
        { text: "开播", desc: "开始今天的直播工作", actionType: "START_STREAM", nextScene: "streaming_phase" },
        { text: "休息？", desc: "今天太累了，skip 一天", actionType: "SKIP_DAY", nextScene: "day_end_process" }
      ]
    }
  ],
  streaming_phase: [
    { speaker: "", text: "我要给大家最好的"},

  ],
  decision_end: [
    { 
      speaker: "", 
      text: "今天人好多，在播会？", isDynamic: true,
      isDecision: true,
      choices: [
        { text: "再播会？", desc: "再播2小时！(高风险)", actionType: "ADD_BROADCAST", risk: true, effect: { fans: 800, vc: 5, stress: 35, heat: 2000 }, nextScene: "day_end_process" },
        { text: "下播拉~", desc: "见好就收", actionType: "NORMAL_END", risk: false, effect: { fans: 400, vc: 2, stress: 15, heat: 1000 }, nextScene: "day_end_process" }
      ]
    }
  ],
  day_end_process: [
    { speaker: "", text: "好无聊啊，得去想点直播间话题去" }, 

  ],
  end_burnout: [
    { speaker: "系统", text: "疲劳毕业" },
    { speaker: "", text: "虽然数据很不错，但是最后几天好累啊，不想播了", isEnd: true, endType: 'burnout' }
  ],
  end_lazy_quit: [
    { speaker: "系统", text: "提前毕业" },
    { speaker: "", text: "为什么大家都跑了，是我播的太少了吗，还是我的礼物不好", isEnd: true, endType: 'lazy_quit' }
  ],
  end_success_surge: [
    { speaker: "系统", text: "隐藏结局" },
    { speaker: "", text: "我最后几天的状态不是很好，觉得大家可能要理我而去，还依然陪着我，理解我，在我想要直播的时候让我直播，想休息的时候让我休息，谢谢你，我会依然会直播的", isEnd: true, endType: 'success_surge' }
  ],
  end_average: [
    { speaker: "系统", text: "继续直播" },
    { speaker: "", text: "数据还可以诶，但是好多人都跑了诶，开始那几天状态真好，再播多长时间都行", isEnd: true, endType: 'average' }
  ],
  
  'decision_day_4_end': [
    { text: "第 4 天直播结束。身体很疲惫，但弹幕里有人在问你怎么脸色这么差。", isDecision: true, options: [
        { text: "直接下播睡觉", next: 'day_end_process', action: 'rest' }, 
        { text: "强行加播 1 小时", next: 'day_end_process', action: 'add_broadcast' },
        
        // 👇👇👇 【关键】隐藏的关心选项 (真结局钥匙)
        // 这里的 text 可以写得更有深意，暗示这是给“懂行”的人准备的
        { 
          text: "❤️ 读一遍那条关心的长评论并回复 (消耗精力但增加粘性)", 
          next: 'day_end_process', 
          action: 'care_fans', // 自定义动作标记
          // 可选：如果你只想让老手看到这个选项，可以加一个 custom 字段，然后在渲染时过滤
          // hiddenForNewbie: true 
        }
      ] 
    }
  ],
    // 1. 疲劳毕业 -> 尾声
  'epilogue_burnout': [
    { text: "你看着黑掉的屏幕，手指还在微微颤抖。" },
    { text: "“再坚持一下就好了……”你心里这么想着，但身体已经彻底罢工了。" },
    { text: "病房里的消毒水味取代了直播间的喧嚣。你终于明白了，有些东西一旦透支，就再也补不回来了。" },
    { text: "（系统自动结算中...）", next: 'trigger_end_burnout' } 
  ],

  // 2. 摆烂退圈 -> 尾声
  'epilogue_lazy_quit': [
    { text: "你伸了个懒腰，看着空荡荡的直播间，心里竟有一丝轻松。" },
    { text: "“反正也没人看，不如去睡个回笼觉。”你关掉了推流软件，这一关就是整整一周。" },
    { text: "当你再次想起账号时，发现曾经的粉丝早已散去。安逸的温床，往往也是梦想的坟墓。" },
    { text: "（系统自动结算中...）", next: 'trigger_end_lazy_quit' }
  ],

  // 3. 平平无奇 -> 尾声
  'epilogue_average': [
    { text: "第七天的夕阳照在桌面上，和第一天没什么两样。" },
    { text: "你按部就班地完成了任务，不功不过。粉丝涨了几个，又走了几个。" },
    { text: "日子就这样平淡地流过。或许这就是大多数人的常态？安稳，却也少了些色彩。" },
    { text: "（系统自动结算中...）", next: 'trigger_end_average' }
  ],

  // 4. 数据大涨 (普通好结局) -> 尾声
  'epilogue_success': [
    { text: "后台的数据曲线像火箭一样飙升，弹幕里满是“666”和“恭喜”。" },
    { text: "你看着完美的运营报表，露出了胜利者的微笑。这一周，你像个精密的机器，掌控了一切。" },
    { text: "这是属于强者的胜利。但在这光鲜的数据背后，你是否还记得第一次开播时的心跳？" },
    { text: "（系统自动结算中...）", next: 'trigger_end_success' }
  ],

  // 5. 初心重现 (真隐藏结局) -> 尾声
  'epilogue_true_master': [
    { text: "你合上电脑，窗外已是晨曦微露。" },
    { text: "回想起第 4 天那个夜晚，你庆幸自己停下了匆忙的脚步，认真回复了那条关心的弹幕。" },
    { text: "那一刻的连接，比任何数据都让你感到温暖。你不再是被算法驱使的奴隶，而是真正的主播。" },
    { text: "路还很长，但你知道，这一次，你走对了方向。" },
    { text: "（系统自动结算中...）", next: 'trigger_end_true_master' }
  ],
  'epilogue_low':[
    {text:"今天出去吃火锅了，好好吃"},
        {text:"抽卡出货了，好耶"},
    {text:"啦啦啦~"},


  ],
    'epilogue_medium':[
    {text:"哈，有点困了"},
        {text:"······"},
    {text:""},
  ]
    ,
    'epilogue_high':[
    {text:"啊，什么事，再说一遍"},
    {text:"我刚刚睡着了嘛，不好意思"},
    {text:"漏弹幕了吗，不好意思"},


  ],

  // ================= 触发器场景 (中间层) =================
  // 这些场景只有一行，作用是让代码检测到并执行 triggerEnd
  'trigger_end_burnout': [{ text: "", action: 'end_burnout' }],
  'trigger_end_lazy_quit': [{ text: "", action: 'end_lazy_quit' }],
  'trigger_end_average': [{ text: "", action: 'end_average' }],
  'trigger_end_success': [{ text: "", action: 'end_success' }],
  'trigger_end_true_master': [{ text: "", action: 'end_true_master' }]
  
  
};

// ================= 🧠 核心逻辑引擎 (拆分为6个函数) =================

// 1. 【计算属性】获取当前行内容
// 假设您的剧本对象名字叫 script (如果不是，请把下面代码里的 script 改成您的变量名)
// 例如：import script from './data/script.js' 或 const script = { ... }

const currentLine = computed(() => {
  // 1. 获取当前场景数据
  const sceneData = script[currentScene.value];
  
  // 2. 安全检查
  if (!sceneData || !sceneData[lineIndex.value]) {
    return { text: "..." }; 
  }
  
  const rawData = sceneData[lineIndex.value];
  let finalText = rawData.text || "";

  // 3. 获取当前回合数
  const round = currentRound.value;

  // ================= 🎲 动态文案逻辑 (已修改为：顺序播放) =================
  if (rawData.isDynamic) {
    
    // --- 定义完整的顺序文案流 (按回合 1, 2, 3... 依次排列) ---
    // 你可以直接在这里修改每一句话，顺序很重要！
    const broadcastTimeline = [
      // Round 1: 活力满满
      "今天出去吃火锅了，好好吃~",
      // Round 2: 互动热情
      "啦啦啦，再唱一首歌吧！",
      // Round 3: 收到礼物，兴奋
      "又有人上舰长了，想给大家最好的礼物",
      // Round 4: 开始出现疲态 (转折点)
      "哈...有点困了",
      // Round 5: 强打精神
      "谢谢大家关心我。",
      // Round 6: 出现失误
      "又漏弹幕了，不好意思",
      // Round 7: 沉默/迟钝
      "......",
      // Round 8: 极限状态
      "我怎么睡着了，不好意思..."
      // 如果游戏超过8回合，可以在这里继续加...
    ];

    // --- 核心逻辑：按顺序取值 ---
    
    // 数组索引从 0 开始，所以 round 1 对应 index 0
    const index = round - 1; 

    if (index >= 0 && index < broadcastTimeline.length) {
      finalText = broadcastTimeline[index];
    } else if (index >= broadcastTimeline.length) {
      // 如果回合数超过了文案数量，就显示最后一句（或者你可以改为显示默认提示）
      finalText = broadcastTimeline[broadcastTimeline.length - 1] + " (持续中...)";
    } else {
      finalText = "（直播刚开始...）";
    }

  } else {
    // ================= 📝 固定剧情逻辑 =================
    // 如果没有标记 isDynamic，就走原来的替换逻辑
    
    // 替换 {{day}} 为当前回合数
    finalText = finalText.replace('{{day}}', round);
    
    // 如果有其他变量也可以在这里继续替换
    // finalText = finalText.replace('{{stress}}', stress.value);
  }

  // 4. 返回最终处理好的对象
  return { ...rawData, text: finalText };
});

// 2. 【打字机】启动文字显示
const startTyping = () => {
  if (autoLogicTimer) clearTimeout(autoLogicTimer);
  autoLogicTimer = null;

  const text = currentLine.value.text || "";
  displayedText.value = '';
  isTyping.value = true;
  if (typeTimer) clearInterval(typeTimer);
  
  let i = 0;
  typeTimer = setInterval(() => {
    if (i < text.length) {
      displayedText.value += text[i];
      i++;
    } else {
      finishTyping();
    }
  }, 30);
};

// 3. 【打字机】结束处理 (简化版：只负责把字显示完，不负责跳转)
const finishTyping = () => {
  clearInterval(typeTimer);
  displayedText.value = currentLine.value.text || "";
  isTyping.value = false;
  
  // ❌ 删除了原来这里的 autoLogicTimer 逻辑！
  // 所有的场景跳转、逻辑结算，全部交给 handleClick 去判断。
  // 这样可以防止“自动跳”和“手动点”打架。
};

// 4. 【弹幕】生成随机弹幕
const addDanmaku = () => {
  if (!isStreaming.value || isChoosing.value || gameOver.value) return;
  if (Math.random() > 0.3) {
    const pool = [
      { user: "路人", text: "来了", type: "normal" },
      { user: "粉丝", text: "打卡", type: "fan" },
      { user: "土豪", text: "666", type: "vip" }
    ];
    const item = pool[Math.floor(Math.random() * pool.length)];
    danmakuList.value.push({ id: Date.now(), ...item });
    if (danmakuList.value.length > 12) danmakuList.value.shift();
  }
};
const selectOption = (opt) => {
  if (!opt || !opt.actionType) return;
  
  // 关闭选项面板
  isChoosing.value = false;
  
  // 🚨 关键修复：使用正确的变量名 currentRound
  const currentR = currentRound.value; 
  const action = opt.actionType;

  console.log(`🎮 当前回合: ${currentR}, 玩家动作: ${action}`);

  // ==========================================
  // 🏆 真结局监控逻辑 (基于 currentRound)
  // ==========================================
  
  // 假设你有这些标记变量 (如果没有定义，请记得在顶部加上，例如: const phase1_active = ref(false);)
  // 如果还没定义这些标记变量，游戏可能无法记录进度，建议先加上：
  // const phase1_active = ref(false); 
  // const phase2_active = ref(false);
  // const phase3_active = ref(false);

  // 1. 第 1-2 回合：必须选过 "激情加播"
  if (currentR >= 1 && currentR <= 2 && action === 'ADD_BROADCAST') {
    if (typeof phase1_active !== 'undefined') phase1_active.value = true;
    console.log(`✅ [真结局] 阶段1达成：第${currentR}回合选了【激情加播】`);
  }

  // 2. 第 3-5 回合：必须选过 "准时下播"
  if (currentR >= 3 && currentR <= 5 && action === 'NORMAL_END') {
    if (typeof phase2_active !== 'undefined') phase2_active.value = true;
    console.log(`✅ [真结局] 阶段2达成：第${currentR}回合选了【准时下播】`);
  }

  // 3. 第 6-8 回合：必须选过 "直接休息"
  if (currentR >= 6 && currentR <= 8 && action === 'SKIP_DAY') {
    if (typeof phase3_active !== 'undefined') phase3_active.value = true;
    console.log(`✅ [真结局] 阶段3达成：第${currentR}回合选了【直接休息】`);
  }
    // 1. 获取当前三个阶段的最新状态
  const p1 = phase1_active.value;
  const p2 = phase2_active.value;
  const p3 = phase3_active.value;

  // 2. 检查是否三者都为 true
  if (p1 && p2 && p3) {
    // 3. 【关键操作】如果都满足了，但总开关还没开，那就强行打开它！
    if (!reachedTrueEndingPath.value) {
      reachedTrueEndingPath.value = true; // <--- 就是这行！把你那个只读的变量写成 true
      console.log("🔥🔥🔥 [系统提示] 三阶段条件满足！已强制激活真结局路径 (reachedTrueEndingPath = true) 🔥🔥🔥");
    }
} else {
    // 不要猜哪里错了，直接打印当前所有状态，让人眼来判断
    console.log("❌ 真结局判定失败。当前状态快照：");
    console.log("   - P1 (前期加播):", p1);
    console.log("   - P2 (中期准时):", p2);
    console.log("   - P3 (后期休息):", p3);
    console.log("   - 当前动作:", action);
    
    // 只有当 P1 或 P2 明确为 false 时，才提示可能是前期错了
    if (!p1 || !p2) {
        console.warn("⚠️ 注意：P1 或 P2 为 false。请检查第 1-5 天的操作是否正确！");
    } 
    // 如果 P1/P2 都对，但 P3 错，且动作是休息，这通常是正常的过渡状态，不需要报警告
    else if (!p3 && action === 'SKIP_DAY') {
        console.log("ℹ️ 提示：正在尝试激活 P3... 如果这是第 6-8 天，请继续。");
    }
}
  

  // ==========================================
  // 👇 业务逻辑与数值变化
  // ==========================================

  if (action === "SKIP_DAY") {
    restCount.value++;
    lastRoundWasRest = true;
    restActionJustTaken.value = true; 
    isStreaming.value = false;
    
    // ⚠️ 重要：回合数增加！
  
    
    currentScene.value = "day_end_process";
    lineIndex.value = 0;
    startTyping();
    return;
  }

  if (action === "START_STREAM") {
    isStreaming.value = true;
    if (lastRoundWasRest) hasRestThenResume.value = true;
    lastRoundWasRest = false;
    restActionJustTaken.value = false; 
    
    currentScene.value = "streaming_phase";
    lineIndex.value = 0;
    startTyping();
    return;
  }

  // 统计计数
  if (action === "ADD_BROADCAST") addBroadcastCount.value++;
  if (action === "NORMAL_END") normalEndCount.value++;
  
  restActionJustTaken.value = false;

  // 应用数值效果
  if (opt.effect) {
    if (opt.effect.fans) fans.value += opt.effect.fans;
    if (opt.effect.vc) vcCount.value += opt.effect.vc;
    if (opt.effect.stress) stress.value += opt.effect.stress;
    if (opt.effect.heat) heat.value = opt.effect.heat;
  }

  // 跳转场景
  if (opt.nextScene) {
    // 注意：如果是 NORMAL_END 或 ADD_BROADCAST，通常也是在一天结束时增加回合
    // 如果你的逻辑是：选完选项 -> 进入 day_end_process -> 点击继续 -> 下一天
    // 那么这里不需要加 currentRound.value++，应该在 day_end_process 结束的逻辑里加。
    // 但如果你的逻辑是：选完选项直接算一天结束，那需要在这里加。
    // *根据你上面的 SKIP_DAY 逻辑，我猜测你可能需要在其他结束方式中也增加回合*
    
    // 临时方案：如果 nextScene 是 day_end_process，我们假设在那里处理增加逻辑
    // 如果选完 NORMAL_END 没有增加回合，记得在这里或者 day_end_process 的结尾加上：
    // if (action === 'NORMAL_END' || action === 'ADD_BROADCAST') currentRound.value++;

    currentScene.value = opt.nextScene;
    lineIndex.value = 0;
    startTyping();
  }
};
const finalizeAndTriggerEnd = (reasonType) => {
  let finalEndKey = '';
  let unlockType = '';

  // 🚨【核心修改】优先级重排：先检查是否达成“真结局路径”
  // 只要路径对了，无视压力值！(哪怕 stress = 999 也是真结局)
  const isTruePath = reachedTrueEndingPath.value;
  const totalRestDays = restCount.value;

  if (reasonType === 'clear' && isTruePath) {
    // ✅ 只要走对了路线，直接封神！
    finalEndKey = 'end_success_surge';
    unlockType = 'true_master';
    console.log(`🏆 真结局判定成功！(压力: ${stress.value} 被忽略)`);
  } 
  // 🚨 其次才检查压力 (仅针对非真结局路径，或者非通关结算)
  else if (stress.value >= 150) {
    // 💀 只有没走对路线，且压力爆了，才是真的“累死”
    finalEndKey = 'end_burnout';
    unlockType = 'burnout';
    console.log(`⚠️ 结算判定：未达成真结局路径 且 压力 (${stress.value}) >= 150，触发疲劳结局`);
  }
  // 原有的其他逻辑
  else if (reasonType === 'burnout') {
    // 如果是外部强制调用的 burnout (且上面没拦截到)，通常意味着没走对路
    finalEndKey = 'end_burnout';
    unlockType = 'burnout';
  } 
  else if (reasonType === 'lazy_quit') {
    finalEndKey = 'end_lazy_quit';
    unlockType = 'lazy_quit';
  } 
  else if ( totalRestDays >= 4) {
    finalEndKey = 'end_lazy_quit'; // 或者改名为 end_rotten / end_slacker
    unlockType = 'lazy_quit';
    console.log(`🛌 达成【摆烂结局】：休了 ${totalRestDays} 天，这直播算是白开了...`);
  }
  else if (reasonType === 'clear') {
    // --- 通关但未达成真结局路径 ---
    
    if (isFirstPlay.value) {
      // 新手保护：如果是第一次玩且没走对路，可以强行给个提示或疲劳结局
      finalEndKey = 'end_burnout'; 
      unlockType = 'burnout';
    } else {
      // 普通通关逻辑
      const conditionA = addBroadcastCount.value >= 3; 
      const conditionC = hasRestThenResume.value;      

      // 如果你还想保留一个“宽松版”的好结局，放在这里
      if (conditionA && conditionC) {
        finalEndKey = 'end_average';       
        unlockType = 'average';
      } 
    }
  }

  // 兜底
  if (!finalEndKey) {
    finalEndKey = 'end_average';
    unlockType = 'average';
  }

  console.log(`🔑 最终结局 Key: ${finalEndKey} | 压力值: ${stress.value} | 真结局路径: ${isTruePath}`); 
  
  // 1. 解锁成就
  markEndingAsUnlocked(unlockType);

  // 2. 触发结局演出
  triggerEnd(finalEndKey, unlockType);
};
/**
 * 🚦 处理“一天结束”的动作
 * 请在玩家点击“下播”、“睡觉”或剧本自动结束时调用此函数
 */
/**
 * 🚦 处理“一天结束”的动作
 */
const handleDayEnd = () => {
  if (gameStateLock.value) {
    console.warn('⚠️ 游戏状态锁定中，忽略重复的 handleDayEnd 调用');
    return;
  }
  
  console.log(`\n--- 🌙 第 ${currentRound.value} 天 结束操作 ---`);
  gameStateLock.value = true; // 上锁，防止连点

  // 1. 先执行压力恢复逻辑
  if (isFirstPlay.value && restActionJustTaken.value) {
     console.log('🚫 [新手Debuff] 休息无效！');
  } else {
     const recoverAmount = 20;
     stress.value = Math.max(0, stress.value - recoverAmount); 
     console.log(`💤 压力恢复 -${recoverAmount}, 当前压力: ${stress.value}`);
  }
  restActionJustTaken.value = false; 

  // 2. 判断是否通关
  if (currentRound.value >= MAX_DAYS) {
    console.log('🏆 全程跑完！触发通关结算...');
    finalizeAndTriggerEnd('clear');
    // 注意：finalizeAndTriggerEnd 内部会 triggerEnd，游戏结束，不需要再解锁或跳转
    return; 
  }

  // 3. 如果不是最后一天，正常进入下一天
  currentRound.value++;
  console.log(`➡️ 进入第 ${currentRound.value} 天`);
  
  // 使用 nextTick 确保 DOM 更新后再启动
  nextTick(() => {
    currentScene.value = 'decision_start'; // 确保这个场景名在 script 里有定义
    lineIndex.value = 0;
    isTyping.value = false; // 强制重置打字状态
    isChoosing.value = false; // 强制关闭选项
    gameStateLock.value = false; // 解锁
    
    console.log('🎬 启动新的一天剧情...');
    startTyping();
  });
};

// 🖱️ 交互：统一点击处理 (修复版)
// 新增一个锁，防止自动结算时用户误触
const gameStateLock = ref(false); 

const handleClick = () => {
  // 0. 全局保护
  if (gameOver.value || gameStateLock.value) {
    // 如果锁住了但正在打字，允许点击跳过打字 (体验更好)
    if (!isTyping.value) return; 
  }
  
  // 1. 正在打字 -> 跳过打字
  if (isTyping.value) {
    finishTyping();
    return;
  }
  
  // 2. 遇到选项 -> 弹出选项面板 (不再在这里自动处理 day_end_process)
  if (currentLine.value.isDecision) {
    isChoosing.value = true;
    return;
  }

  // 3. 普通文本流转逻辑
  const sceneData = script[currentScene.value];
  if (!sceneData) {
    console.error('❌ 找不到场景数据:', currentScene.value);
    return;
  }

  // 判断是否是最后一行
  if (lineIndex.value < sceneData.length - 1) {
    // 还有下一句
    lineIndex.value++;
    startTyping();
  } else {
    // ✅ 最后一句播完了，根据场景名决定去哪
    console.log(`🏁 场景 "${currentScene.value}" 已结束，等待指令...`);

    // --- 场景路由表 ---
    
    // A. 游戏开场 -> 第一天决策
    if (currentScene.value === 'start') {
      currentScene.value = 'decision_start';
      lineIndex.value = 0;
      startTyping();
    } 
    
    // B. 直播中结束 -> 播放每日结算剧情 (decision_end 或 day_end_process)
    else if (currentScene.value === 'streaming_phase') {
      // ⚠️ 请确认您的剧本里，直播结束后的场景名到底是哪个？
      // 如果是 'day_end_process' 就填 'day_end_process'
      // 如果是 'decision_end' 就填 'decision_end'
      const nextSceneName = script['decision_end'] ? 'decision_end' : 'day_end_process';
      
      console.log(`🔄 直播结束，跳转到结算场景: ${nextSceneName}`);
      currentScene.value = nextSceneName;
      lineIndex.value = 0;
      startTyping();
    } 
    
    // C. 每日结算剧情播完 -> 真正进入下一天 (调用 handleDayEnd)
    // ⚠️ 这里要匹配上面 B 步骤跳转到的场景名
    else if (currentScene.value === 'decision_end' || currentScene.value === 'day_end_process') {
      console.log('🌙 结算剧情播完，触发 handleDayEnd() 进入下一天！');
      handleDayEnd(); 
      // 注意：handleDayEnd 内部会处理跳转，这里不要做任何事
    } 
    
    // D. 其他未定义情况
    else {
      console.warn(`⚠️ 场景 "${currentScene.value}" 播完但没有定义后续跳转。请检查剧本或添加逻辑。`);
      // 可选：如果是新手引导等特殊场景，可以在这里硬编码跳转
      // if (currentScene.value === 'tutorial_end') { ... }
    }
  }
};
// ================= 🔓 补充缺失的函数定义 =================
// ================= 🎬 核心函数：触发结局画面 (如果上面代码里没有，请补上这个) =================
// 1. 新增变量


// 2. 修改 triggerEnd 函数
const triggerEnd = (endingSceneKey, endingKey) => {
  console.log(`🎬 触发结局：${endingSceneKey}`);
  
  // --- 核心修改开始 ---
  const sceneData = script[endingSceneKey];
  if (sceneData && sceneData.length > 0) {
    // 假设第一行是标题 (speaker: "系统")
    endingTitle.value = sceneData[0].text || '未知结局';
    
    // 假设第二行是描述 (speaker: "")，如果没有第二行就用第一行
    let descText = sceneData[1] ? sceneData[1].text : sceneData[0].text;
    
    // 👇 在这里做变量替换 (因为结算页不经过 currentLine 的打字机逻辑)
    descText = descText
      .replace('{{fans}}', fans.value)
      .replace('{{rounds}}', currentRound.value)
      .replace('{{broadcasts}}', addBroadcastCount.value)
      .replace('{{rests}}', restCount.value)
      .replace('{{stress}}', stress.value);
      
    endingDesc.value = descText;
  } else {
    endingTitle.value = '结局错误';
    endingDesc.value = '未能加载结局文案';
  }
  // --- 核心修改结束 ---

  markEndingAsUnlocked(endingKey);
  gameOver.value = true;
  // 不需要 startTyping() 了，因为这是静态展示页
};
/**
 * 标记某个结局已解锁 (保存到本地存储)
 * @param {string} endingKey - 结局的唯一标识，例如 'true_ending', 'burnout_ending'
 */
const markEndingAsUnlocked = (endingKey) => {
  if (!endingKey) return;
  
  // 1. 获取当前已解锁的列表
  const unlocked = JSON.parse(localStorage.getItem('unlocked_endings') || '[]');
  
  // 2. 如果还没记录过，就加进去
  if (!unlocked.includes(endingKey)) {
    unlocked.push(endingKey);
    localStorage.setItem('unlocked_endings', JSON.stringify(unlocked));
    console.log(`🏆 结局解锁：${endingKey}`);
  }
};

// 可选：如果你需要读取已解锁列表的函数，也可以加上
const isEndingUnlocked = (endingKey) => {
  const unlocked = JSON.parse(localStorage.getItem('unlocked_endings') || '[]');
  return unlocked.includes(endingKey);
};

// 🔄 重置游戏 (修复版：不再重置 isFirstPlay)
const restart = () => {
  if (autoLogicTimer) clearTimeout(autoLogicTimer);
  if (typeTimer) clearInterval(typeTimer);
  
  gameStateLock.value = false;
  gameOver.value = false;
  isStreaming.value = false;
  isChoosing.value = false;
  isTyping.value = false;
  
  // 重置数值
  currentScene.value = 'start';
  lineIndex.value = 0;
  currentRound.value = 1;
  fans.value = 100;
  vcCount.value = 0;
  stress.value = 0;
  heat.value = 500;
  danmakuList.value = [];
  // 🔴🔴🔴【新增代码：必须在这里重置真结局状态】🔴🔴🔴
  // 1. 重置三个阶段性条件

    phase1_active.value=false;
  phase2_active.value=false;
   phase3_active.value=false;
  // 2. 重置总开关（这就是那个“关不上”的开关）
  reachedTrueEndingPath.value = false;
  // 重置统计
  restCount.value = 0;
  addBroadcastCount.value = 0;
  normalEndCount.value = 0;
  hasRestThenResume.value = false;
  lastRoundWasRest = false;
  restActionJustTaken.value = false;
  
  // ⚠️ 重要：这里 NOT 重置 isFirstPlay.value
  // 这样玩家点“重新开始”后，如果是二周目，依然能玩到老手逻辑
  console.log('🔄 游戏已重置，当前新手状态:', isFirstPlay.value);
  
  startTyping();
};

// ================= 🚀 生命周期 =================
onMounted(() => {
  try {
    const savedEndings = localStorage.getItem('streamer_endings');
    const savedFirstPlay = localStorage.getItem('streamer_first_play');
    
    if (savedEndings) {
      endingsUnlocked.value = JSON.parse(savedEndings);
    }
    if (savedFirstPlay === 'false') {
      isFirstPlay.value = false;
    }
  } catch (e) {
    console.warn('读取存档失败');
  }

  startTyping();
  danmakuTimer = setInterval(addDanmaku, 800);
});

onUnmounted(() => {
  clearInterval(danmakuTimer);
  if (typeTimer) clearInterval(typeTimer);
  if (autoLogicTimer) clearTimeout(autoLogicTimer);
});
</script>

<style scoped>
/* === 全局重置 === */
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  background: #f5f5f7;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  color: #333;
  overflow: hidden;
  height: 100vh;
  display: block; /* 改为 block，让容器自己控制布局 */
}

/* === 容器：全屏白底 === */
.live-stream-container {
  position: relative;
  width: 100%;
  height: 100vh;
  background: #ffffff; /* 纯白背景 */
  color: #1a1a1a;     /* 👈 核心修改：默认文字改为深黑灰 */
  font-family: "Microsoft YaHei", -apple-system, sans-serif;
  overflow: hidden;
  cursor: pointer;
}

/* === 顶部数据栏 (下移 + 简约) === */
.stats-bar {
  position: absolute;
  top: 32px;          /* 👇 下移距离增加，更有呼吸感 */
  left: 50%;
  transform: translateX(-50%);
  
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 48px;          /* 👇 间距拉大，更简约大气 */
  
  background: transparent;
  padding: 0;
  z-index: 100;
  pointer-events: none;
  
  /* 移除之前的白色文字阴影，改为深色模式 */
  color: #1a1a1a;
  text-shadow: none; 
}

/* 单个数据项 */
.stat-box {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  padding: 0;
  transition: all 0.3s ease;
  
  /* 👇 新增：轻微的不稳定感，暗示压力 */
  animation: subtle-shake 4s infinite ease-in-out;
}

/* 标签 (Label) - 小字，浅灰 (在白色背景下要够深才能看清，但不能太黑) */
.stat-box .label {
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 1px;
  text-transform: uppercase;
  color: #999;        /* 👈 中灰色，清晰但不抢眼 */
  margin-bottom: 4px;
}

/* 数值 (Value) - 大字，加粗，等宽字体 */
.stat-box .value {
  font-size: 24px;    /* 👈 稍微加大一点，提升存在感 */
  font-weight: 700;
  font-family: 'SF Mono', 'Menlo', 'Courier New', monospace;
  line-height: 1.2;
  color: #1a1a1a;     /* 👈 默认深黑色 */
}

/* --- 特定颜色修饰 (适配白底) --- */

/* 粉丝数：深灰黑 (保持冷静) */
.stat-box.fans .value { 
  color: #333; 
}

/* 舰长数 (VC)：如果为 0，让它显得“无力” */
.stat-box.vc .value { 
  color: #ccc; /* 👈 浅灰色，暗示“没有”、“空虚” */
}
.stat-box.vc .value.highlight { 
  color: #333; /* 只有高亮时才变黑 */
  text-shadow: none;
}

/* 热度：暗红色 (在白底上不要用亮红，用暗红更有压迫感) */
.stat-box.heat .value { 
  color: #d32f2f; 
  /* 添加轻微的脉冲，像心跳过速 */
  animation: pulse-heat 2s infinite;
}

@keyframes pulse-heat {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.7; transform: scale(0.98); }
}

/* 轻微抖动动画 (暗示主播手抖/紧张) */
@keyframes subtle-shake {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-1px); }
}

/* 状态徽章 (直播中/暂停) - 适配白底 */
.status-badge {
  font-size: 11px;
  font-weight: 700;
  padding: 4px 10px;
  border-radius: 12px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  
  /* 直播中：淡红底 + 深红字 */
  background: rgba(211, 47, 47, 0.08);
  color: #d32f2f;
  border: 1px solid rgba(211, 47, 47, 0.2);
  
  animation: pulse-badge 2s infinite;
}

.status-badge.paused { 
  background: rgba(255, 152, 0, 0.08);
  color: #f57c00;
  border: 1px solid rgba(255, 152, 0, 0.2);
  animation: none;
}

@keyframes pulse-badge { 
  0% { opacity: 1; } 
  50% { opacity: 0.6; } 
  100% { opacity: 1; } 
}

/* 移动端适配 */
@media (max-width: 600px) {
  .stats-bar {
    width: 90%;
    gap: 24px;
    top: 20px;
  }
  .stat-box .value {
    font-size: 20px;
  }
  .stat-box .label {
    font-size: 10px;
  }
}
/* === 弹幕层 (核心) === */
.danmaku-layer {
  position: absolute;
  inset: 60px 0 150px 0; /* 上下留出空间 */
  z-index: 1;
  overflow: hidden;
  pointer-events: none;
}

.danmaku-item {
  position: absolute;
  white-space: nowrap;
  font-size: 20px;
  font-weight: bold;
  text-shadow: 1px 1px 2px #000;
  animation: moveLeft linear forwards;
  will-change: transform;
}

/* 弹幕颜色 */
.danmaku-item.normal { color: #fff; }
.danmaku-item.fan { color: #aaddff; }
.danmaku-item.vip { color: #ffeb3b; font-size: 24px; } /* 舰长更大更黄 */
.danmaku-item.leave { color: #666; }
.danmaku-item.system { color: #ff4d4d; background: rgba(0,0,0,0.5); padding: 2px 5px; border-radius: 4px; }

.dm-user {
  color: #ccc;
  margin-right: 5px;
  font-size: 16px;
}
.danmaku-item.vip .dm-user { color: #ff9800; }

@keyframes moveLeft {
  from { transform: translateX(100vw); }
  to { transform: translateX(-100%); }
}

/* === 底部对话框 === */
.dialogue-overlay {
  position: absolute;
  bottom: 0; left: 0; right: 0;
  height: 150px;
  background: linear-gradient(to top, #ffffff 80%, transparent);
  z-index: 20;
  display: flex;
  justify-content: center;
  align-items: flex-end;
  padding-bottom: 20px;
}

.dialogue-box {
  width: 90%;
  max-width: 800px;
  background: rgba(245, 215, 215, 0.8);
  border: 1px solid #444;
  border-radius: 8px;
  padding: 15px 20px;
  backdrop-filter: blur(5px);
  position: relative;
}

.speaker-name {
  color: #484040;
  font-weight: bold;
  font-size: 16px;
  margin-bottom: 5px;
}

.text-content {
  font-size: 20px;
  line-height: 1.5;
  color: #605757;
}

.cursor {
  animation: blink 1s infinite;
}

.next-hint {
  position: absolute;
  bottom: 10px;
  right: 20px;
  font-size: 12px;
  color: #666;
}

@keyframes blink { 50% { opacity: 0; } }

/* === 选项弹窗 === */
.choices-modal {
  position: absolute;
  inset: 0;
  background: rgba(255, 255, 255, 0.6);
  z-index: 30;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  backdrop-filter: blur(3px);
}

.choices-title {
  font-size: 24px;
  color: #ffeb3b;
  margin-bottom: 20px;
  text-shadow: 0 0 10px #ffeb3b;
}

.choice-btn {
  background: rgba(30, 30, 30, 0.95);
  border: 1px solid #ffeb3b;
  color: #fff;
  width: 60%;
  max-width: 500px;
  padding: 15px;
  margin: 10px 0;
  border-radius: 8px;
  cursor: pointer;
  text-align: left;
  transition: all 0.2s;
  font-family: inherit;
}

.choice-btn:hover {
  background: #ffeb3b;
  color: #000;
  transform: scale(1.02);
}

.btn-text {
  font-size: 18px;
  font-weight: bold;
}

.btn-effect {
  font-size: 14px;
  color: #aaa;
  margin-top: 5px;
}
.choice-btn:hover .btn-effect { color: #333; }

/* === 结局页 === */
.result-screen {
  position: absolute;
  inset: 0;
  background: #ffffff;
  z-index: 50;
  display: flex;
  justify-content: center;
  align-items: center;
}

.result-card {
  background: rgb(244, 246, 255);
  border: 2px solid #ffffff;
  padding: 40px;
  border-radius: 10px;
  text-align: center;
  max-width: 500px;
  box-shadow: 0 0 50px rgba(255, 255, 255, 0.2);
}

.result-title {
  color: #232323;
  font-size: 32px;
  margin-bottom: 20px;
}

.result-desc {
  color: #000000;
  line-height: 1.6;
  margin-bottom: 30px;
}

.final-data {
  background: #9d9dac;
  padding: 20px;
  border-radius: 5px;
  margin-bottom: 30px;
  text-align: left;
}

.data-row {
  display: flex;
  justify-content: space-between;
  margin: 10px 0;
  font-size: 18px;
  font-family: monospace;
}

.data-row .good { color: #0f0; }
.data-row .bad { color: #f00; }

.restart-btn {
  background: #ffeb3b;
  color: #000;
  border: none;
  padding: 15px 30px;
  font-size: 18px;
  font-weight: bold;
  border-radius: 5px;
  cursor: pointer;
}

/* 动画 */
.fade-enter-active, .fade-leave-active { transition: opacity 0.3s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>