import { describe, expect, test } from "bun:test"
import { VirtualClock } from "../clock/VirtualClock"
import { NetworkSimulator } from "../simulator/NetworkSimulator"

describe("NetworkSimulator", () => {
    test("delivers a message after the network latency derived from node distance", () => {
        const clock = new VirtualClock()
        const network = new NetworkSimulator(clock, { speed: 2 })

        const received: string[] = []

        network.registerNode(0, { x: 0, y: 0 }, (message) => {
            received.push(`node-${message.to}`)
        })

        network.registerNode(1, { x: 10, y: 0 }, (message) => {
            received.push(`node-${message.to}`)
        })

        const requestVote = {
            type: "RequestVote",
            from: 0,
            to: 1,
            term: 1,
            lastLogIndex: 0,
            lastLogTerm: 0,
        } as const

        network.send(requestVote)

        expect(clock.now).toBe(0)
        expect(received).toEqual([])
        expect(network.getActiveMessages(2.5)[0]?.progress).toBe(0.5)

        clock.runNext()

        expect(clock.now).toBe(5)
        expect(received).toEqual(["node-1"])
    })
})
