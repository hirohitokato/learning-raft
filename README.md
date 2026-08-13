![Raft Consensus Algorithm](https://raft.github.io/logo/solo.svg)

## Architecture

```
┌───────────────────────────────────────────┐
│                Simulator                  │
│                                           │
│  Virtual Clock                            │
│  Event Queue                              │
│  Network Simulator                        │
│  Fault Injector                           │
│                                           │
│    ↓ message delivery / timeout           │
│                                           │
│ ┌────────┐ ┌────────┐ ┌────────┐          │
│ │ Raft 0 │ │ Raft 1 │ │ Raft 2 │ ...      │
│ │ State  │ │ State  │ │ State  │          │
│ │ Machine│ │ Machine│ │ Machine│          │
│ └────────┘ └────────┘ └────────┘          │
│                                           │
│            ↓ events / snapshots           │
│       ┌────────────────────────┐          │
│       │ Observer / UI / Logger │          │
│       └────────────────────────┘          │
└───────────────────────────────────────────┘
```

## License

See [LICENSE](LICENSE) for details.
