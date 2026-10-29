// 所有未证实系数集中在这里。数值是“逻辑相符 + 量级合理”的近似，不是原版。
export const TUNING = {
  startingCash: 100_000,
  startingDeposit: 100_000,
  startingCards: 4,
  handLimit: 8,
  dayLimit: 100,
  priceIndexStart: 1,
  priceIndexEveryDays: 15,
  priceIndexStep: 0.1,
  salary: 20_000,
  freeThreshold: 10_000,
  magicCash: 30_000,

  // 地产
  landPrice: [0, 2_000, 3_000, 4_500, 6_500, 9_000], // 按等级
  buildCost: [0, 3_000, 6_000, 12_000, 24_000, 48_000],
  rentBase: [0, 1_000, 2_500, 6_000, 14_000, 32_000],
  streetMultiplier: 0.4, // 同街每多一块己方地，乘一次；4–5 块满级到百万量级
  maxLevel: 5,
  bigRentMultiplier: 1.6,

  // 银行 / 股票 / 乐透
  monthlyInterest: 0.10,
  stockCommission: 0.002,
  stockDrift: 0.002,
  stockVolatility: 0.10,
  lotteryTicket: 2_000,
  lotteryJackpotBase: 200_000,

  // 惩罚 / 奖励
  taxRate: 0.05,
  beggarAsk: 5_000,
  dogFine: 5_000,
  jailTurns: 2,
  hospitalTurns: 2,
  bailCost: 10_000,
  bombDamage: 30_000,
  mineDamage: 20_000,

  // 工资/回合
  startBonus: 20_000,
  godBaseDays: 3,
  maxDice: 3,
};
