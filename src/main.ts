import { Simulator } from "./simulator/Simulator"

const simulator = new Simulator(5) // 例: 5ノード、選挙タイムアウト150ms
simulator.start()
simulator.run()
