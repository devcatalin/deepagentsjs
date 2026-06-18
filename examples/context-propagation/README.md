# Context Propagation Example

This example demonstrates how context and configuration automatically propagate from parent agents to subagents in Deep Agents.

## Overview

Deep Agents support two primary mechanisms for sharing context between parent agents and subagents:

1. **Config Propagation** - Runtime configuration via `config.configurable`
2. **State Propagation** - Custom state fields via `contextSchema`

## Running the Example

```bash
# Set up your environment
cp .env.example .env
# Add your ANTHROPIC_API_KEY

# Run the example
npm run build
node dist/examples/context-propagation/context-propagation-example.js
```

Or with tsx:

```bash
npx tsx examples/context-propagation/context-propagation-example.ts
```

## Key Concepts

### 1. Config.configurable Propagation

Configuration values passed in `config.configurable` automatically propagate to all subagents:

```typescript
await agent.invoke(
  { messages: [...] },
  {
    configurable: {
      user_id: "user-123",
      environment: "production",
      api_key: "secret",
    }
  }
);
```

Tools in subagents can access these values:

```typescript
const myTool = tool(async (input, config) => {
  const userId = config?.configurable?.user_id;
  // Use userId in tool logic
}, { ... });
```

### 2. Custom State Propagation

Custom state fields (except `messages`, `todos`, `jumpTo`) automatically propagate to subagents:

```typescript
const CustomContext = Annotation.Root({
  messages: Annotation<any[]>({ reducer: (x, y) => x.concat(y) }),
  userId: Annotation<string>,
  preferences: Annotation<Record<string, any>>,
});

const agent = createDeepAgent({
  contextSchema: CustomContext,
  subagents: [...],
});

await agent.invoke({
  messages: [...],
  userId: "user-123",
  preferences: { theme: "dark" },
});
```

Tools can access state using `getCurrentTaskInput()`:

```typescript
import { getCurrentTaskInput } from "@langchain/langgraph";

const myTool = tool(async (input, config) => {
  const state = getCurrentTaskInput<{ userId?: string }>(config);
  const userId = state.userId;
  // Use state in tool logic
}, { ... });
```

## Example Scenarios

### Scenario 1: User Context Across Agents

Share user information across multiple research agents:

```typescript
const agent = createDeepAgent({
  contextSchema: CustomContext,
  subagents: [
    {
      name: "research-agent",
      description: "Researcher with user context",
      tools: [contextAwareTool],
    },
  ],
});

await agent.invoke(
  {
    messages: [{ role: "user", content: "Research topic" }],
    userId: "user-123",
    preferences: { depth: "comprehensive" },
  },
  {
    configurable: {
      session_id: "session-456",
      trace_id: "trace-789",
    },
  },
);
```

### Scenario 2: Shared Cache Between Agents

Coordinate multiple agents with a shared cache:

```typescript
const SharedState = Annotation.Root({
  messages: Annotation<any[]>({ reducer: (x, y) => x.concat(y) }),
  sharedCache: Annotation<Record<string, any>>({
    reducer: (x, y) => ({ ...x, ...y }),
  }),
});

await agent.invoke({
  messages: [...],
  sharedCache: { knownFacts: [], processedIds: [] },
});

// Subagents can read and update sharedCache
// Updates are merged back to the parent
```

### Scenario 3: Environment Configuration

Pass environment-specific configuration:

```typescript
await agent.invoke(
  { messages: [...] },
  {
    configurable: {
      environment: process.env.NODE_ENV,
      apiEndpoint: process.env.API_ENDPOINT,
      maxRetries: 3,
    }
  }
);
```

## Best Practices

### ✅ Do:

1. **Use `config.configurable`** for runtime parameters (user IDs, session IDs, API keys)
2. **Use custom state** for data that agents need to read and modify
3. **Define typed schemas** with `Annotation.Root()` for type safety
4. **Use reducers** for state fields that need to be merged (like caches)
5. **Access context via `getCurrentTaskInput(config)`** in tools

### ❌ Don't:

1. **Don't rely on `messages` propagating** - subagents get a fresh message with the task description
2. **Don't store secrets in state** - use `config.configurable` with proper access control
3. **Don't modify excluded keys** - `messages`, `todos`, `jumpTo` are managed internally
4. **Don't assume synchronous updates** - state updates happen after subagent completion

## Architecture

```
Parent Agent (config + state)
    │
    ├─ config.configurable ──┐
    ├─ Custom state fields ──┤
    │                         │
    └─ Task Tool             │
         │                    │
         ├─ Subagent A ◄─────┤  (receives config + filtered state)
         │   └─ Tool A ◄─────┤  (can access config + state)
         │                    │
         └─ Subagent B ◄─────┤  (receives config + filtered state)
             └─ Tool B ◄─────┘  (can access config + state)
```

## Related Files

- **Documentation**: `/docs/CONTEXT_PROPAGATION_RESEARCH.md` - Comprehensive research findings
- **Tests**: `/tests/integration/context-propagation.test.ts` - Integration tests
- **Source**: `/src/middleware/subagents.ts` - Implementation details

## Learn More

- [LangGraph Configuration](https://langchain-ai.github.io/langgraphjs/concepts/configuration/)
- [LangChain RunnableConfig](https://js.langchain.com/docs/expression_language/interface)
- [Deep Agents Documentation](../../README.md)
