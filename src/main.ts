import { Simulator } from "./simulator/Simulator";

class RandomGenerator {
    private seed: number;

    constructor(seed: number) {
        this.seed = seed;
    }

    next(): number {
        // 線形合同法 (Linear Congruential Generator) を使用して擬似乱数を生成
        this.seed = (this.seed * 48271) % 2147483647;
        return this.seed / 2147483647;
    }
}

const randomGenerator = new RandomGenerator(Date.now());
const simulator = new Simulator(5); // 例: 5ノード、選挙タイムアウト150ms
simulator.start();
simulator.run();
