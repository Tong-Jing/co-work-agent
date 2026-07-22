import type { ConversationMemory } from "./conversation-memory.js";
import type { LongTermMemory } from "./long-term-memory.js";

export class MemoryService {
  constructor(
    readonly conversation: ConversationMemory,
    readonly longTerm: LongTermMemory,
  ) {}
}
