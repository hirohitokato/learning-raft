import { describe, expect, test } from "bun:test"
import { SimulationController } from "../simulator/SimulationController"

describe("SimulationController", () => {
    test("creates a configurable simulation and advances time", () => {
        const controller = new SimulationController({
            nodeCount: 3,
            communicationSpeed: 10,
            timeStepMs: 10,
            simulationSpeed: 2,
        })

        expect(controller.nodeCount).toBe(3)
        expect(controller.nodes.length).toBe(3)
        expect(controller.simulationSpeed).toBe(2)

        controller.setSimulationSpeed(0)
        expect(controller.simulationSpeed).toBe(0)
        controller.setSimulationSpeed(101)
        expect(controller.simulationSpeed).toBe(100)

        controller.start()
        controller.advance(10)

        expect(controller.clock.now).toBeGreaterThanOrEqual(0)
        expect(controller.running).toBe(true)

        controller.setNodeCount(5)
        expect(controller.nodeCount).toBe(5)
        expect(controller.nodes.length).toBe(5)
        expect(controller.simulationTime).toBe(0)
    })

    test("can suspend a node without breaking the simulation and drops inbound traffic while inactive", () => {
        const controller = new SimulationController({
            nodeCount: 2,
            communicationSpeed: 10,
            timeStepMs: 10,
        })

        controller.setNodeActive(1, false)

        const targetNode = controller.nodes.find((node) => node.id === 1)
        expect(targetNode).toBeDefined()
        expect(targetNode?.active).toBe(false)
        expect(controller.getNodeSnapshot(1)?.isActive).toBe(false)

        const initialReceived = controller.getNodeSnapshot(1)?.remainingElectionTime ?? 0
        controller.advance(200)
        expect(controller.getNodeSnapshot(1)?.isActive).toBe(false)
        expect(controller.getNodeSnapshot(1)?.remainingElectionTime).toBe(initialReceived)
    })

    test("routes a follower proposal to the active leader", () => {
        const controller = new SimulationController({ nodeCount: 2 })
        const leader = controller.nodes[0]!
        leader.currentTerm = 1
        leader["becomeLeader"]()

        expect(controller.proposeLogEntry(1, "set x=1")).toBe(true)

        expect(controller.getNodeSnapshot(0)?.logs).toEqual([{ term: 1, command: "set x=1" }])
        expect(controller.getNodeSnapshot(1)?.logs).toEqual([])
    })

    test("rejects proposals without a leader or from a suspended node", () => {
        const controller = new SimulationController({ nodeCount: 2 })

        expect(controller.proposeLogEntry(0, "set x=1")).toBe(false)

        const leader = controller.nodes[0]!
        leader.currentTerm = 1
        leader["becomeLeader"]()
        controller.setNodeActive(1, false)

        expect(controller.proposeLogEntry(1, "set x=1")).toBe(false)
        expect(controller.getNodeSnapshot(0)?.logs).toEqual([])
    })
})
