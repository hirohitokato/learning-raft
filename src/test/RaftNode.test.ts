import { describe, expect, test } from "bun:test"
import { VirtualClock } from "../clock/VirtualClock"
import { RaftNode } from "../nodes/RaftNode"
import type { Message } from "../nodes/Message"

describe("RaftNode log replication", () => {
    test("commits after a majority replicates and followers apply on the next heartbeat", () => {
        const clock = new VirtualClock()
        const messages: Message[] = []
        const nodes = new Map<number, RaftNode>()
        const deliver = () => {
            while (messages.length) {
                const message = messages.shift()!
                nodes.get(message.to)?.receive(message)
            }
        }

        for (const [id, timeout] of [100, 200, 300].entries()) {
            nodes.set(id, new RaftNode(id, [0, 1, 2].filter((peer) => peer !== id), clock, (message) => messages.push(message), timeout))
            nodes.get(id)!.start()
        }

        clock.runUntil(100)
        deliver()

        const leader = nodes.get(0)!
        expect(leader.state).toBe("leader")
        expect(leader.propose("set x=1")).toBe(true)
        expect(leader.commitIndex).toBe(-1)

        deliver()
        expect(leader.commitIndex).toBe(0)
        expect(leader.lastApplied).toBe(0)
        expect(nodes.get(1)?.commitIndex).toBe(-1)

        clock.runUntil(200)
        deliver()
        expect(nodes.get(1)?.commitIndex).toBe(0)
        expect(nodes.get(1)?.lastApplied).toBe(0)
    })
})
